export const dynamic = "force-dynamic";

/** Liveness probe. Deliberately reveals nothing about configuration or dependencies. */
export function GET() {
  return Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
}
