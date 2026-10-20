import { z } from "zod";
import { requireAdmin } from "@/server/auth/http";
import { getDatabase } from "@/server/db";
import { bodyJson, endpoint, json } from "@/server/http";
import { blueprintSchema } from "@/shared/assessments";
import { saveBlueprint } from "@/server/assessments/service";

export const PUT = endpoint(async (request, context: RouteContext<"/api/v1/admin/assessments/[id]/blueprint">) => {
  const admin = await requireAdmin();
  const id = z.string().uuid().parse((await context.params).id);
  const { expectedVersion, slots } = z.object({ expectedVersion: z.number().int().positive(), slots: blueprintSchema }).parse(await bodyJson(request, 65_536));
  return json(await saveBlueprint(getDatabase(), admin.id, id, expectedVersion, slots));
});
