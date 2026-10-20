import { z } from "zod";
import { importSchema } from "@/shared/questions";
import { requireAdmin } from "@/server/auth/http";
import { getDatabase } from "@/server/db";
import { bodyJson, endpoint, json } from "@/server/http";
import { commitImport } from "@/server/questions/service";

export const POST = endpoint(async (request) => {
  const admin = await requireAdmin();
  const { key, questions } = z.object({ key: z.string().uuid(), questions: importSchema }).parse(await bodyJson(request, 2_097_152));
  return json(await commitImport(getDatabase(), admin.id, key, questions));
});
