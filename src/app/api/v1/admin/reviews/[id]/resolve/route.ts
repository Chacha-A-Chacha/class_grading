import { z } from "zod";
import { requireAdmin } from "@/server/auth/http";
import { getDatabase } from "@/server/db";
import { bodyJson, endpoint, json } from "@/server/http";
import { DISPOSITIONS, resolveReview } from "@/server/attempts/reviews";

export const POST = endpoint(async (request, context: RouteContext<"/api/v1/admin/reviews/[id]/resolve">) => {
  const admin = await requireAdmin();
  const id = z.string().uuid().parse((await context.params).id);
  const { disposition, resolution } = z.object({ disposition: z.enum(DISPOSITIONS, { error: "Choose an outcome." }), resolution: z.string().trim().min(5, "Give a reason of at least 5 characters.").max(2000) }).parse(await bodyJson(request));
  await resolveReview(getDatabase(), admin.id, id, disposition, resolution);
  return json({ success: true });
});
