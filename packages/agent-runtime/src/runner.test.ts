import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { desc, eq } from "drizzle-orm";
import {
  createDb,
  migrate,
  withOrg,
  schema,
  seed,
  type DbHandle,
} from "@aigtm/db";
import { parseAgentSpec } from "@aigtm/specs";
import { executeRun } from "./runner";
import { decideApproval } from "./approvals";
import { MockProvider, ModelRouter } from "./model";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

let handle: DbHandle;
let orgId: string;
let userId: string;
let agentId: string;

const ctx = () => ({ orgId, userId, actorType: "user" as const });

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

beforeAll(async () => {
  handle = await createDb("memory:");
  await migrate(handle);
  ({ orgId, userId } = await seed(handle));
  // register the real YAML spec as an agent row
  const yaml = readFileSync(
    join(repoRoot, "agents", "stalled-deal-recovery.yaml"),
    "utf8",
  );
  const spec = parseAgentSpec(yaml);
  await withOrg(handle, ctx(), async (tx) => {
    const [a] = await tx
      .insert(schema.agents)
      .values({ orgId, name: spec.name, spec })
      .returning();
    agentId = a.id;
  });
});

afterAll(async () => {
  await handle.close();
});

describe("executeRun", () => {
  it("runs steps, creates outbox+approval, writes knowledge and audit", async () => {
    const provider = new MockProvider();
    const router = new ModelRouter([provider]);
    const result = await executeRun(handle, ctx(), {
      agentId,
      triggerKind: "manual",
    }, router);

    expect(result.status).toBe("fulfilled");
    expect(provider.calls.map((c) => c.step)).toEqual(["diagnose", "draft"]);

    const data = await withOrg(handle, ctx(), async (tx) => ({
      steps: (await tx
        .select()
        .from(schema.runSteps)
        .where(eq(schema.runSteps.runId, result.runId))) as {
        stepId: string;
        output: unknown;
      }[],
      approvals: (await tx
        .select()
        .from(schema.approvals)
        .where(eq(schema.approvals.runId, result.runId))) as { status: string }[],
      outboxRows: (await tx
        .select()
        .from(schema.outbox)
        .where(eq(schema.outbox.runId, result.runId))) as { status: string }[],
      knowledgeRows: (await tx
        .select()
        .from(schema.knowledge)
        .where(eq(schema.knowledge.sourceRunId, result.runId))) as unknown[],
      auditRows: (await tx
        .select()
        .from(schema.auditEvents)
        .orderBy(desc(schema.auditEvents.createdAt))
        .limit(10)) as { action: string }[],
    }));

    // find_stalled (tool) + diagnose + draft (llm)
    expect(data.steps.map((s) => s.stepId)).toEqual(["find_stalled", "diagnose", "draft"]);
    expect((data.steps[0].output as unknown[]).length).toBeGreaterThan(0); // found the stalled deal
    expect(data.outboxRows).toHaveLength(1);
    expect(data.outboxRows[0].status).toBe("pending_approval");
    expect(data.approvals).toHaveLength(1);
    expect(data.approvals[0].status).toBe("pending");
    expect(data.knowledgeRows.length).toBeGreaterThan(0); // learned per stalled deal
    expect(data.auditRows.map((a) => a.action)).toContain("run.started");
    expect(data.auditRows.map((a) => a.action)).toContain("run.completed");
  });

  it("marks run rejected when a step fails", async () => {
    const spec = parseAgentSpec(`
name: Broken
trigger: {type: manual}
steps:
  - id: boom
    kind: tool
    tool: does.not.exist
approval: {before_act: none}
`);
    const result = await withOrg(handle, ctx(), async (tx) => {
      const [a] = await tx
        .insert(schema.agents)
        .values({ orgId, name: "Broken", spec })
        .returning();
      return a.id;
    });
    const res = await executeRun(handle, ctx(), { agentId: result, triggerKind: "api" });
    expect(res.status).toBe("rejected");
    expect(res.error).toContain("does.not.exist");
  });
});

describe("decideApproval", () => {
  it("approve → outbox dispatched (mock), audit written", async () => {
    const { runId } = await executeRun(handle, ctx(), { agentId, triggerKind: "manual" });
    const pending = (await withOrg(handle, ctx(), (tx) =>
      tx.select().from(schema.approvals).where(eq(schema.approvals.runId, runId!)),
    )) as { id: string; outboxId: string | null }[];
    const ap = pending[0];
    await decideApproval(handle, ctx(), ap.id, "approved");

    const data = await withOrg(handle, ctx(), async (tx) => ({
      approval: (await tx
        .select()
        .from(schema.approvals)
        .where(eq(schema.approvals.id, ap.id)))[0] as { status: string },
      outbox: (await tx
        .select()
        .from(schema.outbox)
        .where(eq(schema.outbox.id, ap.outboxId!)))[0] as { status: string },
      audits: (await tx
        .select()
        .from(schema.auditEvents)
        .where(eq(schema.auditEvents.entityId, ap.id))) as { action: string }[],
    }));
    expect(data.approval.status).toBe("approved");
    expect(data.outbox.status).toBe("dispatched");
    expect(data.audits.map((a) => a.action)).toContain("approval.decided");
  });

  it("reject → outbox cancelled; double decision throws", async () => {
    const { runId } = await executeRun(handle, ctx(), { agentId, triggerKind: "manual" });
    const pending = (await withOrg(handle, ctx(), (tx) =>
      tx.select().from(schema.approvals).where(eq(schema.approvals.runId, runId!)),
    )) as { id: string; outboxId: string | null }[];
    const ap = pending[0];
    await decideApproval(handle, ctx(), ap.id, "rejected", "not now");
    const rows = (await withOrg(handle, ctx(), (tx) =>
      tx.select().from(schema.outbox).where(eq(schema.outbox.id, ap.outboxId!)),
    )) as { status: string }[];
    expect(rows[0].status).toBe("cancelled");
    await expect(decideApproval(handle, ctx(), ap.id, "approved")).rejects.toThrowError();
  });
});
