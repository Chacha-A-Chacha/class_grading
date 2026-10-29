import { z } from "zod";
import { requireAdmin } from "@/server/auth/http";
import { getDatabase } from "@/server/db";
import { endpoint, json } from "@/server/http";
import { exclusionPreview } from "@/server/results/rescore";

export const GET = endpoint(async (request, context: RouteContext<"/api/v1/admin/assessments/[id]/exclusions/preview">) => {
  await requireAdmin();
  const id = z.string().uuid().parse((await context.params).id);
  const versionId = z.string().uuid("Choose a question.").parse(new URL(request.url).searchParams.get("versionId"));
  return json(await exclusionPreview(getDatabase(), id, versionId));
}, false);
