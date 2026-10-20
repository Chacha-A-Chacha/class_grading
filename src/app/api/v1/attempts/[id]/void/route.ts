import { z } from "zod";
import { requireAdmin } from "@/server/auth/http";
import { getDatabase } from "@/server/db";
import { bodyJson, endpoint, json } from "@/server/http";
import { voidAttempt } from "@/server/attempts/admin";

export const POST = endpoint(async (request, context: RouteContext<"/api/v1/attempts/[id]/void">) => {
  const admin = await requireAdmin();
  const id = z.string().uuid().parse((await context.params).id);
  const { expectedVersion, reason } = z.object({ expectedVersion: z.number().int().positive(), reason: z.string().trim().min(5, "Give a reason of at least 5 characters.").max(1000) }).parse(await bodyJson(request));
  await voidAttempt(getDatabase(), admin.id, id, expectedVersion, reason);
  return json({ success: true });
});
