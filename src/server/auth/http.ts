import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { sealData, unsealData } from "iron-session";
import { z } from "zod";
import { getDatabase } from "../db";
import { AppError } from "../errors";
import { secret } from "./crypto";
import { getSession, mfaRequired, SESSION_SECONDS } from "./service";

const envelopeSchema = z.object({ token: z.string().max(100).optional(), browser: z.string().max(100).optional(), challengeId: z.string().uuid().optional(), subject: z.string().length(64).optional() });
export type AuthCookie = z.infer<typeof envelopeSchema>;
export function origin() {
  const url = process.env.APP_URL || (process.env.NODE_ENV !== "production" ? "http://127.0.0.1:3000" : "");
  if (!url) throw new AppError("NOT_CONFIGURED", "Sign-in is not configured yet.", 503);
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" && !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname)) throw new AppError("NOT_CONFIGURED", "HTTPS is required outside local development.", 503);
  return parsed.origin;
}
export function cookieName() { return new URL(origin()).protocol === "https:" ? "__Host-grading" : "grading-local"; }
export async function authCookie(): Promise<AuthCookie> {
  const value = (await cookies()).get(cookieName())?.value;
  if (!value) return {};
  const decoded = await unsealData(value, { password: secret("AUTH_COOKIE_SECRET"), ttl: SESSION_SECONDS });
  return envelopeSchema.safeParse(decoded).data ?? {};
}
export async function saveAuthCookie(data: AuthCookie) {
  const value = await sealData(data, { password: secret("AUTH_COOKIE_SECRET"), ttl: SESSION_SECONDS });
  (await cookies()).set(cookieName(), value, { httpOnly: true, secure: new URL(origin()).protocol === "https:", sameSite: "lax", path: "/", maxAge: SESSION_SECONDS });
}
/** Deduplicated per request; layouts and pages may both ask. Pending-MFA owner sessions need opt-in. */
export const currentSession = cache(async (allowPendingMfa = false) => {
  const envelope = await authCookie();
  return getSession(getDatabase(), envelope.token, { allowPendingMfa });
});
export async function requireAdmin() {
  const session = await currentSession(true);
  if (!session) throw new AppError("UNAUTHENTICATED", "Sign in to continue.", 401);
  if (!session.user.isAdmin) throw new AppError("FORBIDDEN", "Admin access is required.", 403);
  if (mfaRequired() && !session.mfaVerifiedAt) throw new AppError("FORBIDDEN", "Admin authenticator verification is required.", 403);
  return session;
}
export async function adminPage() {
  const session = await currentSession(true);
  if (!session) redirect("/sign-in");
  if (!session.user.isAdmin) redirect("/student");
  if (mfaRequired() && !session.mfaVerifiedAt) redirect("/sign-in/mfa");
  return session;
}
export function requireSameOrigin(request: Request) {
  if (request.headers.get("origin") !== origin() || request.headers.get("sec-fetch-site") === "cross-site") throw new AppError("INVALID_ORIGIN", "Reload this page and try again.", 403);
}
/**
 * Only trust X-Real-IP behind a proxy that OVERWRITES it (Caddy: header_up X-Real-IP {remote_host}).
 * Without it, per-IP limits are skipped rather than pooling every client into one bucket
 * that a single script could exhaust. Production must run behind that proxy.
 */
export function clientIp(request: Request): string | null {
  if (process.env.TRUST_PROXY_IP === "true") return (request.headers.get("x-real-ip") ?? "unknown").slice(0, 100);
  if (process.env.NODE_ENV === "production") throw new AppError("NOT_CONFIGURED", "Sign-in is not configured yet.", 503);
  return null;
}
