import { z } from "zod";
import { requireAdmin } from "@/server/auth/http";
import { getDatabase } from "@/server/db";
import { bodyJson, endpoint, json } from "@/server/http";
import { resetSignInLimits } from "@/server/students/service";

/** Clears a student's account-wide sign-in counters, e.g. after a classmate exhausted them. */
export const POST = endpoint(async (request) => {
  const admin = await requireAdmin();
  const input = z.object({ id: z.string().uuid(), reason: z.string().trim().min(5).max(1000) }).parse(await bodyJson(request));
  return json({ cleared: await resetSignInLimits(getDatabase(), admin.id, input.id, input.reason) });
});
