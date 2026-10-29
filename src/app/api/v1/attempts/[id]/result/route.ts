import { z } from "zod";
import { requireStudent } from "@/server/auth/http";
import { getDatabase } from "@/server/db";
import { endpoint, json } from "@/server/http";
import { studentResult } from "@/server/results/service";

export const GET = endpoint(async (_request, context: RouteContext<"/api/v1/attempts/[id]/result">) => {
  const session = await requireStudent();
  const id = z.string().uuid().parse((await context.params).id);
  return json(await studentResult(getDatabase(), session.userId, id));
}, false);
