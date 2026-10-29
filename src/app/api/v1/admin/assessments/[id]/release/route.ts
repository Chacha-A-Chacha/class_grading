import { z } from "zod";
import { requireAdmin } from "@/server/auth/http";
import { getDatabase } from "@/server/db";
import { bodyJson, endpoint, json } from "@/server/http";
import { releaseResults } from "@/server/results/service";

export const POST = endpoint(async (request, context: RouteContext<"/api/v1/admin/assessments/[id]/release">) => {
  const admin = await requireAdmin();
  const id = z.string().uuid().parse((await context.params).id);
  const { confirmed } = z.object({ confirmed: z.literal(true, { error: "Confirm that students may now see their results." }) }).parse(await bodyJson(request));
  void confirmed;
  return json(await releaseResults(getDatabase(), admin.id, id));
});
