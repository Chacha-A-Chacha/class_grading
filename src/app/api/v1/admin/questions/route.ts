import { questionSchema } from "@/shared/questions";
import { requireAdmin } from "@/server/auth/http";
import { getDatabase } from "@/server/db";
import { bodyJson, endpoint, json } from "@/server/http";
import { createQuestion } from "@/server/questions/service";

export const POST = endpoint(async (request) => {
  const admin = await requireAdmin();
  const input = questionSchema.parse(await bodyJson(request, 65_536));
  return json(await createQuestion(getDatabase(), admin.id, input), 201);
});
