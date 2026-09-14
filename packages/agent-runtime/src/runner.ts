import { eq } from "drizzle-orm";
import {
  schema,
  withOrg,
  audit,
  type DbHandle,
  type OrgContext,
} from "@aigtm/db";
import { parseAgentSpec, type AgentSpec } from "@aigtm/specs";
import { ModelRouter } from "./model";
import { tools } from "./tools";

export interface ExecuteRunOptions {
  agentId?: string;
  spec?: AgentSpec;
  triggerKind: "manual" | "schedule" | "event" | "api";
  triggerContext?: Record<string, unknown>;
  actorId?: string;
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
  return withOrg(handle, { ...ctx, actorType: ctx.actorType ?? "user" }, async (tx) => {
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
    let tokensIn = 0,
      tokensOut = 0;

    // 3. steps
    try {
      for (const step of spec.steps) {
        try {
          let output: unknown;
          let model: string | null = null;
          let stepIn = 0,
            stepOut = 0,
            latency = 0;
          const start = Date.now();

          if (step.kind === "tool") {
            const fn = tools[step.tool!];
            if (!fn) throw new Error(`tool not in allowlist: ${step.tool}`);
            output = await fn(tx, ctx.orgId, step.input);
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
          tokensIn += stepIn;
          tokensOut += stepOut;

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
              mock: true, // Phase 0: dispatched actions are simulated only
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

      // 6. close run
      await tx
        .update(schema.runs)
        .set({ status: "fulfilled", finishedAt: new Date(), tokensIn, tokensOut })
        .where(eq(schema.runs.id, run.id));
      await audit(tx, ctx, {
        action: "run.completed",
        entityType: "run",
        entityId: run.id,
        detail: { steps: spec.steps.length, outboxIds, approvalRequired },
      });

      return { runId: run.id, status: "fulfilled" as const, outboxIds };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await tx
        .update(schema.runs)
        .set({ status: "rejected", finishedAt: new Date(), error: message, tokensIn, tokensOut })
        .where(eq(schema.runs.id, run.id));
      await audit(tx, ctx, {
        action: "run.failed",
        entityType: "run",
        entityId: run.id,
        detail: { error: message },
      });
      return { runId: run.id, status: "rejected" as const, error: message };
    }
  });
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
