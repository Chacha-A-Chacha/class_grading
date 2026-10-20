import { z } from "zod";
import { requireAdmin } from "@/server/auth/http";
import { getDatabase } from "@/server/db";
import { bodyJson, endpoint, json } from "@/server/http";
import { commitImport } from "@/server/students/service";

export const POST = endpoint(async (request) => {
  const admin = await requireAdmin();
  const { id, selected } = z.object({ id: z.string().uuid(), selected: z.array(z.number().int().min(2).max(1001)).min(1).max(1000) }).parse(await bodyJson(request));
  return json(await commitImport(getDatabase(), admin.id, id, selected));
});
