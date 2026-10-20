import { detailsSchema } from "@/shared/assessments";
import { requireAdmin } from "@/server/auth/http";
import { getDatabase } from "@/server/db";
import { bodyJson, endpoint, json } from "@/server/http";
import { createAssessment } from "@/server/assessments/service";

export const POST = endpoint(async (request) => {
  const admin = await requireAdmin();
  return json(await createAssessment(getDatabase(), admin.id, detailsSchema.parse(await bodyJson(request))), 201);
});
