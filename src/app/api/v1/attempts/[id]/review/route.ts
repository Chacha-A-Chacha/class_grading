import { z } from "zod";
import { requireStudent } from "@/server/auth/http";
import { getDatabase } from "@/server/db";
import { bodyJson, endpoint, json } from "@/server/http";
import { setMarkedForReview } from "@/server/attempts/service";

export const PUT = endpoint(async (request, context: RouteContext<"/api/v1/attempts/[id]/review">) => {
  const session = await requireStudent();
  const id = z.string().uuid().parse((await context.params).id);
  const { attemptQuestionId, marked } = z.object({ attemptQuestionId: z.string().uuid(), marked: z.boolean() }).parse(await bodyJson(request));
  return json(await setMarkedForReview(getDatabase(), session.userId, id, attemptQuestionId, marked, session.id));
});
