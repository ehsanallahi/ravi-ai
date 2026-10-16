import { checkDatabaseHealth } from "@ravi/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Readiness probe: 200 when the database answers, 503 otherwise. No connection details. */
export async function GET() {
  const db = await checkDatabaseHealth();
  return Response.json(
    { status: db.ok ? "ok" : "unavailable", database: db.ok ? "ok" : "unavailable" },
    { status: db.ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
