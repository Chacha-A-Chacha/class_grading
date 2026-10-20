import { z } from "zod";
import { requireStudent } from "@/server/auth/http";
import { getDatabase } from "@/server/db";
import { endpoint, json } from "@/server/http";
import { heartbeat } from "@/server/attempts/service";

export const POST = endpoint(async (_request, context: RouteContext<"/api/v1/attempts/[id]/heartbeat">) => {
  const session = await requireStudent();
  const id = z.string().uuid().parse((await context.params).id);
  return json(await heartbeat(getDatabase(), session.userId, id));
});
