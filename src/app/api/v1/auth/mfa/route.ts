import { z } from "zod";
import { getDatabase } from "@/server/db";
import { bodyJson, endpoint, json } from "@/server/http";
import { authCookie, saveAuthCookie } from "@/server/auth/http";
import { verifyMfa } from "@/server/auth/service";
import { AppError } from "@/server/errors";

export const POST = endpoint(async (request) => {
  const { code } = z.object({ code: z.string().trim().min(6).max(100) }).parse(await bodyJson(request));
  const cookie = await authCookie();
  if (!cookie.token) throw new AppError("UNAUTHENTICATED", "Sign in first.", 401);
  const token = await verifyMfa(getDatabase(), cookie.token, code);
  await saveAuthCookie({ token, browser: cookie.browser });
  return json({ redirect: "/admin/students" });
});
