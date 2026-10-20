import { z } from "zod";
import { requireAdmin } from "@/server/auth/http";
import { getDatabase } from "@/server/db";
import { bodyJson, endpoint, json } from "@/server/http";
import { extendAttempt } from "@/server/attempts/admin";

export const POST = endpoint(async (request, context: RouteContext<"/api/v1/attempts/[id]/extend">) => {
  const admin = await requireAdmin();
  const id = z.string().uuid().parse((await context.params).id);
  const { expectedVersion, minutes, reason } = z.object({ expectedVersion: z.number().int().positive(), minutes: z.number().int().min(1).max(240), reason: z.string().trim().min(5, "Give a reason of at least 5 characters.").max(1000) }).parse(await bodyJson(request));
  return json(await extendAttempt(getDatabase(), admin.id, id, expectedVersion, minutes, reason));
});
