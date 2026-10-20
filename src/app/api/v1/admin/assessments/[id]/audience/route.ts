import { z } from "zod";
import { requireAdmin } from "@/server/auth/http";
import { getDatabase } from "@/server/db";
import { bodyJson, endpoint, json } from "@/server/http";
import { setAudience } from "@/server/assessments/service";

const body = z.object({ expectedVersion: z.number().int().positive(), all: z.boolean().default(false), userIds: z.array(z.string().uuid()).max(5000).default([]) });
export const PUT = endpoint(async (request, context: RouteContext<"/api/v1/admin/assessments/[id]/audience">) => {
  const admin = await requireAdmin();
  const id = z.string().uuid().parse((await context.params).id);
  const { expectedVersion, all, userIds } = body.parse(await bodyJson(request, 262_144));
  return json(await setAudience(getDatabase(), admin.id, id, expectedVersion, all ? "all" : userIds));
});
