import { z } from "zod";
import { requireStudent } from "@/server/auth/http";
import { getDatabase } from "@/server/db";
import { bodyJson, endpoint, json } from "@/server/http";
import { mutationsSchema } from "@/shared/attempts";
import { saveAnswers } from "@/server/attempts/service";

export const PUT = endpoint(async (request, context: RouteContext<"/api/v1/attempts/[id]/answers">) => {
  const session = await requireStudent();
  const id = z.string().uuid().parse((await context.params).id);
  const { mutations } = z.object({ mutations: mutationsSchema.min(1) }).parse(await bodyJson(request));
  return json(await saveAnswers(getDatabase(), session.userId, id, mutations));
});
