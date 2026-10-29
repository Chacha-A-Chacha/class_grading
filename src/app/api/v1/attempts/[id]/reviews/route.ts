import { z } from "zod";
import { requireAdmin } from "@/server/auth/http";
import { getDatabase } from "@/server/db";
import { bodyJson, endpoint, json } from "@/server/http";
import { openReview } from "@/server/attempts/reviews";

export const POST = endpoint(async (request, context: RouteContext<"/api/v1/attempts/[id]/reviews">) => {
  const admin = await requireAdmin();
  const id = z.string().uuid().parse((await context.params).id);
  const { reason } = z.object({ reason: z.string().trim().min(5, "Give a reason of at least 5 characters.").max(1000) }).parse(await bodyJson(request));
  return json(await openReview(getDatabase(), admin.id, id, reason));
});
