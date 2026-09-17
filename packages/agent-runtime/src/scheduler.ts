import { desc, eq, gt } from "drizzle-orm";
import {
  schema,
  withOrg,
  type DbHandle,
  type OrgContext,
} from "@aigtm/db";
import { parseAgentSpec } from "@aigtm/specs";
import { executeRun } from "./runner";
import { routerForOrg, type ModelRouter } from "./model";

/* ------------------------------------------------------------------ */
/* Minimal cron matcher — 5 fields "min hour dom month dow".            */
/* Supports *, */ /* n, ranges a-b, lists a,b,c, MON..SUN / JAN..DEC.  */
/* ------------------------------------------------------------------ */

const MONTHS: Record<string, number> = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6,
  JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12,
};
const DAYS: Record<string, number> = {
  SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6,
};

function fieldValues(field: string, min: number, max: number, names?: Record<string, number>): Set<number> {
  const out = new Set<number>();
  for (const part of field.split(",")) {
    const p = part.trim().toUpperCase();
    const resolve = (s: string) => (names && names[s] !== undefined ? names[s] : Number(s));
    const [rangePart, stepPart] = p.split("/");
    const step = stepPart ? Number(stepPart) : 1;
    if (!Number.isFinite(step) || step < 1) return out;
    let lo = min;
    let hi = max;
    if (rangePart === "*" || rangePart === "") {
      // full range
    } else if (rangePart.includes("-")) {
      const [a, b] = rangePart.split("-").map(resolve);
      lo = a;
      hi = b;
    } else {
      lo = hi = resolve(rangePart);
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) continue;
    for (let v = lo; v <= hi; v += step) {
      if (v >= min && v <= max) out.add(v);
    }
  }
  return out;
}

/** Cron fields are interpreted in UTC — deterministic across hosts. */
export function cronMatches(expr: string, date: Date): boolean {
  const f = expr.trim().split(/\s+/);
  if (f.length !== 5) return false;
  const [min, hour, dom, mon, dow] = f;
  const minute = date.getUTCMinutes();
  const hr = date.getUTCHours();
  const dayOfMonth = date.getUTCDate();
  const month = date.getUTCMonth() + 1;
  const dayOfWeek = date.getUTCDay();
  if (!fieldValues(min, 0, 59).has(minute)) return false;
  if (!fieldValues(hour, 0, 23).has(hr)) return false;
  if (!fieldValues(mon, 1, 12, MONTHS).has(month)) return false;
  // standard cron semantics: dom restricted AND dow restricted → OR them
  const domRestricted = dom !== "*";
  const dowRestricted = dow !== "*";
  const domSet = fieldValues(dom, 1, 31);
  const dowSetRaw = fieldValues(dow, 0, 7, DAYS);
  const dowSet = new Set([...dowSetRaw].map((d) => (d === 7 ? 0 : d)));
  if (domRestricted && dowRestricted) {
    return domSet.has(dayOfMonth) || dowSet.has(dayOfWeek);
  }
  if (domRestricted) return domSet.has(dayOfMonth);
  if (dowRestricted) return dowSet.has(dayOfWeek);
  return true;
}

/** Most recent minute-aligned instant <= now where the cron matches. */
export function lastCronOccurrence(
  expr: string,
  now: Date,
  maxScanMinutes = 8 * 24 * 60,
): Date | null {
  const t = new Date(Math.floor(now.getTime() / 60000) * 60000);
  for (let i = 0; i < maxScanMinutes; i++) {
    if (cronMatches(expr, t)) return new Date(t);
    t.setTime(t.getTime() - 60000);
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Scheduler tick: find due scheduled/event agents and execute them.    */
/* ------------------------------------------------------------------ */

interface DueWork {
  agentId: string;
  triggerKind: "schedule" | "event";
  triggerContext?: Record<string, unknown>;
}

/** How many runs were launched. Each org scanned in isolation. */
export async function tick(
  handle: DbHandle,
  opts: { now?: Date; router?: ModelRouter } = {},
): Promise<number> {
  const now = opts.now ?? new Date();
  const orgs = (await handle.db
    .select({ id: schema.organizations.id })
    .from(schema.organizations)) as { id: string }[];

  let launched = 0;
  for (const org of orgs) {
    const ctx: OrgContext = { orgId: org.id, actorType: "system" };
    const due = await withOrg(handle, ctx, async (tx) => {
      const work: DueWork[] = [];
      const agents = (await tx
        .select()
        .from(schema.agents)
        .where(eq(schema.agents.enabled, true))) as {
        id: string;
        name: string;
        spec: unknown;
      }[];

      for (const agent of agents) {
        let spec;
        try {
          spec = parseAgentSpec(agent.spec);
        } catch {
          continue; // invalid spec — skip rather than kill the tick
        }
        const trig = spec.trigger;
        const lastRuns = (await tx
          .select({
            startedAt: schema.runs.startedAt,
            triggerKind: schema.runs.triggerKind,
            triggerContext: schema.runs.triggerContext,
          })
          .from(schema.runs)
          .where(eq(schema.runs.agentId, agent.id))
          .orderBy(desc(schema.runs.startedAt))
          .limit(200)) as {
          startedAt: Date;
          triggerKind: string;
          triggerContext: Record<string, unknown> | null;
        }[];

        if (trig.type === "schedule" && trig.schedule) {
          const occ = lastCronOccurrence(trig.schedule, now);
          // idempotent per occurrence: skip if a run already carries this
          // occurrence's `scheduledFor`, or a schedule run started after it
          if (occ) {
            const occIso = occ.toISOString();
            // idempotent per occurrence: fire only when this occurrence is
            // newer than every previously-launched scheduledFor
            const lastScheduledFor = lastRuns
              .filter((r) => r.triggerKind === "schedule")
              .map((r) => String(r.triggerContext?.scheduledFor ?? ""))
              .filter(Boolean)
              .sort()
              .pop();
            if (!lastScheduledFor || occIso > lastScheduledFor) {
              work.push({
                agentId: agent.id,
                triggerKind: "schedule",
                triggerContext: { scheduledFor: occIso, cron: trig.schedule },
              });
            }
          }
        } else if (trig.type === "event") {
          const eventName = trig.event ?? (trig as { on?: string }).on;
          if (eventName === "signal_event") {
            const lastEventRun = lastRuns.find((r) => r.triggerKind === "event");
            const events = (await tx
              .select()
              .from(schema.signalEvents)
              .where(
                lastEventRun
                  ? gt(schema.signalEvents.detectedAt, lastEventRun.startedAt)
                  : undefined,
              )) as {
              id: string;
              accountId: string | null;
              signalId: string | null;
              score: string | null;
            }[];
            const fired = new Set(
              lastRuns
                .map((r) => r.triggerContext?.signalEventId)
                .filter(Boolean) as string[],
            );
            const gte = Number(trig.where?.score_gte ?? 0);
            for (const ev of events) {
              if (fired.has(ev.id)) continue;
              if (Number(ev.score ?? 0) < gte) continue;
              work.push({
                agentId: agent.id,
                triggerKind: "event",
                triggerContext: {
                  signalEventId: ev.id,
                  accountId: ev.accountId,
                  signalId: ev.signalId,
                  score: ev.score,
                },
              });
            }
          }
        }
      }
      return work;
    });

    // BYOK: resolve each org's provider config; opts.router overrides (tests).
    const router = opts.router ?? (await routerForOrg(handle, org.id));
    for (const w of due) {
      const res = await executeRun(
        handle,
        ctx,
        {
          agentId: w.agentId,
          triggerKind: w.triggerKind,
          triggerContext: w.triggerContext,
        },
        router,
      );
      launched++;
      if (res.status !== "fulfilled") {
        console.warn(`[worker] run ${res.runId} for agent ${w.agentId}: ${res.status}`);
      }
    }
  }
  return launched;
}
