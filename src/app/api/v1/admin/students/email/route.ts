import { z } from "zod";
import { requireAdmin } from "@/server/auth/http";
import { getDatabase } from "@/server/db";
import { bodyJson, endpoint, json } from "@/server/http";
import { changeStudentEmail } from "@/server/students/service";

export const POST = endpoint(async (request) => {
  const admin = await requireAdmin();
  const input = z.object({
    id: z.string().uuid(), email: z.string().max(254),
    reason: z.string().trim().min(5, "Give a reason of at least 5 characters.").max(1000),
    identityConfirmed: z.literal(true, { error: "Confirm that you checked the student's identity." }),
  }).parse(await bodyJson(request));
  await changeStudentEmail(getDatabase(), admin.id, input.id, input.email, input.reason);
  return json({ success: true });
});
