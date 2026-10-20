import { z } from "zod";
import { requireAdmin } from "@/server/auth/http";
import { getDatabase } from "@/server/db";
import { bodyJson, endpoint, json } from "@/server/http";
import { retireQuestion } from "@/server/questions/service";

export const POST = endpoint(async (request, context: RouteContext<"/api/v1/admin/questions/[questionId]/retire">) => {
  const admin = await requireAdmin();
  const questionId = z.string().uuid().parse((await context.params).questionId);
  const { reason } = z.object({ reason: z.string().trim().min(5, "Give a reason of at least 5 characters.").max(1000) }).parse(await bodyJson(request));
  await retireQuestion(getDatabase(), admin.id, questionId, reason);
  return json({ success: true });
});
