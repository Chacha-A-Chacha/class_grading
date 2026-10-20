import { z } from "zod";
import { getDatabase } from "@/server/db";
import { bodyJson, endpoint, json } from "@/server/http";
import { authCookie, clientIp, saveAuthCookie } from "@/server/auth/http";
import { mfaRequired, verifyCode } from "@/server/auth/service";
import { AppError } from "@/server/errors";

export const POST = endpoint(async (request) => {
  const { code } = z.object({ code: z.string().regex(/^\d{6}$/, "Enter the six-digit code.") }).parse(await bodyJson(request));
  const binding = await authCookie();
  if (!binding.challengeId || !binding.browser || !binding.subject) throw new AppError("INVALID_CODE", "Request a code in this browser first.", 401);
  const result = await verifyCode(getDatabase(), { challengeId: binding.challengeId, browser: binding.browser, subject: binding.subject }, code, clientIp(request));
  await saveAuthCookie({ token: result.token, browser: binding.browser });
  return json({ redirect: result.isAdmin ? (mfaRequired() ? "/sign-in/mfa" : "/admin") : "/student" });
});
