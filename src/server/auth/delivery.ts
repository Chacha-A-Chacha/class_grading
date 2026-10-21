import type { PrismaClient } from "../../generated/prisma/client";

export type DeliveryOutcome = { status: "SENT" | "FAILED"; smtpCode: number | null; errorCode: string | null; stage: string | null; detail: string | null };

/** Mail server replies can echo the recipient or the message; keep neither in logs. */
export function redact(text: string) {
  return text.replace(/[^\s<>()"',;:]+@[^\s<>()"',;:]+/g, "[address]").replace(/\b\d{6}\b/g, "[code]").replace(/\s+/g, " ").trim().slice(0, 300);
}
const smtpCodeOf = (value: unknown, text: string) => {
  const code = typeof value === "number" ? value : Number(/^\s*([2-5]\d\d)\b/.exec(text)?.[1]);
  return Number.isInteger(code) && code >= 200 && code <= 599 ? code : null;
};
export function sentOutcome(response: unknown): DeliveryOutcome {
  const text = typeof response === "string" ? response : "";
  return { status: "SENT", smtpCode: smtpCodeOf(undefined, text), errorCode: null, stage: null, detail: text ? redact(text) : null };
}
/** Nodemailer errors carry `code` (ETIMEDOUT, EAUTH…), `command` (CONN, RCPT TO…) and the server reply. */
export function failedOutcome(error: unknown): DeliveryOutcome {
  const e = (error && typeof error === "object" ? error : {}) as { code?: unknown; command?: unknown; responseCode?: unknown; response?: unknown; message?: unknown };
  const text = typeof e.response === "string" ? e.response : typeof e.message === "string" ? e.message : "";
  return {
    status: "FAILED", smtpCode: smtpCodeOf(e.responseCode, typeof e.response === "string" ? e.response : ""),
    errorCode: typeof e.code === "string" ? e.code.slice(0, 40) : null, stage: typeof e.command === "string" ? e.command.slice(0, 40) : null,
    detail: text ? redact(text) : null,
  };
}
type Delivery = { userId: string; challengeId: string; purpose: "LOGIN" | "TAKEOVER" };
/** Records the outcome without ever failing the caller; the log is support data, not a gate. */
export async function recordDelivery(db: PrismaClient, delivery: Delivery, outcome: DeliveryOutcome, durationMs: number) {
  const fields = { challengeId: delivery.challengeId, status: outcome.status, ms: durationMs, code: outcome.errorCode, stage: outcome.stage, smtp: outcome.smtpCode };
  if (outcome.status === "FAILED") console.error("Login email delivery failed", JSON.stringify({ ...fields, detail: outcome.detail }));
  try {
    await db.emailDelivery.create({ data: { userId: delivery.userId, challengeId: delivery.challengeId, purpose: delivery.purpose, durationMs: Math.max(0, Math.round(durationMs)), ...outcome } });
  } catch { console.error("Email delivery log write failed", delivery.challengeId); }
}
