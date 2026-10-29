import { z } from "zod";
import { requireAdmin } from "@/server/auth/http";
import { getDatabase } from "@/server/db";
import { bodyJson, endpoint, json } from "@/server/http";
import { fromNairobiInput } from "@/shared/assessments";
import { addToPublished } from "@/server/assessments/assignments";

const local = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Choose a date and time.");
export const POST = endpoint(async (request, context: RouteContext<"/api/v1/admin/assessments/[id]/assignments">) => {
  const admin = await requireAdmin();
  const id = z.string().uuid().parse((await context.params).id);
  const body = z.object({
    userIds: z.array(z.string().uuid()).min(1, "Choose at least one student.").max(1000),
    reason: z.string().trim().min(5, "Give a reason of at least 5 characters.").max(1000),
    late: z.object({ latestStartAt: local, hardCloseAt: local }).nullish(),
  }).parse(await bodyJson(request));
  const late = body.late ? { latestStartAt: fromNairobiInput(body.late.latestStartAt), hardCloseAt: fromNairobiInput(body.late.hardCloseAt) } : undefined;
  return json(await addToPublished(getDatabase(), admin.id, id, body.userIds, body.reason, late));
});
