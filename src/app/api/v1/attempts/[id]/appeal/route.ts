import { z } from "zod";
import { requireStudent } from "@/server/auth/http";
import { getDatabase } from "@/server/db";
import { bodyJson, endpoint, json } from "@/server/http";
import { requestReview } from "@/server/attempts/reviews";

export const POST = endpoint(async (request, context: RouteContext<"/api/v1/attempts/[id]/appeal">) => {
  const session = await requireStudent();
  const id = z.string().uuid().parse((await context.params).id);
  const { message } = z.object({ message: z.string().trim().min(10, "Describe the problem in at least 10 characters.").max(2000) }).parse(await bodyJson(request));
  return json(await requestReview(getDatabase(), session.userId, id, message));
});
