import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import {
  createDb,
  migrate,
  withOrg,
  schema,
  seed,
  type DbHandle,
} from "@aigtm/db";
import type { AgentStep } from "@aigtm/specs";
import { askOrg, rankSources } from "./ask";
import { ModelRouter, type ModelProvider, type ModelResult } from "./model";

let handle: DbHandle;
let orgId: string;
let userId: string;
let otherOrgId: string;
let agentId: string;

const ctx = () => ({ orgId, userId, actorType: "user" as const });

/** Provider that echoes back the first source ref it received plus junk. */
class CitingProvider implements ModelProvider {
  name = "mock";
  lastSources: { ref: string; detail: string }[] = [];
  async complete(
    _step: AgentStep,
    context: Record<string, unknown>,
  ): Promise<ModelResult> {
    this.lastSources =
      (context.sources as { ref: string; detail: string }[]) ?? [];
    return {
      output: {
        answer: "Nordic Systems is the strongest prospect.",
        citations: [
          this.lastSources[0]?.ref,
          "account:00000000-0000-0000-0000-000000000000", // hallucinated
          "totally-bogus",
        ],
      },
      tokensIn: 100,
      tokensOut: 20,
      latencyMs: 5,
      model: "stub:test",
    };
  }
}

beforeAll(async () => {
  handle = await createDb("memory:");
  await migrate(handle);
  ({ orgId, userId } = await seed(handle));
  const [o2] = await handle.db
    .insert(schema.organizations)
    .values({ name: "Other Org" })
    .returning();
  otherOrgId = o2.id;
  const [a] = await handle.db
    .insert(schema.agents)
    .values({ orgId, name: "T", spec: { name: "T", steps: [] } })
    .returning();
  agentId = a.id;
  await handle.db.insert(schema.accounts).values({
    orgId: otherOrgId,
    name: "Other Corp",
    stage: "prospect",
    icpFitScore: "99",
  });
});

afterAll(async () => {
  await handle.close();
});

describe("askOrg", () => {
  it("returns an answer, resolves real citations, drops hallucinated refs", async () => {
    const provider = new CitingProvider();
    const res = await askOrg(
      handle,
      ctx(),
      "which account should I call?",
      new ModelRouter([provider]),
    );
    expect(res.ok).toBe(true);
    expect(res.answer).toContain("Nordic");
    // exactly one citation survives — the two fabricated refs are dropped
    expect(res.citations).toHaveLength(1);
    expect(res.citations![0].href).toMatch(/^\/(accounts|contacts|deals|inbox|signals)/);
  });

  it("only sees own-org sources", async () => {
    const provider = new CitingProvider();
    await askOrg(handle, ctx(), "anything", new ModelRouter([provider]));
    expect(provider.lastSources.length).toBeGreaterThan(0);
    expect(
      provider.lastSources.every((s) => !s.detail.includes("Other Corp")),
    ).toBe(true);
  });

  it("writes an ask.answered audit event with cost", async () => {
    const provider = new CitingProvider();
    await askOrg(handle, ctx(), "audit me", new ModelRouter([provider]));
    const rows = (await withOrg(handle, ctx(), (tx) =>
      tx
        .select()
        .from(schema.auditEvents)
        .where(eq(schema.auditEvents.action, "ask.answered")),
    )) as { action: string; detail: { sourcesConsidered?: number } }[];
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0].detail.sourcesConsidered).toBeGreaterThan(0);
  });

  it("refuses when the org monthly budget is spent", async () => {
    await handle.db
      .update(schema.organizations)
      .set({ budgetMonthlyCents: 1 })
      .where(eq(schema.organizations.id, orgId));
    await handle.db.insert(schema.runs).values({
      orgId,
      agentId,
      triggerKind: "manual",
      status: "fulfilled",
      costCents: "50",
      startedAt: new Date(),
    });
    const res = await askOrg(handle, ctx(), "will this run?");
    expect(res.ok).toBe(false);
    expect(res.budgetExceeded).toBe(true);
    // cleanup so other tests/suites are unaffected
    await handle.db
      .update(schema.organizations)
      .set({ budgetMonthlyCents: null })
      .where(eq(schema.organizations.id, orgId));
  });
});

describe("rankSources", () => {
  it("keeps everything under the limit", () => {
    const srcs = Array.from({ length: 10 }, (_, i) => ({
      ref: `r${i}`,
      label: `L${i}`,
      href: "/x",
      detail: `d${i}`,
    }));
    expect(rankSources("anything", srcs)).toHaveLength(10);
  });

  it("prefers sources matching the question terms", () => {
    const srcs = Array.from({ length: 60 }, (_, i) => ({
      ref: `r${i}`,
      label: `L${i}`,
      href: "/x",
      detail: i === 42 ? "mention of nordic systems here" : `generic ${i}`,
    }));
    const ranked = rankSources("what about Nordic Systems?", srcs, 45);
    expect(ranked).toHaveLength(45);
    expect(ranked[0].ref).toBe("r42");
  });
});
