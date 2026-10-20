import { z } from "zod";
import { requireAdmin } from "@/server/auth/http";
import { getDatabase } from "@/server/db";
import { bodyJson, endpoint, json } from "@/server/http";
import { activateDraft } from "@/server/questions/service";

export const POST = endpoint(async (request, context: RouteContext<"/api/v1/admin/questions/versions/[versionId]/activate">) => {
  const admin = await requireAdmin();
  const versionId = z.string().uuid().parse((await context.params).versionId);
  const { expectedVersion } = z.object({ expectedVersion: z.number().int().positive() }).parse(await bodyJson(request));
  return json(await activateDraft(getDatabase(), admin.id, versionId, expectedVersion));
});
