import { z } from "zod";
import { authCookie, requireStudent } from "@/server/auth/http";
import { getDatabase } from "@/server/db";
import { bodyJson, endpoint, json } from "@/server/http";
import { AppError } from "@/server/errors";
import { takeOver } from "@/server/attempts/service";

export const POST = endpoint(async (request, context: RouteContext<"/api/v1/attempts/[id]/takeover">) => {
  const session = await requireStudent();
  const id = z.string().uuid().parse((await context.params).id);
  const { code } = z.object({ confirmed: z.literal(true, { error: "Confirm that you want to continue here." }), code: z.string().regex(/^\d{6}$/, "Enter the six-digit code.").optional() }).parse(await bodyJson(request));
  const { browser } = await authCookie();
  if (!browser) throw new AppError("UNAUTHENTICATED", "Sign in again to continue.", 401);
  return json(await takeOver(getDatabase(), session.userId, session.id, id, browser, code));
});
