import { z } from "zod";
import { after } from "next/server";
import { authCookie, requireStudent } from "@/server/auth/http";
import { getDatabase } from "@/server/db";
import { endpoint, json } from "@/server/http";
import { AppError } from "@/server/errors";
import { requestTakeoverCode } from "@/server/attempts/service";
import { deliverTakeoverCode, mailTransport } from "@/server/auth/email";
import { failedOutcome, recordDelivery, sentOutcome } from "@/server/auth/delivery";

export const POST = endpoint(async (_request, context: RouteContext<"/api/v1/attempts/[id]/takeover/code">) => {
  const session = await requireStudent();
  const id = z.string().uuid().parse((await context.params).id);
  const { browser } = await authCookie();
  if (!browser) throw new AppError("UNAUTHENTICATED", "Sign in again to continue.", 401);
  mailTransport();
  const db = getDatabase();
  const delivery = await requestTakeoverCode(db, session.userId, session.id, id, browser);
  after(async () => {
    if (!delivery) return;
    const sending = performance.now();
    const logged = { userId: delivery.userId, challengeId: delivery.challengeId, purpose: "TAKEOVER" as const };
    try { await recordDelivery(db, logged, sentOutcome(await deliverTakeoverCode(delivery.email, delivery.code)), performance.now() - sending); }
    catch (error) {
      await db.emailLoginChallenge.updateMany({ where: { id: delivery.challengeId, consumedAt: null }, data: { invalidatedAt: new Date() } });
      await recordDelivery(db, logged, failedOutcome(error), performance.now() - sending);
    }
  });
  return json({ message: delivery ? "A code has been sent to your email." : "A code was sent recently. Wait 30 seconds before asking again.", expiresIn: 120, resendAfter: 30 });
});
