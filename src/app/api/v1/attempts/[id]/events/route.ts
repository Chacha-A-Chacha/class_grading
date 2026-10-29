import { z } from "zod";
import { requireStudent } from "@/server/auth/http";
import { getDatabase } from "@/server/db";
import { bodyJson, endpoint, json } from "@/server/http";
import { awayBatchSchema } from "@/shared/monitoring";
import { recordAwayEvents } from "@/server/attempts/events";

export const POST = endpoint(async (request, context: RouteContext<"/api/v1/attempts/[id]/events">) => {
  const session = await requireStudent();
  const id = z.string().uuid().parse((await context.params).id);
  const { events } = awayBatchSchema.parse(await bodyJson(request));
  return json(await recordAwayEvents(getDatabase(), session.userId, id, events, session.id));
});
