import { z } from "zod";
import { requireAdmin } from "@/server/auth/http";
import { getDatabase } from "@/server/db";
import { endpoint, json } from "@/server/http";
import { reviseQuestion } from "@/server/questions/service";

export const POST = endpoint(async (_request, context: RouteContext<"/api/v1/admin/questions/[questionId]/revise">) => {
  const admin = await requireAdmin();
  const questionId = z.string().uuid().parse((await context.params).questionId);
  return json(await reviseQuestion(getDatabase(), admin.id, questionId));
});
