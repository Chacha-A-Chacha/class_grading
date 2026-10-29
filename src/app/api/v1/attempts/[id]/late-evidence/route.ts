import { z } from "zod";
import { requireStudent } from "@/server/auth/http";
import { getDatabase } from "@/server/db";
import { bodyJson, endpoint, json } from "@/server/http";
import { lateEvidenceSchema } from "@/shared/attempts";
import { recordLateEvidence } from "@/server/attempts/service";

export const POST = endpoint(async (request, context: RouteContext<"/api/v1/attempts/[id]/late-evidence">) => {
  const session = await requireStudent();
  const id = z.string().uuid().parse((await context.params).id);
  const { items } = lateEvidenceSchema.parse(await bodyJson(request, 131_072));
  return json(await recordLateEvidence(getDatabase(), session.userId, id, items, session.id));
});
