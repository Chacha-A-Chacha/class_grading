import { z } from "zod";
import { requireAdmin } from "@/server/auth/http";
import { getDatabase } from "@/server/db";
import { endpoint } from "@/server/http";
import { exportResults } from "@/server/results/service";

export const GET = endpoint(async (_request, context: RouteContext<"/api/v1/admin/assessments/[id]/export">) => {
  await requireAdmin();
  const id = z.string().uuid().parse((await context.params).id);
  const { title, csv } = await exportResults(getDatabase(), id);
  const name = title.normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").toLowerCase().slice(0, 60) || "assessment";
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}-results.csv"`, "Cache-Control": "private, no-store" } });
}, false);
