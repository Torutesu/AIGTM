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
import { cronMatches, lastCronOccurrence, tick } from "./scheduler";

let handle: DbHandle;
let orgId: string;
let userId: string;

const ctx = () => ({ orgId, userId, actorType: "user" as const });

const minimalSpec = (trigger: Record<string, unknown>) => ({
  name: `agent-${Math.random().toString(36).slice(2, 8)}`,
  trigger,
  steps: [
    {
      id: "s1",
      kind: "llm",
      model: "reasoning",
      prompt: "Summarize",
      input: {},
      output: { summary: "string" },
    },
  ],
  approval: { before_act: "none" },
});

async function addAgent(spec: Record<string, unknown>, enabled = true) {
  let id = "";
  await withOrg(handle, ctx(), async (tx) => {
    const [a] = await tx
      .insert(schema.agents)
      .values({ orgId, name: spec.name as string, spec, enabled })
      .returning({ id: schema.agents.id });
    id = a.id;
  });
  return id;
}

async function runCount(agentId: string) {
  return withOrg(handle, ctx(), async (tx) => {
    const runs = await tx
      .select({
        kind: schema.runs.triggerKind,
        tc: schema.runs.triggerContext,
        status: schema.runs.status,
      })
      .from(schema.runs)
      .where(eq(schema.runs.agentId, agentId));
    return runs as {
      kind: string;
      status: string;
      tc: Record<string, unknown> | null;
    }[];
  });
}

beforeAll(async () => {
  handle = await createDb("memory:");
  await migrate(handle);
  ({ orgId, userId } = await seed(handle));
});

afterAll(async () => {
  await handle.close();
});

describe("cronMatches", () => {
  it("matches weekday + time fields", () => {
    // 2025-01-06 is a Monday
    expect(cronMatches("0 9 * * MON", new Date("2025-01-06T09:00:00Z"))).toBe(true);
    expect(cronMatches("0 9 * * MON", new Date("2025-01-06T09:01:00Z"))).toBe(false);
    expect(cronMatches("0 9 * * MON", new Date("2025-01-07T09:00:00Z"))).toBe(false);
  });

  it("supports lists, ranges and steps", () => {
    expect(cronMatches("*/15 * * * *", new Date("2025-01-06T09:30:00Z"))).toBe(true);
    expect(cronMatches("*/15 * * * *", new Date("2025-01-06T09:31:00Z"))).toBe(false);
    expect(cronMatches("0 9-17 * * *", new Date("2025-01-06T13:00:00Z"))).toBe(true);
    expect(cronMatches("0 8,18 * * *", new Date("2025-01-06T18:00:00Z"))).toBe(true);
    expect(cronMatches("0 8,18 * * *", new Date("2025-01-06T09:00:00Z"))).toBe(false);
  });

  it("ORs restricted dom and dow (standard cron)", () => {
    // 13th of the month OR any Friday
    expect(cronMatches("0 0 13 * FRI", new Date("2025-06-13T00:00:00Z"))).toBe(true); // both
    expect(cronMatches("0 0 13 * FRI", new Date("2025-06-20T00:00:00Z"))).toBe(true); // Friday only
    expect(cronMatches("0 0 13 * FRI", new Date("2025-07-13T00:00:00Z"))).toBe(true); // 13th only
    expect(cronMatches("0 0 13 * FRI", new Date("2025-06-14T00:00:00Z"))).toBe(false);
  });

  it("rejects malformed expressions", () => {
    expect(cronMatches("* * * *", new Date())).toBe(false);
    expect(cronMatches("not a cron", new Date())).toBe(false);
  });
});

describe("lastCronOccurrence", () => {
  it("finds the most recent matching minute", () => {
    const now = new Date("2025-01-06T09:05:30Z"); // Monday 09:05 UTC
    const occ = lastCronOccurrence("0 9 * * MON", now);
    expect(occ?.toISOString()).toBe("2025-01-06T09:00:00.000Z");
  });
});

describe("tick", () => {
  it("launches a due schedule agent exactly once per occurrence", async () => {
    const id = await addAgent(
      minimalSpec({ type: "schedule", schedule: "* * * * *" }),
    );
    await tick(handle, { now: new Date("2025-01-06T09:00:15Z") });
    expect((await runCount(id)).length).toBe(1);
    // same occurrence → no duplicate
    await tick(handle, { now: new Date("2025-01-06T09:00:45Z") });
    expect((await runCount(id)).length).toBe(1);
    // next occurrence fires again
    await tick(handle, { now: new Date("2025-01-06T09:01:10Z") });
    const runs = await runCount(id);
    expect(runs.length).toBe(2);
    expect(runs.every((r) => r.kind === "schedule")).toBe(true);
  });

  it("skips disabled agents", async () => {
    const id = await addAgent(
      minimalSpec({ type: "schedule", schedule: "* * * * *" }),
      false,
    );
    await tick(handle, { now: new Date("2025-01-06T10:00:00Z") });
    expect((await runCount(id)).length).toBe(0);
  });

  it("skips schedule occurrences already covered by a later run", async () => {
    const id = await addAgent(
      minimalSpec({ type: "schedule", schedule: "0 12 * * *" }),
    );
    // a schedule run that already ran "at" noon
    await withOrg(handle, ctx(), async (tx) => {
      await tx.insert(schema.runs).values({
        orgId,
        agentId: id,
        status: "fulfilled",
        triggerKind: "schedule",
        triggerContext: { scheduledFor: "2025-01-06T12:00:00.000Z" },
        startedAt: new Date("2025-01-06T12:00:01Z"),
      });
    });
    await tick(handle, { now: new Date("2025-01-06T12:30:00Z") });
    expect((await runCount(id)).length).toBe(1); // only the pre-seeded run
  });

  it("fires event agents on qualifying signal_events, each exactly once", async () => {
    const id = await addAgent(
      minimalSpec({
        type: "event",
        event: "signal_event",
        where: { score_gte: 0.9 },
      }),
    );
    await tick(handle, { now: new Date("2025-01-06T13:00:00Z") });
    const runs1 = await runCount(id);
    expect(runs1.length).toBeGreaterThan(0);
    // second tick → nothing new
    await tick(handle, { now: new Date("2025-01-06T13:01:00Z") });
    expect((await runCount(id)).length).toBe(runs1.length);

    const ids = runs1.map((r) => r.tc?.signalEventId);
    expect(new Set(ids).size).toBe(ids.length); // no event fired twice
    expect(runs1.every((r) => r.kind === "event")).toBe(true);
  });

  it("resolves $event.* step input and fulfills the seeded outbound agent", async () => {
    // the seeded "Outbound to high ICP fit" agent uses
    //   accounts.lookup(accountId: "$event.accountId")
    // and approval.required — an event run must fulfill end to end
    const [seeded] = await withOrg(handle, ctx(), async (tx) => {
      const agents = await tx
        .select({ id: schema.agents.id, name: schema.agents.name, spec: schema.agents.spec })
        .from(schema.agents);
      return agents.filter(
        (a: { spec: unknown }) =>
          (a.spec as { trigger?: { type?: string } }).trigger?.type === "event",
      );
    });
    expect(seeded).toBeTruthy();
    await withOrg(handle, ctx(), async (tx) => {
      const [acc] = await tx
        .select({ id: schema.accounts.id })
        .from(schema.accounts)
        .limit(1);
      const [sig] = await tx
        .select({ id: schema.signals.id })
        .from(schema.signals)
        .limit(1);
      await tx.insert(schema.signalEvents).values({
        orgId,
        accountId: acc.id,
        signalId: sig.id,
        score: "0.99",
        evidence: { note: "event-trigger test" },
      });
    });
    await tick(handle, { now: new Date("2025-01-06T14:00:00Z") });
    const runs = await runCount(seeded.id);
    const eventRuns = runs.filter((r) => r.kind === "event");
    expect(eventRuns.length).toBeGreaterThan(0);
    expect(eventRuns.every((r) => r.status === "fulfilled")).toBe(true);
  });
});
