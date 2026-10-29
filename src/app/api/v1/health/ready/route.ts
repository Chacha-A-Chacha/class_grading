import { getDatabase } from "@/server/db";
import { readiness } from "@/server/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Public readiness: database reachable and migrations current. Liveness stays at /health/live.
export async function GET() {
  const result = await readiness(getDatabase()).catch(() => ({ ready: false as const, reason: "database" as const }));
  return Response.json(result.ready ? { status: "ready" } : { status: "not_ready", reason: result.reason }, { status: result.ready ? 200 : 503, headers: { "Cache-Control": "private, no-store" } });
}
