import "server-only";
import nodemailer from "nodemailer";
import { AppError } from "../errors";
import { BRAND } from "../../shared/brand";

export function mailTransport() {
  const { SMTP_HOST, SMTP_USER, SMTP_PASSWORD, MAIL_FROM } = process.env;
  const port = Number(process.env.SMTP_PORT || "465");
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASSWORD || !MAIL_FROM || ![465, 587].includes(port)) throw new AppError("MAIL_NOT_CONFIGURED", "Email sign-in is not configured yet. Please contact your instructor.", 503);
  return nodemailer.createTransport({ host: SMTP_HOST, port, secure: port === 465, requireTLS: true, auth: { user: SMTP_USER, pass: SMTP_PASSWORD }, connectionTimeout: 5000, greetingTimeout: 5000, socketTimeout: 10_000, logger: false, debug: false, disableFileAccess: true, disableUrlAccess: true });
}
/** Resolves with the mail server's acceptance reply (e.g. "250 OK id=…"). */
export async function deliverCode(email: string, code: string): Promise<string> {
  const info = await mailTransport().sendMail({ from: process.env.MAIL_FROM, to: email, subject: `Your ${BRAND.name} sign-in code`, text: `Your sign-in code is ${code}. It expires two minutes after it was requested. Enter it in the browser where you requested it. Do not share this code. If you did not request it, ignore this email.` });
  return typeof info.response === "string" ? info.response : "";
}
