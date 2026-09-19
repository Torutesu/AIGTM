import { gt, asc } from "drizzle-orm";
import { schema, fetchWithTimeout, type DbHandle } from "@aigtm/db";

/**
 * Audit sink — forwards audit_events to an external webhook (SIEM-style
 * export). Enabled by AIGTM_AUDIT_WEBHOOK_URL; delivery is at-least-once:
 * the watermark is in-memory so a worker restart resumes from "now"
 * (events during downtime are NOT replayed — restart gaps are logged via
 * worker.tick and the events remain queryable in the DB).
 *
 * Payload: POST {events: AuditEvent[]} JSON.
 */

let watermark: Date | null = null;

export function resetAuditSinkForTest() {
  watermark = null;
}

export async function drainAuditSink(handle: DbHandle): Promise<number> {
  const url = process.env.AIGTM_AUDIT_WEBHOOK_URL;
  if (!url) return 0;
  if (!watermark) watermark = new Date(); // start from now — no history dump
  const events = await handle.db
    .select()
    .from(schema.auditEvents)
    .where(gt(schema.auditEvents.createdAt, watermark))
    .orderBy(asc(schema.auditEvents.createdAt))
    .limit(200);
  if (!events.length) return 0;
  const res = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events }),
    },
    10_000,
  );
  if (!res.ok) {
    throw new Error(`audit sink ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  watermark = events[events.length - 1].createdAt;
  return events.length;
}
