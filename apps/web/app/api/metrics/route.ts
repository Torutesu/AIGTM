import { sql } from "drizzle-orm";
import { schema } from "@aigtm/db";
import { ensureDb } from "../../../lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/metrics — Prometheus text exposition for ops monitoring.
 * Disabled unless AIGTM_METRICS_TOKEN is set; requires
 * `Authorization: Bearer <token>`. Global aggregates only (no per-org
 * breakdown — org-level labels would leak tenant topology to anyone
 * holding the token).
 */
export async function GET(req: Request) {
  const token = process.env.AIGTM_METRICS_TOKEN;
  if (!token) return new Response("not found", { status: 404 });
  const header = req.headers.get("authorization") ?? "";
  if (header !== `Bearer ${token}`) {
    return new Response("unauthorized", { status: 401 });
  }

  const handle = await ensureDb();
  const db = handle.db;

  const [
    runs,
    outbox,
    approvals,
    conversations,
    signalEvents,
    auditEvents,
    orgs,
    users,
  ] = await Promise.all([
    db
      .select({
        status: schema.runs.status,
        n: sql<number>`count(*)::int`,
        cost: sql<number>`coalesce(sum(cost_cents),0)::float`,
      })
      .from(schema.runs)
      .groupBy(schema.runs.status),
    db
      .select({ status: schema.outbox.status, n: sql<number>`count(*)::int` })
      .from(schema.outbox)
      .groupBy(schema.outbox.status),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.approvals)
      .where(sql`status = 'pending'`),
    db.select({ n: sql<number>`count(*)::int` }).from(schema.conversations),
    db.select({ n: sql<number>`count(*)::int` }).from(schema.signalEvents),
    db.select({ n: sql<number>`count(*)::int` }).from(schema.auditEvents),
    db.select({ n: sql<number>`count(*)::int` }).from(schema.organizations),
    db.select({ n: sql<number>`count(*)::int` }).from(schema.users),
  ]);

  const lines: string[] = [];
  const gauge = (name: string, help: string) =>
    lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} gauge`);
  const counter = (name: string, help: string) =>
    lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} counter`);

  counter("aigtm_runs_total", "Agent runs by terminal status.");
  for (const r of runs) lines.push(`aigtm_runs_total{status="${r.status}"} ${r.n}`);
  counter("aigtm_run_cost_cents_total", "Cumulative LLM spend in cents.");
  let cost = 0;
  for (const r of runs) cost += r.cost;
  lines.push(`aigtm_run_cost_cents_total ${cost}`);
  gauge("aigtm_outbox_rows", "Outbox rows by status (backlog visibility).");
  for (const o of outbox) lines.push(`aigtm_outbox_rows{status="${o.status}"} ${o.n}`);
  gauge("aigtm_approvals_pending", "Approvals awaiting a decision.");
  lines.push(`aigtm_approvals_pending ${approvals[0]?.n ?? 0}`);
  gauge("aigtm_conversations", "Ingested conversation records.");
  lines.push(`aigtm_conversations ${conversations[0]?.n ?? 0}`);
  gauge("aigtm_signal_events", "Detected signal events.");
  lines.push(`aigtm_signal_events ${signalEvents[0]?.n ?? 0}`);
  gauge("aigtm_audit_events", "Audit events recorded.");
  lines.push(`aigtm_audit_events ${auditEvents[0]?.n ?? 0}`);
  gauge("aigtm_organizations", "Provisioned organizations.");
  lines.push(`aigtm_organizations ${orgs[0]?.n ?? 0}`);
  gauge("aigtm_users", "Registered users.");
  lines.push(`aigtm_users ${users[0]?.n ?? 0}`);

  return new Response(lines.join("\n") + "\n", {
    headers: { "Content-Type": "text/plain; version=0.0.4" },
  });
}
