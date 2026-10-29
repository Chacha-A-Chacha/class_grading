import { z } from "zod";
import { requireStudent } from "@/server/auth/http";
import { getDatabase } from "@/server/db";
import { bodyJson, endpoint, json } from "@/server/http";
import { mutationsSchema } from "@/shared/attempts";
import { submitAttempt } from "@/server/attempts/service";

export const POST = endpoint(async (request, context: RouteContext<"/api/v1/attempts/[id]/submit">) => {
  const session = await requireStudent();
  const id = z.string().uuid().parse((await context.params).id);
  const { submissionId, mutations } = z.object({ submissionId: z.string().uuid(), mutations: mutationsSchema.default([]) }).parse(await bodyJson(request));
  return json(await submitAttempt(getDatabase(), session.userId, id, submissionId, mutations, session.id));
});
