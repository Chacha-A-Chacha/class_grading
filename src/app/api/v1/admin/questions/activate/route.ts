import { z } from "zod";
import { requireAdmin } from "@/server/auth/http";
import { getDatabase } from "@/server/db";
import { bodyJson, endpoint, json } from "@/server/http";
import { activateDrafts, MAX_BULK_ACTIVATION } from "@/server/questions/service";

const body = z.object({
  confirmed: z.literal(true, { error: "Confirm that these questions were reviewed before uploading." }),
  items: z.array(z.object({ versionId: z.string().uuid(), expectedVersion: z.number().int().positive() })).min(1).max(MAX_BULK_ACTIVATION, `Activate at most ${MAX_BULK_ACTIVATION} questions at a time; narrow the filter.`),
});
export const POST = endpoint(async (request) => {
  const admin = await requireAdmin();
  const { items } = body.parse(await bodyJson(request, 65_536));
  return json(await activateDrafts(getDatabase(), admin.id, items));
});
