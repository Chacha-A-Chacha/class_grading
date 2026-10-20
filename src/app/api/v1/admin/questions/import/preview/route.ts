import { importSchema, validateImport } from "@/shared/questions";
import { requireAdmin } from "@/server/auth/http";
import { bodyJson, endpoint, json } from "@/server/http";

// Validation only: nothing is written until commit.
export const POST = endpoint(async (request) => {
  await requireAdmin();
  const items = importSchema.parse(await bodyJson(request, 2_097_152));
  return json({ report: validateImport(items).report });
});
