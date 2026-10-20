import { z } from "zod";
import { requireAdmin } from "@/server/auth/http";
import { getDatabase } from "@/server/db";
import { bodyJson, endpoint, json } from "@/server/http";
import { detailsSchema } from "@/shared/assessments";
import { updateDetails } from "@/server/assessments/service";

export const PUT = endpoint(async (request, context: RouteContext<"/api/v1/admin/assessments/[id]">) => {
  const admin = await requireAdmin();
  const id = z.string().uuid().parse((await context.params).id);
  const { expectedVersion, details } = z.object({ expectedVersion: z.number().int().positive(), details: detailsSchema }).parse(await bodyJson(request));
  return json(await updateDetails(getDatabase(), admin.id, id, expectedVersion, details));
});
