import { sql } from "drizzle-orm";
import { ensureDb } from "../../../lib/db";

export const dynamic = "force-dynamic";

/**
 * Liveness/readiness probe. Returns 200 when the DB answers, 503 otherwise.
 * No auth — intended for load balancers and uptime checks only.
 */
export async function GET() {
  try {
    const handle = await ensureDb();
    await handle.db.execute(sql`select 1`);
    return Response.json({ ok: true, db: "up" });
  } catch {
    return Response.json({ ok: false, db: "down" }, { status: 503 });
  }
}
