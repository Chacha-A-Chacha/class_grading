import { z } from "zod";
import { requireAdmin } from "@/server/auth/http";
import { getDatabase } from "@/server/db";
import { bodyJson, endpoint, json } from "@/server/http";
import { setReleaseHold } from "@/server/results/service";

export const PUT = endpoint(async (request, context: RouteContext<"/api/v1/admin/assessments/[id]/release-hold">) => {
  const admin = await requireAdmin();
  const id = z.string().uuid().parse((await context.params).id);
  const { held, reason } = z.object({ held: z.boolean(), reason: z.string().trim().min(5, "Give a reason of at least 5 characters.").max(1000) }).parse(await bodyJson(request));
  await setReleaseHold(getDatabase(), admin.id, id, held, reason);
  return json({ success: true });
});
