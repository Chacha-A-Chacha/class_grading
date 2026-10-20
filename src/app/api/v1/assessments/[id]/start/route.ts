import { z } from "zod";
import { requireStudent } from "@/server/auth/http";
import { getDatabase } from "@/server/db";
import { bodyJson, endpoint, json } from "@/server/http";
import { startAttempt } from "@/server/attempts/service";

export const POST = endpoint(async (request, context: RouteContext<"/api/v1/assessments/[id]/start">) => {
  const session = await requireStudent();
  const id = z.string().uuid().parse((await context.params).id);
  const { startRequestId, rulesVersion } = z.object({ startRequestId: z.string().uuid(), rulesVersion: z.string().min(1).max(80) }).parse(await bodyJson(request));
  return json(await startAttempt(getDatabase(), session.userId, session.id, id, startRequestId, rulesVersion));
});
