import { z } from "zod";
import { requireAdmin } from "@/server/auth/http";
import { getDatabase } from "@/server/db";
import { bodyJson, endpoint, json } from "@/server/http";
import { setStudentStatus } from "@/server/students/service";

export const POST = endpoint(async (request) => {
  const admin = await requireAdmin();
  const input = z.object({ id: z.string().uuid(), disabled: z.boolean(), reason: z.string().trim().min(5).max(1000) }).parse(await bodyJson(request));
  await setStudentStatus(getDatabase(), admin.id, input.id, input.disabled, input.reason);
  return json({ success: true });
});
