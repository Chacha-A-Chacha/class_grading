import { z } from "zod";
import { requireAdmin } from "@/server/auth/http";
import { getDatabase } from "@/server/db";
import { bodyJson, endpoint, json } from "@/server/http";
import { accommodationSchema } from "@/shared/assessments";
import { setAccommodation } from "@/server/assessments/service";

export const PUT = endpoint(async (request, context: RouteContext<"/api/v1/admin/assessments/[id]/accommodations">) => {
  const admin = await requireAdmin();
  const id = z.string().uuid().parse((await context.params).id);
  const raw = await bodyJson(request);
  const { expectedVersion } = z.object({ expectedVersion: z.number().int().positive() }).parse(raw);
  const a = accommodationSchema.parse(raw);
  return json(await setAccommodation(getDatabase(), admin.id, id, expectedVersion, a.assignmentId, a.extraMinutes, a.reason));
});
