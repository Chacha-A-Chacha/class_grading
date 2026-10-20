import { z } from "zod";
import { requireAdmin } from "@/server/auth/http";
import { getDatabase } from "@/server/db";
import { bodyJson, endpoint, json } from "@/server/http";
import { deleteDraftAssessment } from "@/server/assessments/service";

export const POST = endpoint(async (request, context: RouteContext<"/api/v1/admin/assessments/[id]/delete">) => {
  const admin = await requireAdmin();
  const id = z.string().uuid().parse((await context.params).id);
  const { expectedVersion } = z.object({ expectedVersion: z.number().int().positive() }).parse(await bodyJson(request));
  await deleteDraftAssessment(getDatabase(), admin.id, id, expectedVersion);
  return json({ success: true });
});
