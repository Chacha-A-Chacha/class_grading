export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Public liveness only: the process can respond. Readiness is /api/v1/health/ready.
export function GET() {
  return Response.json(
    { status: "ok" },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
