import { studentSchema } from "@/shared/students";
import { requireAdmin } from "@/server/auth/http";
import { getDatabase } from "@/server/db";
import { bodyJson, endpoint, json } from "@/server/http";
import { addStudent } from "@/server/students/service";

export const POST = endpoint(async (request) => {
  const admin = await requireAdmin();
  const input = studentSchema.parse(await bodyJson(request));
  const student = await addStudent(getDatabase(), admin.id, input);
  return json({ id: student.id }, 201);
});
