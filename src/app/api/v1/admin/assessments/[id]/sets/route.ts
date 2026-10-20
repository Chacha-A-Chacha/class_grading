import { z } from "zod";
import { requireAdmin } from "@/server/auth/http";
import { getDatabase } from "@/server/db";
import { bodyJson, endpoint, json } from "@/server/http";
import { MAX_SETS } from "@/shared/assessments";
import { generateAssessmentSets } from "@/server/assessments/service";

export const POST = endpoint(async (request, context: RouteContext<"/api/v1/admin/assessments/[id]/sets">) => {
  const admin = await requireAdmin();
  const id = z.string().uuid().parse((await context.params).id);
  const { expectedVersion, setCount } = z.object({ expectedVersion: z.number().int().positive(), setCount: z.number().int().min(1).max(MAX_SETS) }).parse(await bodyJson(request));
  // A failed generation is a normal outcome with diagnostics, not an error.
  return json(await generateAssessmentSets(getDatabase(), admin.id, id, expectedVersion, setCount));
});
