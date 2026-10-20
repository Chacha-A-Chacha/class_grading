import { z } from "zod";
import { requireAdmin } from "@/server/auth/http";
import { getDatabase } from "@/server/db";
import { bodyJson, endpoint, json } from "@/server/http";
import { publishAssessment } from "@/server/assessments/service";

export const POST = endpoint(async (request, context: RouteContext<"/api/v1/admin/assessments/[id]/publish">) => {
  const admin = await requireAdmin();
  const id = z.string().uuid().parse((await context.params).id);
  const { expectedVersion, confirmed } = z.object({ expectedVersion: z.number().int().positive(), confirmed: z.literal(true, { error: "Confirm that you previewed the sets and checked the schedule." }) }).parse(await bodyJson(request));
  void confirmed;
  await publishAssessment(getDatabase(), admin.id, id, expectedVersion);
  return json({ success: true });
});
