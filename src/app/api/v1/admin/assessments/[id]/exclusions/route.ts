import { z } from "zod";
import { requireAdmin } from "@/server/auth/http";
import { getDatabase } from "@/server/db";
import { bodyJson, endpoint, json } from "@/server/http";
import { excludeQuestion } from "@/server/results/rescore";

export const POST = endpoint(async (request, context: RouteContext<"/api/v1/admin/assessments/[id]/exclusions">) => {
  const admin = await requireAdmin();
  const id = z.string().uuid().parse((await context.params).id);
  const { questionVersionId, reason, confirmed } = z.object({
    questionVersionId: z.string().uuid("Choose a question."),
    reason: z.string().trim().min(5, "Give a reason of at least 5 characters.").max(1000),
    confirmed: z.literal(true, { error: "Confirm that you checked the preview." }),
  }).parse(await bodyJson(request));
  void confirmed;
  return json(await excludeQuestion(getDatabase(), admin.id, id, questionVersionId, reason));
});
