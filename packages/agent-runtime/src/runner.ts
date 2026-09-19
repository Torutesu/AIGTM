import { and, eq, gte, sql } from "drizzle-orm";
import {
  schema,
  withOrg,
  audit,
  type DbHandle,
  type OrgContext,
} from "@aigtm/db";
import { parseAgentSpec, type AgentSpec } from "@aigtm/specs";
import { ModelRouter, estimateCostCents } from "./model";
import { logEvent } from "./log";
import { tools } from "./tools";

export interface ExecuteRunOptions {
  agentId?: string;
  spec?: AgentSpec;
  triggerKind: "manual" | "schedule" | "event" | "api";
  triggerContext?: Record<string, unknown>;
  actorId?: string;
}

/**
 * Per-run spend brake in cents. 0 = unlimited. When set, a run that would
 * exceed the ceiling is rejected before its next LLM step — the run row
 * records the partial cost so the overspend is auditable.
 */
export function runCostLimitCents(): number {
  return Number(process.env.AIGTM_RUN_COST_LIMIT_CENTS ?? 0);
}

/**
 * Execute one agent spec end to end:
 *   run → steps (tool | llm) → act → outbox → approval → learn → audit
 * Phase 0 in-process runner; the same interface will sit behind a durable
 * executor (Trigger.dev/Temporal) later.
 */
export async function executeRun(
  handle: DbHandle,
  ctx: OrgContext,
  opts: ExecuteRunOptions,
  router = new ModelRouter(),
) {
  const runId = crypto.randomUUID();
  try {
    return await withOrg(handle, { ...ctx, actorType: ctx.actorType ?? "user" }, async (tx) => {
    // 1. resolve spec
    let spec: AgentSpec;
    let agentId = opts.agentId;
    if (opts.spec) {
      spec = opts.spec;
    } else {
      const [agent] = await tx
        .select()
        .from(schema.agents)
        .where(eq(schema.agents.id, agentId!))
        .limit(1);
      if (!agent) throw new Error(`agent not found: ${agentId}`);
      if (!agent.enabled) throw new Error(`agent disabled: ${agentId}`);
      spec = parseAgentSpec(agent.spec);
      agentId = agent.id;
    }
    if (!agentId) throw new Error("executeRun requires agentId or spec");

    // 2. open run
    const [run] = await tx
      .insert(schema.runs)
      .values({
        id: runId,
        orgId: ctx.orgId,
        agentId,
        triggerKind: opts.triggerKind,
        triggerContext: opts.triggerContext ?? null,
        status: "running",
      })
      .returning();
    await audit(tx, ctx, {
      action: "run.started",
      entityType: "run",
      entityId: run.id,
      detail: { agentId, triggerKind: opts.triggerKind, specName: spec.name },
    });

    const context: Record<string, unknown> = {
      trigger: opts.triggerContext ?? {},
      steps: {} as Record<string, unknown>,
    };
    let stepsDone = 0;
    let tokensIn = 0,
      tokensOut = 0,
      costCents = 0;
    const runStart = Date.now();
    const costLimit = runCostLimitCents();

    // Org monthly budget: sum this month's run spend once; combined with
    // in-run accumulation it stops the org from overshooting mid-run.
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const [orgRow] = await tx
      .select({ budget: schema.organizations.budgetMonthlyCents })
      .from(schema.organizations)
      .where(eq(schema.organizations.id, ctx.orgId))
      .limit(1);
    const orgBudget = orgRow?.budget ?? null;
    let monthSpent = 0;
    if (orgBudget != null && orgBudget > 0) {
      const [s] = await tx
        .select({
          total: sql<string>`coalesce(sum(${schema.runs.costCents}), 0)`,
        })
        .from(schema.runs)
        .where(
          and(
            eq(schema.runs.orgId, ctx.orgId),
            gte(schema.runs.startedAt, monthStart),
          ),
        );
      monthSpent = Number(s?.total ?? 0);
    }

    // 3. steps
    try {
      for (const step of spec.steps) {
        try {
          if (costLimit > 0 && costCents > costLimit) {
            throw new Error(
              `cost ceiling exceeded: ${costCents.toFixed(2)}¢ > ${costLimit}¢`,
            );
          }
          if (
            orgBudget != null &&
            orgBudget > 0 &&
            monthSpent + costCents > orgBudget
          ) {
            throw new Error(
              `org monthly budget exceeded: ${(monthSpent + costCents).toFixed(0)}¢ > ${orgBudget}¢`,
            );
          }
          let output: unknown;
          let model: string | null = null;
          let stepIn = 0,
            stepOut = 0,
            latency = 0;
          const start = Date.now();

          if (step.kind === "tool") {
            const fn = tools[step.tool!];
            if (!fn) throw new Error(`tool not in allowlist: ${step.tool}`);
            output = await fn(tx, ctx.orgId, resolveInput(step.input, context));
            latency = Date.now() - start;
          } else {
            const res = await router.complete(step, context);
            output = res.output;
            model = res.model;
            stepIn = res.tokensIn;
            stepOut = res.tokensOut;
            latency = res.latencyMs;
          }

          (context.steps as Record<string, unknown>)[step.id] = output;
          stepsDone += 1;
          tokensIn += stepIn;
          tokensOut += stepOut;
          costCents += estimateCostCents(model, stepIn, stepOut);

          await tx.insert(schema.runSteps).values({
            orgId: ctx.orgId,
            runId: run.id,
            stepId: step.id,
            kind: step.kind,
            model,
            tool: step.tool ?? null,
            input: step.input,
            output: output as object,
            tokensIn: stepIn,
            tokensOut: stepOut,
            latencyMs: latency,
            status: "fulfilled",
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          await tx.insert(schema.runSteps).values({
            orgId: ctx.orgId,
            runId: run.id,
            stepId: step.id,
            kind: step.kind,
            tool: step.tool ?? null,
            input: step.input,
            status: "rejected",
            error: message,
          });
          throw err;
        }
      }

      // 3b. optional LLM-judge eval (AIGTM_EVAL_LLM_JUDGE=1): a cheap model
      // scores run quality 0-1 → evalScore. Ratio-of-steps remains the
      // default; judge failures fall back to it silently.
      let judgeScore: number | null = null;
      if (process.env.AIGTM_EVAL_LLM_JUDGE === "1") {
        try {
          const jres = await router.complete(
            {
              id: "eval_judge",
              kind: "llm",
              model: "fast",
              prompt:
                `Score 0.0-1.0 how well this agent run achieved its goal.\n` +
                `Goal: ${spec.description || spec.name}\n` +
                `Step outputs (JSON): ${JSON.stringify(context.steps).slice(0, 4000)}\n` +
                `Return ONLY the numeric score.`,
              input: {},
              output: { score: "string" },
            },
            context,
          );
          const s = Number.parseFloat(
            String((jres.output as Record<string, unknown>).score ?? ""),
          );
          if (Number.isFinite(s)) judgeScore = Math.max(0, Math.min(1, s));
          tokensIn += jres.tokensIn;
          tokensOut += jres.tokensOut;
          costCents += estimateCostCents(jres.model, jres.tokensIn, jres.tokensOut);
          await tx.insert(schema.runSteps).values({
            orgId: ctx.orgId,
            runId: run.id,
            stepId: "eval_judge",
            kind: "llm",
            model: jres.model,
            output: { score: judgeScore },
            tokensIn: jres.tokensIn,
            tokensOut: jres.tokensOut,
            latencyMs: jres.latencyMs,
            status: "fulfilled",
          });
        } catch {
          judgeScore = null; // keep ratio score
        }
      }

      // 4. act → outbox (+ approval)
      const outboxIds: string[] = [];
      const approvalRequired = spec.approval.before_act !== "none";
      for (const action of spec.act) {
        const [ob] = await tx
          .insert(schema.outbox)
          .values({
            orgId: ctx.orgId,
            runId: run.id,
            kind: action.type,
            payload: {
              action: action.type,
              assignee: action.assignee ?? null,
              context: context.steps,
            },
            status: approvalRequired ? "pending_approval" : "released",
          })
          .returning();
        outboxIds.push(ob.id);

        if (approvalRequired) {
          await tx.insert(schema.approvals).values({
            orgId: ctx.orgId,
            runId: run.id,
            outboxId: ob.id,
            kind: "review_action",
            payload: {
              agent: spec.name,
              action: action.type,
              preview: context.steps,
            },
          });
        }
      }

      // 5. learn → knowledge (bitemporal write, provenance = run id)
      for (const learn of spec.learn) {
        const claim = JSON.stringify(context.steps).slice(0, 4000);
        const subjects = collectSubjects(context, learn.write.about, learn.write.from);
        for (const subjectId of subjects) {
          await tx.insert(schema.knowledge).values({
            orgId: ctx.orgId,
            subjectType: learn.write.about,
            subjectId,
            claim: `${learn.write.claim}: ${claim.slice(0, 500)}`,
            sourceRunId: run.id,
            confidence: "0.5", // mock-derived claims get low confidence
          });
        }
      }

      // 6. close run — evalScore = fraction of steps fulfilled (1 = clean)
      await tx
        .update(schema.runs)
        .set({
          status: "fulfilled",
          finishedAt: new Date(),
          tokensIn,
          tokensOut,
          costCents: costCents.toFixed(4),
          evalScore: (
            judgeScore ?? stepsDone / Math.max(spec.steps.length, 1)
          ).toFixed(3),
        })
        .where(eq(schema.runs.id, run.id));
      await audit(tx, ctx, {
        action: "run.completed",
        entityType: "run",
        entityId: run.id,
        detail: { steps: spec.steps.length, outboxIds, approvalRequired },
      });
      logEvent("run.completed", {
        orgId: ctx.orgId,
        runId: run.id,
        agentId,
        triggerKind: opts.triggerKind,
        steps: spec.steps.length,
        tokensIn,
        tokensOut,
        costCents: Number(costCents.toFixed(4)),
        durationMs: Date.now() - runStart,
      });

      return { runId: run.id, status: "fulfilled" as const, outboxIds };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await tx
        .update(schema.runs)
        .set({
          status: "rejected",
          finishedAt: new Date(),
          error: message,
          tokensIn,
          tokensOut,
          costCents: costCents.toFixed(4),
          evalScore: (stepsDone / Math.max(spec.steps.length, 1)).toFixed(3),
        })
        .where(eq(schema.runs.id, run.id));
      await audit(tx, ctx, {
        action: "run.failed",
        entityType: "run",
        entityId: run.id,
        detail: { error: message },
      });
      logEvent(
        "run.failed",
        {
          orgId: ctx.orgId,
          runId: run.id,
          agentId,
          triggerKind: opts.triggerKind,
          error: message,
          tokensIn,
          tokensOut,
          costCents: Number(costCents.toFixed(4)),
          durationMs: Date.now() - runStart,
        },
        "warn",
      );
      return { runId: run.id, status: "rejected" as const, error: message };
    }
  });
  } catch (err) {
    // The run tx aborted mid-flight (e.g. a tool's SQL error poisoned the
    // transaction) — its inserts rolled back. Persist the failure in a
    // fresh transaction so a crashed run is never invisible.
    const message = err instanceof Error ? err.message : String(err);
    try {
      await withOrg(
        handle,
        { ...ctx, actorType: "system" },
        async (tx) => {
          if (opts.agentId) {
            await tx
              .insert(schema.runs)
              .values({
                id: runId,
                orgId: ctx.orgId,
                agentId: opts.agentId,
                triggerKind: opts.triggerKind,
                triggerContext: opts.triggerContext ?? null,
                status: "rejected",
                error: `tx aborted: ${message}`.slice(0, 2000),
                finishedAt: new Date(),
              })
              .onConflictDoNothing();
          }
          await audit(tx, { ...ctx, actorType: "system" }, {
            action: "run.failed",
            entityType: "run",
            entityId: runId,
            detail: { error: message, txAborted: true },
          });
        },
      );
    } catch (e2) {
      logEvent(
        "run.failure_record_failed",
        { orgId: ctx.orgId, runId, error: String(e2) },
        "warn",
      );
    }
    return { runId, status: "rejected" as const, error: message };
  }
}

/** Cancel a still-running run (mock executor is synchronous, so this is rare). */
export async function cancelRun(
  handle: DbHandle,
  ctx: OrgContext,
  runId: string,
) {
  return withOrg(handle, { ...ctx, actorType: ctx.actorType ?? "user" }, async (tx) => {
    const [run] = await tx
      .select()
      .from(schema.runs)
      .where(eq(schema.runs.id, runId))
      .limit(1);
    if (!run) throw new Error(`run not found: ${runId}`);
    if (run.status !== "running") throw new Error(`run not running: ${runId}`);
    await tx
      .update(schema.runs)
      .set({ status: "cancelled", finishedAt: new Date(), error: "cancelled by user" })
      .where(eq(schema.runs.id, runId));
    await audit(tx, ctx, {
      action: "run.cancelled",
      entityType: "run",
      entityId: runId,
      detail: { agentId: run.agentId },
    });
    return { runId, status: "cancelled" as const };
  });
}

/** Look up a run's agent so a finished run can be re-executed. */
export async function retryableAgentId(
  handle: DbHandle,
  ctx: OrgContext,
  runId: string,
) {
  return withOrg(handle, { ...ctx, actorType: ctx.actorType ?? "user" }, async (tx) => {
    const [run] = await tx
      .select({ agentId: schema.runs.agentId, status: schema.runs.status })
      .from(schema.runs)
      .where(eq(schema.runs.id, runId))
      .limit(1);
    if (!run) throw new Error(`run not found: ${runId}`);
    if (run.status === "running") throw new Error("run still in progress");
    await audit(tx, ctx, {
      action: "run.retried",
      entityType: "run",
      entityId: runId,
      detail: { agentId: run.agentId },
    });
    return run.agentId;
  });
}

/**
 * Interpolate `$`-refs in step input. `$event.x` and `$trigger.x` read the
 * trigger context; `$steps.<stepId>.<field>` reads a prior step's output.
 * Anything that doesn't resolve becomes undefined (tools decide requiredness).
 */
function resolveInput(
  input: Record<string, unknown>,
  context: Record<string, unknown>,
): Record<string, unknown> {
  const roots: Record<string, unknown> = {
    event: context.trigger,
    trigger: context.trigger,
    steps: context.steps,
  };
  const resolve = (v: unknown): unknown => {
    if (typeof v !== "string" || !v.startsWith("$")) return v;
    const [root, ...path] = v.slice(1).split(".");
    let cur: unknown = roots[root];
    for (const p of path) {
      if (cur == null || typeof cur !== "object") return undefined;
      cur = (cur as Record<string, unknown>)[p];
    }
    return cur;
  };
  return Object.fromEntries(
    Object.entries(input).map(([k, v]) => [k, resolve(v)]),
  );
}

/**
 * Collect subject entity ids for knowledge writes. `from` points at a step
 * whose output is an array of entities ({id}). Without `from`, fall back to
 * any array-valued step output containing id-bearing items.
 */
function collectSubjects(
  context: Record<string, unknown>,
  about: string,
  from?: string,
): string[] {
  void about;
  const steps = context.steps as Record<string, unknown>;
  const candidates = from ? [steps[from]] : Object.values(steps);
  const ids: string[] = [];
  for (const output of candidates) {
    const list = Array.isArray(output)
      ? output
      : output && typeof output === "object"
        ? Object.values(output as Record<string, unknown>).find(Array.isArray)
        : undefined;
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (item && typeof item === "object" && "id" in item) ids.push(String(item.id));
    }
  }
  return [...new Set(ids)];
}
