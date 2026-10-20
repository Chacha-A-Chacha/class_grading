export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Public liveness only; database readiness is added with persistence.
export function GET() {
  return Response.json(
    { status: "ok" },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
