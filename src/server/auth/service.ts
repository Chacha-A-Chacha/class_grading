import { randomInt, randomUUID } from "node:crypto";
import { verify } from "otplib";
import type { Prisma, PrismaClient } from "../../generated/prisma/client";
import { AppError } from "../errors";
import { decrypt, equal, hash, token, verifier } from "./crypto";

type Tx = Prisma.TransactionClient;
export const SESSION_SECONDS = 12 * 60 * 60;
/**
 * Owner MFA is off for now: the owner signs in with an email code like students.
 * Set ADMIN_MFA=required to restore the authenticator step (enrol with npm run
 * admin:setup-mfa first). When required, an owner session is restricted and
 * short-lived until the second factor succeeds.
 */
export const mfaRequired = () => process.env.ADMIN_MFA === "required";
export const PENDING_MFA_SECONDS = 10 * 60;
const WINDOW = 900;
export type LoginBinding = { challengeId: string; browser: string; subject: string };
export type Limit = { scope: string; subject: string; limit: number };
export async function now(tx: Tx | PrismaClient): Promise<Date> {
  return (await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`)[0].now;
}
/**
 * Increments fixed-window counters in order and stops at the first exhausted one, so
 * rejected traffic creates no further rows. Each statement autocommits when given the
 * client, keeping a shared bucket's row lock out of the login transaction.
 */
export async function consume(db: Tx | PrismaClient, limits: Limit[]): Promise<boolean> {
  for (const { scope, subject, limit } of limits) {
    const [row] = await db.$queryRaw<{ count: number }[]>`
      INSERT INTO "AuthRateLimitBucket" ("scope", "subjectHash", "windowStart", "expiresAt", "count")
      SELECT ${scope}, ${subject}, w, w + ${WINDOW}::int * interval '1 second', 1
      FROM date_bin(${WINDOW}::int * interval '1 second', clock_timestamp(), timestamptz '2000-01-01 00:00:00+00') AS w
      ON CONFLICT ("scope", "subjectHash", "windowStart") DO UPDATE SET "count" = "AuthRateLimitBucket"."count" + 1
      RETURNING "count"`;
    if (row.count > limit) return false;
  }
  return true;
}
/** Per-IP buckets are a class-sized safety net; null means the address is not trusted. */
const ipLimit = (scope: string, ip: string | null, limit: number): Limit[] => ip ? [{ scope, subject: verifier("ip", ip), limit }] : [];
/** Clears account-wide sign-in counters, e.g. after a classmate deliberately exhausted them. */
export const accountScopes = ["request-email", "verify-email"];
export async function issueCode(db: PrismaClient, email: string, browser: string, ip: string | null) {
  const binding: LoginBinding = { challengeId: randomUUID(), browser, subject: verifier("email", email) };
  // Callers return the same acknowledgement whether or not a code is issued.
  if (!await consume(db, [...ipLimit("request-ip", ip, 1000), { scope: "request-browser", subject: hash(browser), limit: 10 }])) return { binding, delivery: null };
  const result = await db.$transaction(async (tx) => {
    // Shared lock order: user, account bucket, challenge, session, authenticator.
    const [user] = await tx.$queryRaw<{ id: string; email: string; disabledAt: Date | null }[]>`SELECT id, email, "disabledAt" FROM "User" WHERE email = ${email} FOR UPDATE`;
    if (!user || user.disabledAt) return null;
    const time = await now(tx);
    const recent = await tx.emailLoginChallenge.findFirst({ where: { userId: user.id, purpose: "LOGIN" }, orderBy: { issuedAt: "desc" } });
    if (recent && recent.resendAvailableAt > time) {
      if (equal(recent.browserBindingHash, hash(browser))) binding.challengeId = recent.id;
      return null;
    }
    // Count only codes actually issued, so cooldown-suppressed requests cannot exhaust the account.
    if (!await consume(tx, [{ scope: "request-email", subject: binding.subject, limit: 5 }])) return null;
    await tx.emailLoginChallenge.updateMany({ where: { userId: user.id, purpose: "LOGIN", consumedAt: null, invalidatedAt: null }, data: { invalidatedAt: time } });
    const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
    await tx.emailLoginChallenge.create({ data: {
      id: binding.challengeId, userId: user.id, purpose: "LOGIN", codeVerifier: verifier(binding.challengeId, code), browserBindingHash: hash(browser),
      issuedAt: time, expiresAt: new Date(time.getTime() + 120_000), resendAvailableAt: new Date(time.getTime() + 30_000),
    } });
    return { userId: user.id, email: user.email, code, challengeId: binding.challengeId };
  });
  return { binding, delivery: result };
}
export async function verifyCode(db: PrismaClient, binding: LoginBinding, code: string, ip: string | null) {
  const limits = [...ipLimit("verify-ip", ip, 2000), { scope: "verify-browser", subject: hash(binding.browser), limit: 30 }, { scope: "verify-email", subject: binding.subject, limit: 15 }];
  if (!await consume(db, limits)) throw new AppError("RATE_LIMITED", "Too many sign-in attempts. Wait 15 minutes or contact your instructor.", 429);
  const result = await db.$transaction(async (tx) => {
    const candidate = await tx.emailLoginChallenge.findUnique({ where: { id: binding.challengeId } });
    if (!candidate) return null;
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${candidate.userId}::uuid FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "EmailLoginChallenge" WHERE id = ${binding.challengeId}::uuid FOR UPDATE`;
    const challenge = await tx.emailLoginChallenge.findUniqueOrThrow({ where: { id: binding.challengeId }, include: { user: true } });
    const time = await now(tx);
    if (challenge.purpose !== "LOGIN" || challenge.user.disabledAt || challenge.consumedAt || challenge.invalidatedAt || challenge.expiresAt <= time || challenge.failedAttempts >= 5) return null;
    const valid = equal(challenge.browserBindingHash, hash(binding.browser)) && equal(binding.subject, verifier("email", challenge.user.email)) && equal(challenge.codeVerifier, verifier(challenge.id, code));
    if (!valid) {
      await tx.emailLoginChallenge.update({ where: { id: challenge.id }, data: { failedAttempts: { increment: 1 }, ...(challenge.failedAttempts === 4 ? { invalidatedAt: time } : {}) } });
      return null;
    }
    await tx.emailLoginChallenge.update({ where: { id: challenge.id }, data: { consumedAt: time } });
    await tx.user.update({ where: { id: challenge.userId }, data: { emailVerifiedAt: challenge.user.emailVerifiedAt ?? time } });
    const raw = token();
    const lifetime = challenge.user.isAdmin && mfaRequired() ? PENDING_MFA_SECONDS : SESSION_SECONDS;
    const session = await tx.session.create({ data: { userId: challenge.userId, tokenHash: hash(raw), authenticatedAt: time, expiresAt: new Date(time.getTime() + lifetime * 1000) } });
    return { token: raw, sessionId: session.id, isAdmin: challenge.user.isAdmin };
  });
  if (!result) throw new AppError("INVALID_CODE", "The code is invalid or expired. Request a new code if needed.", 401);
  return result;
}
const sessionUser = { select: { id: true, email: true, displayName: true, isAdmin: true, disabledAt: true } } as const;
/** When MFA is required, an owner session before MFA is usable only where `allowPendingMfa` is passed. */
export async function getSession(db: PrismaClient, raw: string | undefined, { allowPendingMfa = false } = {}) {
  if (!raw) return null;
  const session = await db.session.findUnique({ where: { tokenHash: hash(raw) }, include: { user: sessionUser } });
  if (!session || session.revokedAt || session.expiresAt <= new Date() || session.user.disabledAt) return null;
  if (session.user.isAdmin && mfaRequired() && !session.mfaVerifiedAt && !allowPendingMfa) return null;
  return session;
}
export async function assertAdmin(tx: Tx, sessionId: string) {
  const session = await tx.session.findUnique({ where: { id: sessionId }, include: { user: true } });
  const time = await now(tx);
  if (!session || session.revokedAt || session.expiresAt <= time || (mfaRequired() && !session.mfaVerifiedAt) || !session.user.isAdmin || session.user.disabledAt) throw new AppError("FORBIDDEN", "Admin sign-in is required.", 403);
  return session;
}
export async function verifyMfa(db: PrismaClient, raw: string, value: string) {
  if (!mfaRequired()) throw new AppError("NOT_FOUND", "Authenticator verification is not enabled.", 404);
  const existing = await getSession(db, raw, { allowPendingMfa: true });
  if (!existing?.user.isAdmin) throw new AppError("FORBIDDEN", "Admin sign-in is required.", 403);
  if (!await consume(db, [{ scope: "mfa", subject: verifier("mfa", existing.userId), limit: 10 }])) throw new AppError("RATE_LIMITED", "Too many verification attempts. Wait 15 minutes and sign in again.", 429);
  const result = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${existing.userId}::uuid FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "Session" WHERE id = ${existing.id}::uuid FOR UPDATE`;
    const session = await tx.session.findUniqueOrThrow({ where: { id: existing.id }, include: { user: true } });
    const time = await now(tx);
    // A concurrent verification may already have rotated this token.
    if (!equal(session.tokenHash, hash(raw)) || session.revokedAt || session.user.disabledAt || session.expiresAt <= time || !session.user.isAdmin || session.authenticatedAt < new Date(time.getTime() - 10 * 60_000)) return null;
    await tx.$queryRaw`SELECT "userId" FROM "AdminAuthenticator" WHERE "userId" = ${session.userId}::uuid FOR UPDATE`;
    const factor = await tx.adminAuthenticator.findUnique({ where: { userId: session.userId } });
    if (!factor?.confirmedAt) return null;
    const recoveryHash = verifier("recovery", value.trim().toLowerCase());
    const recovery = factor.recoveryCodeHashes.find((h) => equal(h, recoveryHash));
    if (recovery) {
      await tx.adminAuthenticator.update({ where: { userId: session.userId }, data: { recoveryCodeHashes: factor.recoveryCodeHashes.filter((h) => h !== recovery) } });
    } else {
      if (!/^\d{6}$/.test(value)) return null;
      // otplib throws when the last used step is ahead of this clock (e.g. setup on a fast laptop).
      const checked = await verify({ secret: decrypt(factor.encryptedTotpSecret), token: value, epoch: Math.floor(time.getTime() / 1000), epochTolerance: [30, 0], ...(factor.lastUsedStep === null ? {} : { afterTimeStep: Number(factor.lastUsedStep) }) }).catch(() => null);
      if (!checked?.valid || !("timeStep" in checked) || checked.timeStep === undefined) return null;
      await tx.adminAuthenticator.update({ where: { userId: session.userId }, data: { lastUsedStep: BigInt(checked.timeStep) } });
    }
    const rotated = token();
    await tx.session.update({ where: { id: session.id }, data: { tokenHash: hash(rotated), mfaVerifiedAt: time, expiresAt: new Date(time.getTime() + SESSION_SECONDS * 1000) } });
    await tx.auditLog.create({ data: { actorId: session.userId, action: recovery ? "ADMIN_RECOVERY_USED" : "ADMIN_MFA_VERIFIED", targetType: "Session", targetId: session.id, reason: "Owner completed the second authentication factor." } });
    return rotated;
  });
  if (!result) throw new AppError("INVALID_FACTOR", "Verification failed. Check the code or sign in again.", 401);
  return result;
}
