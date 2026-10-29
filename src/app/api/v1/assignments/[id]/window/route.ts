import { z } from "zod";
import { requireAdmin } from "@/server/auth/http";
import { getDatabase } from "@/server/db";
import { bodyJson, endpoint, json } from "@/server/http";
import { fromNairobiInput } from "@/shared/assessments";
import { giveNewWindow } from "@/server/assessments/assignments";

const local = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Choose a date and time.");
export const POST = endpoint(async (request, context: RouteContext<"/api/v1/assignments/[id]/window">) => {
  const admin = await requireAdmin();
  const id = z.string().uuid().parse((await context.params).id);
  const body = z.object({ expectedVersion: z.number().int().positive(), latestStartAt: local, hardCloseAt: local, reason: z.string().trim().min(5, "Give a reason of at least 5 characters.").max(1000) }).parse(await bodyJson(request));
  await giveNewWindow(getDatabase(), admin.id, id, body.expectedVersion, fromNairobiInput(body.latestStartAt), fromNairobiInput(body.hardCloseAt), body.reason);
  return json({ success: true });
});
