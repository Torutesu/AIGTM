import { gt, asc, sql } from "drizzle-orm";
import { schema, fetchWithTimeout, type DbHandle } from "@aigtm/db";

/**
 * Audit sink — forwards audit_events to an external webhook (SIEM-style
 * export). Enabled by AIGTM_AUDIT_WEBHOOK_URL. Delivery is at-least-once
 * and survives restarts: the watermark is durable (worker_state table),
 * advanced only after a successful POST, so a crash re-sends the batch
 * rather than dropping it.
 *
 * First run with a fresh watermark starts from "now" — no history dump.
 *
 * Payload: POST {events: AuditEvent[]} JSON.
 */

const WM_KEY = "audit_sink_watermark";

async function loadWatermark(handle: DbHandle): Promise<Date> {
  const [row] = await handle.db
    .select({ value: schema.workerState.value })
    .from(schema.workerState)
    .where(sql`${schema.workerState.key} = ${WM_KEY}`)
    .limit(1);
  const iso = (row?.value as { at?: string } | null)?.at;
  const d = iso ? new Date(iso) : null;
  if (d && !Number.isNaN(d.getTime())) return d;
  // Fresh start: anchor at the newest existing event, or the DB clock when
  // the table is empty. Must come from the DB — audit_events.created_at is
  // stamped by now(), so a host-side `new Date()` can sit ahead of the DB
  // clock and silently skip events. Persist immediately: without a durable
  // anchor every drain would re-anchor past newly inserted events and
  // nothing would ever be delivered.
  const [m] = await handle.db
    .select({
      m: sql<string>`coalesce(max(${schema.auditEvents.createdAt}), now())`,
    })
    .from(schema.auditEvents);
  const anchor = new Date(m.m);
  await saveWatermark(handle, anchor);
  return anchor;
}

async function saveWatermark(handle: DbHandle, at: Date) {
  await handle.db
    .insert(schema.workerState)
    .values({ key: WM_KEY, value: { at: at.toISOString() } })
    .onConflictDoUpdate({
      target: schema.workerState.key,
      set: { value: { at: at.toISOString() }, updatedAt: new Date() },
    });
}

export async function drainAuditSink(handle: DbHandle): Promise<number> {
  const url = process.env.AIGTM_AUDIT_WEBHOOK_URL;
  if (!url) return 0;
  const watermark = await loadWatermark(handle);
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
  // advance only after a confirmed delivery — crash → batch re-sent
  await saveWatermark(handle, events[events.length - 1].createdAt);
  return events.length;
}
