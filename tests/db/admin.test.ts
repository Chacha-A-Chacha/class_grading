import "dotenv/config";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { generate, generateSecret } from "otplib";
import { PrismaClient } from "../../src/generated/prisma/client";
import { encrypt, hash, token, verifier } from "../../src/server/auth/crypto";
import { assertAdmin, consume, getSession, issueCode, verifyCode, verifyMfa } from "../../src/server/auth/service";
import { addStudent, commitImport, createPreview, resetSignInLimits, setStudentStatus } from "../../src/server/students/service";
import { normalizeRows } from "../../src/shared/students";

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString) throw new Error("Set TEST_DATABASE_URL explicitly. Tests never default to the application database.");
process.env.AUTH_CODE_SECRET = token(); process.env.AUTH_MFA_SECRET = token();
// The MFA tests exercise the dormant authenticator path; one test below covers the default (off).
process.env.ADMIN_MFA = "required";
const schema = `grading_admin_test_${randomUUID().replaceAll("-", "")}`;
const pool = new Pool({ connectionString, max: 1 });
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString, max: 4, options: `-c search_path=${schema} -c timezone=UTC` }, { schema }) });
let ownerId: string, sessionId: string, created = false;
before(async () => {
  await pool.query(`CREATE SCHEMA "${schema}"`); created = true;
  const url = new URL(connectionString!); url.searchParams.set("schema", schema);
  await promisify(execFile)(process.execPath, [path.resolve("node_modules/prisma/build/index.js"), "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: url.toString() }, windowsHide: true });
  const owner = await db.user.create({ data: { email: "owner@example.test", displayName: "Owner", isAdmin: true } }); ownerId = owner.id;
  sessionId = (await db.session.create({ data: { userId: ownerId, tokenHash: hash(token()), authenticatedAt: new Date(), expiresAt: new Date(Date.now() + 3600_000), mfaVerifiedAt: new Date() } })).id;
});
after(async () => { await db.$disconnect(); if (created && /^grading_admin_test_[a-f0-9]{32}$/.test(schema)) await pool.query(`DROP SCHEMA "${schema}" CASCADE`); await pool.end(); });
async function student() { return db.user.create({ data: { email: `${randomUUID()}@example.test`, displayName: "Test student", admissionNumber: randomUUID().toUpperCase() } }); }
function importRows(email: string, admission: string = randomUUID(), name = "Imported student") { return normalizeRows([["name", "email", "admission"], [name, email, admission]], { name: 0, email: 1, admission: 2, confirmation: -1 }); }
async function ownerSession() { const raw = token(); await db.session.create({ data: { userId: ownerId, tokenHash: hash(raw), expiresAt: new Date(Date.now() + 3600_000) } }); return raw; }

test("unknown/disabled accounts receive no code and import never verifies email", async () => {
  const unknown = await issueCode(db, "missing@example.test", token(), "test"); assert.equal(unknown.delivery, null);
  const user = await student(); await db.user.update({ where: { id: user.id }, data: { disabledAt: new Date() } });
  assert.equal((await issueCode(db, user.email, token(), "test")).delivery, null);
  assert.equal((await db.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerifiedAt, null);
});
test("email code binds to browser, has a 2-minute expiry, and cannot be replayed concurrently", async () => {
  const user = await student(); const requested = await issueCode(db, user.email, token(), "test"); assert.ok(requested.delivery);
  const challenge = await db.emailLoginChallenge.findUniqueOrThrow({ where: { id: requested.binding.challengeId } });
  assert.equal(challenge.expiresAt.getTime() - challenge.issuedAt.getTime(), 120_000);
  assert.notEqual(challenge.codeVerifier, hash(requested.delivery.code));
  await assert.rejects(verifyCode(db, { ...requested.binding, browser: token() }, requested.delivery.code, "test"));
  const results = await Promise.allSettled([verifyCode(db, requested.binding, requested.delivery.code, "test"), verifyCode(db, requested.binding, requested.delivery.code, "test")]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(await db.session.count({ where: { userId: user.id } }), 1);
  assert.ok((await db.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerifiedAt);
});
test("five wrong guesses invalidate a challenge", async () => {
  const user = await student(); const requested = await issueCode(db, user.email, token(), "test"); assert.ok(requested.delivery);
  const wrong = requested.delivery.code === "000000" ? "111111" : "000000";
  for (let i = 0; i < 5; i++) await assert.rejects(verifyCode(db, requested.binding, wrong, "test"));
  await assert.rejects(verifyCode(db, requested.binding, requested.delivery.code, "test"));
  const challenge = await db.emailLoginChallenge.findUniqueOrThrow({ where: { id: requested.binding.challengeId } }); assert.equal(challenge.failedAttempts, 5); assert.ok(challenge.invalidatedAt);
});
test("expired codes fail and a resend invalidates the original", async () => {
  const user = await student(); const browser = token(); const first = await issueCode(db, user.email, browser, "test"); assert.ok(first.delivery);
  const early = await issueCode(db, user.email, browser, "test"); assert.equal(early.delivery, null); assert.equal(early.binding.challengeId, first.binding.challengeId);
  const ago = Date.now() - 180_000;
  await db.emailLoginChallenge.update({ where: { id: first.binding.challengeId }, data: { issuedAt: new Date(ago), expiresAt: new Date(ago + 120_000), resendAvailableAt: new Date(ago + 30_000) } });
  await assert.rejects(verifyCode(db, first.binding, first.delivery.code, "test"));
  const second = await issueCode(db, user.email, browser, "test"); assert.ok(second.delivery);
  await assert.rejects(verifyCode(db, first.binding, first.delivery.code, "test"));
  assert.ok(await verifyCode(db, second.binding, second.delivery.code, "test"));
});
test("student sessions and email-only owner sessions cannot authorize imports", async () => {
  const user = await student(); const session = await db.session.create({ data: { userId: user.id, tokenHash: hash(token()), expiresAt: new Date(Date.now() + 3600_000), mfaVerifiedAt: new Date() } });
  const rows = importRows("blocked@example.test");
  await assert.rejects(createPreview(db, session.id, rows));
  const raw = await ownerSession(); assert.equal(await getSession(db, raw), null); const owner = await getSession(db, raw, { allowPendingMfa: true }); assert.ok(owner);
  await assert.rejects(createPreview(db, owner.id, rows));
});
test("TOTP is replay-protected, rotates session tokens, and recovery codes are single-use", async () => {
  const secret = generateSecret(), recovery = "unit-test-recovery-code";
  await db.adminAuthenticator.create({ data: { userId: ownerId, encryptedTotpSecret: encrypt(secret), confirmedAt: new Date(), recoveryCodeHashes: [verifier("recovery", recovery)] } });
  const raw = await ownerSession(), code = await generate({ secret });
  const rotated = await verifyMfa(db, raw, code); assert.equal(await getSession(db, raw), null);
  const session = await getSession(db, rotated); assert.ok(session?.mfaVerifiedAt);
  await db.$transaction((tx) => assertAdmin(tx, session!.id));
  const other = await ownerSession(); await assert.rejects(verifyMfa(db, other, code));
  assert.ok(await verifyMfa(db, other, recovery));
  await assert.rejects(verifyMfa(db, await ownerSession(), recovery));
});
test("import is atomic, preserves leading zeros, stores only identity, and retries return one receipt", async () => {
  const rows = importRows("imported@example.test", "001234"); const preview = await createPreview(db, sessionId, rows);
  assert.equal(preview.rows[0].action, "create");
  const responses = await Promise.all([commitImport(db, sessionId, preview.id, [2]), commitImport(db, sessionId, preview.id, [2])]);
  assert.deepEqual(responses[0], { created: 1, existing: 0, excluded: 0, rejected: 0 }); assert.deepEqual(responses[0], responses[1]);
  const imported = await db.user.findUniqueOrThrow({ where: { email: rows[0].email } }); assert.equal(imported.admissionNumber, "001234"); assert.equal(imported.isAdmin, false); assert.equal(imported.emailVerifiedAt, null);
  const receipt = await db.studentImport.findUniqueOrThrow({ where: { id: preview.id } }); assert.equal(receipt.rows, null);
  assert.equal(await db.auditLog.count({ where: { action: "STUDENTS_IMPORTED", targetId: preview.id } }), 1);
  const repeat = await createPreview(db, sessionId, rows); assert.equal(repeat.rows[0].action, "existing");
  assert.deepEqual(await commitImport(db, sessionId, repeat.id, [2]), { created: 0, existing: 1, excluded: 0, rejected: 0 });
});
test("changed database identities abort the whole import without partial creates", async () => {
  const rows = normalizeRows([["name", "email", "admission"], ["One", "one@example.test", "S1"], ["Two", "two@example.test", "S2"]], { name: 0, email: 1, admission: 2, confirmation: -1 });
  const preview = await createPreview(db, sessionId, rows);
  await addStudent(db, sessionId, { email: "conflicting@example.test", displayName: "Another", admissionNumber: "S2" });
  await assert.rejects(commitImport(db, sessionId, preview.id, [2, 3]), /roster changed/i);
  assert.equal(await db.user.count({ where: { email: "one@example.test" } }), 0);
  assert.equal((await db.studentImport.findUniqueOrThrow({ where: { id: preview.id } })).committedAt, null);
});
test("invalid selected rows and expired previews cannot commit", async () => {
  const rows = importRows("not-an-email"); const preview = await createPreview(db, sessionId, rows);
  await assert.rejects(commitImport(db, sessionId, preview.id, [2]));
  const valid = await createPreview(db, sessionId, importRows("expired-preview@example.test"));
  await db.studentImport.update({ where: { id: valid.id }, data: { createdAt: new Date(Date.now() - 3600_000), expiresAt: new Date(Date.now() - 60_000) } });
  await assert.rejects(commitImport(db, sessionId, valid.id, [2]));
});
test("disabling revokes sessions and codes; imports cannot reactivate or promote", async () => {
  const user = await student(); const requested = await issueCode(db, user.email, token(), "test"); assert.ok(requested.delivery);
  const raw = token(); await db.session.create({ data: { userId: user.id, tokenHash: hash(raw), expiresAt: new Date(Date.now() + 3600_000) } });
  await setStudentStatus(db, sessionId, user.id, true, "Student left the class.");
  assert.equal(await getSession(db, raw), null); await assert.rejects(verifyCode(db, requested.binding, requested.delivery.code, "test"));
  const preview = await createPreview(db, sessionId, importRows(user.email, user.admissionNumber!, user.displayName)); assert.equal(preview.rows[0].action, "conflict");
  await assert.rejects(setStudentStatus(db, sessionId, ownerId, true, "Not allowed"));
});
test("owner email sign-in is a short pending session until MFA extends it", async () => {
  const recovery = "pending-session-recovery-code";
  await db.adminAuthenticator.update({ where: { userId: ownerId }, data: { recoveryCodeHashes: [verifier("recovery", recovery)] } });
  const requested = await issueCode(db, "owner@example.test", token(), "test"); assert.ok(requested.delivery);
  const { token: raw, isAdmin } = await verifyCode(db, requested.binding, requested.delivery.code, "test"); assert.equal(isAdmin, true);
  assert.equal(await getSession(db, raw), null);
  const pending = await getSession(db, raw, { allowPendingMfa: true }); assert.ok(pending);
  assert.equal(pending.expiresAt.getTime() - pending.authenticatedAt.getTime(), 10 * 60_000);
  await assert.rejects(db.$transaction((tx) => assertAdmin(tx, pending.id)));
  const verified = await getSession(db, await verifyMfa(db, raw, recovery)); assert.ok(verified?.mfaVerifiedAt);
  assert.ok(verified.expiresAt.getTime() - verified.authenticatedAt.getTime() > 11 * 3600_000);
});
test("rate counters are race-free and stop at the limit", async () => {
  const results = await Promise.all(Array.from({ length: 10 }, () => consume(db, [{ scope: "race", subject: hash(token()).replace(/./g, "a"), limit: 5 }])));
  assert.equal(results.filter(Boolean).length, 5);
  const blocked = hash(token());
  assert.equal(await consume(db, [{ scope: "first", subject: blocked, limit: 0 }, { scope: "second", subject: blocked, limit: 9 }]), false);
  assert.equal(await db.authRateLimitBucket.count({ where: { scope: "second", subjectHash: blocked } }), 0);
});
test("cooldown requests do not use account issuance; verify limits return 429 and the owner can reset them", async () => {
  const user = await student(); const browser = token();
  const first = await issueCode(db, user.email, browser, "test"); assert.ok(first.delivery);
  for (let i = 0; i < 8; i++) assert.equal((await issueCode(db, user.email, browser, "test")).delivery, null);
  const issued = await db.authRateLimitBucket.findFirstOrThrow({ where: { scope: "request-email", subjectHash: first.binding.subject } }); assert.equal(issued.count, 1);
  const wrong = first.delivery.code === "000000" ? "111111" : "000000";
  for (let i = 0; i < 15; i++) await assert.rejects(verifyCode(db, first.binding, wrong, "test"), /invalid or expired/);
  await assert.rejects(verifyCode(db, first.binding, wrong, "test"), (error: { code?: string; status?: number }) => error.code === "RATE_LIMITED" && error.status === 429);
  assert.ok(await resetSignInLimits(db, sessionId, user.id, "Identity confirmed in class.") >= 1);
  await assert.rejects(verifyCode(db, first.binding, wrong, "test"), /invalid or expired/);
  assert.equal(await db.auditLog.count({ where: { action: "STUDENT_SIGN_IN_LIMITS_RESET", targetId: user.id } }), 1);
});
test("unchanged status changes are rejected rather than re-audited", async () => {
  const user = await student();
  await assert.rejects(setStudentStatus(db, sessionId, user.id, false, "Already enabled"), /already enabled/);
});
test("with owner MFA off (the default), an email code grants a full admin session", async () => {
  process.env.ADMIN_MFA = "off";
  try {
    // An earlier test requested an owner code; move it past the 30-second resend cooldown.
    const ago = Date.now() - 180_000;
    await db.emailLoginChallenge.updateMany({ where: { userId: ownerId }, data: { issuedAt: new Date(ago), expiresAt: new Date(ago + 120_000), resendAvailableAt: new Date(ago + 30_000) } });
    const requested = await issueCode(db, "owner@example.test", token(), "test"); assert.ok(requested.delivery);
    const { token: raw, isAdmin } = await verifyCode(db, requested.binding, requested.delivery.code, "test"); assert.equal(isAdmin, true);
    const session = await getSession(db, raw); assert.ok(session); assert.equal(session.mfaVerifiedAt, null);
    assert.ok(session.expiresAt.getTime() - session.authenticatedAt.getTime() > 11 * 3600_000);
    await db.$transaction((tx) => assertAdmin(tx, session.id));
    assert.ok((await createPreview(db, session.id, importRows(`${randomUUID()}@example.test`))).id);
    await assert.rejects(verifyMfa(db, raw, "000000"), /not enabled/);
  } finally { process.env.ADMIN_MFA = "required"; }
});
