import { z } from "zod";
import { questionSchema } from "@/shared/questions";
import { requireAdmin } from "@/server/auth/http";
import { getDatabase } from "@/server/db";
import { bodyJson, endpoint, json } from "@/server/http";
import { updateDraft } from "@/server/questions/service";

const body = z.object({ expectedVersion: z.number().int().positive(), question: questionSchema });
export const PUT = endpoint(async (request, context: RouteContext<"/api/v1/admin/questions/versions/[versionId]">) => {
  const admin = await requireAdmin();
  const versionId = z.string().uuid().parse((await context.params).versionId);
  const { expectedVersion, question } = body.parse(await bodyJson(request, 65_536));
  return json(await updateDraft(getDatabase(), admin.id, versionId, expectedVersion, question));
});
