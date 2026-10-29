import { z } from "zod";
import { requireAdmin } from "@/server/auth/http";
import { getDatabase } from "@/server/db";
import { endpoint, json } from "@/server/http";
import { retryJob } from "@/server/results/rescore";

export const POST = endpoint(async (_request, context: RouteContext<"/api/v1/admin/jobs/[id]/retry">) => {
  const admin = await requireAdmin();
  const id = z.string().uuid().parse((await context.params).id);
  await retryJob(getDatabase(), admin.id, id);
  return json({ success: true });
});
