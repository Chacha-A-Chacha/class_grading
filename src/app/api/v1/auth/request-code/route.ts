import { randomInt } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { after } from "next/server";
import { z } from "zod";
import { getDatabase } from "@/server/db";
import { bodyJson, endpoint, json } from "@/server/http";
import { authCookie, clientIp, saveAuthCookie } from "@/server/auth/http";
import { hash, secret, token } from "@/server/auth/crypto";
import { issueCode } from "@/server/auth/service";
import { deliverCode, mailTransport } from "@/server/auth/email";
import { failedOutcome, recordDelivery, sentOutcome } from "@/server/auth/delivery";

// Known and unknown addresses take different database paths; pad every response to
// a common floor so timing does not reveal the enrolment list (spec §3, step 1).
const RESPONSE_FLOOR_MS = 400;

export const runtime = "nodejs";
export const POST = endpoint(async (request) => {
  const started = performance.now();
  const { email } = z.object({ email: z.string().trim().toLowerCase().email().max(254) }).parse(await bodyJson(request));
  secret("AUTH_COOKIE_SECRET"); secret("AUTH_CODE_SECRET");
  mailTransport(); // Uniform failure for every address when transport is unconfigured.
  const previous = await authCookie();
  const db = getDatabase();
  // Requesting a code replaces any signed-in session in this browser.
  if (previous.token) await db.session.updateMany({ where: { tokenHash: hash(previous.token), revokedAt: null }, data: { revokedAt: new Date() } });
  const { binding, delivery } = await issueCode(db, email, previous.browser ?? token(), clientIp(request));
  await saveAuthCookie({ ...binding });
  after(async () => {
    if (!delivery) return;
    const sending = performance.now();
    const logged = { userId: delivery.userId, challengeId: delivery.challengeId, purpose: "LOGIN" as const };
    try { await recordDelivery(db, logged, sentOutcome(await deliverCode(delivery.email, delivery.code)), performance.now() - sending); }
    catch (error) {
      const took = performance.now() - sending;
      await db.emailLoginChallenge.updateMany({ where: { id: delivery.challengeId, consumedAt: null }, data: { invalidatedAt: new Date() } });
      await recordDelivery(db, logged, failedOutcome(error), took);
    }
  });
  await sleep(Math.max(0, RESPONSE_FLOOR_MS - (performance.now() - started)) + randomInt(0, 50));
  return json({ message: "If this email is registered, a code has been sent.", expiresIn: 120, resendAfter: 30 });
});
