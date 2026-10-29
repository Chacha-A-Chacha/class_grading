import { z } from "zod";
import { requireAdmin } from "@/server/auth/http";
import { getDatabase } from "@/server/db";
import { bodyJson, endpoint, json } from "@/server/http";
import { correctStudent } from "@/server/students/service";

export const POST = endpoint(async (request) => {
  const admin = await requireAdmin();
  const input = z.object({ id: z.string().uuid(), displayName: z.string().max(200), admissionNumber: z.string().max(80).nullable(), reason: z.string().trim().min(5, "Give a reason of at least 5 characters.").max(1000) }).parse(await bodyJson(request));
  await correctStudent(getDatabase(), admin.id, input.id, { displayName: input.displayName, admissionNumber: input.admissionNumber }, input.reason);
  return json({ success: true });
});
