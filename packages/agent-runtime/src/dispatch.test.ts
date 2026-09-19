import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  createDb,
  migrate,
  withOrg,
  schema,
  seed,
  encryptSecret,
  type DbHandle,
  type OrgProviderConfig,
} from "@aigtm/db";
import { dispatchOutbox, dispatchPendingOutbox } from "./approvals";
import { syncSpecs } from "./spec-sync";
import { tick } from "./scheduler";
import { MockProvider, ModelRouter } from "./model";

let handle: DbHandle;
let orgId: string;
let userId: string;

const ctx = () => ({ orgId, userId, actorType: "user" as const });

beforeAll(async () => {
  handle = await createDb("memory:");
  await migrate(handle);
  ({ orgId, userId } = await seed(handle));
});

afterAll(async () => {
  await handle.close();
});

async function makeOutbox(payload: Record<string, unknown>, status = "released") {
  return withOrg(handle, ctx(), async (tx) => {
    const [ob] = await tx
      .insert(schema.outbox)
      .values({ orgId, kind: "draft_email", payload, status })
      .returning();
    return ob.id;
  });
}

async function outboxRow(id: string) {
  const [r] = (await withOrg(handle, ctx(), (tx) =>
    tx.select().from(schema.outbox).where(eq(schema.outbox.id, id)),
  )) as { status: string; payload: Record<string, unknown> }[];
  return r as { status: string; payload: Record<string, unknown> };
}

async function auditActions(entityId: string) {
  const rows = await withOrg(handle, ctx(), (tx) =>
    tx
      .select({ action: schema.auditEvents.action, detail: schema.auditEvents.detail })
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.entityId, entityId)),
  );
  return rows as { action: string; detail: Record<string, unknown> }[];
}

const emailPayload = {
  action: "send_email",
  to: "Elena Marlow · elena@nordic-systems.example",
  subject: "hello",
  body: "body text",
};

describe("dispatchOutbox", () => {
  it("sends via resend when AIGTM_EMAIL_PROVIDER=resend", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "re_123" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    process.env.AIGTM_EMAIL_PROVIDER = "resend";
    process.env.AIGTM_RESEND_API_KEY = "re_test";
    process.env.AIGTM_EMAIL_FROM = "gtm@aigtm.example";
    try {
      const id = await makeOutbox(emailPayload);
      await dispatchOutbox(handle, ctx(), id);

      const row = await outboxRow(id);
      expect(row.status).toBe("dispatched");
      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://api.resend.com/emails");
      expect((init.headers as Record<string, string>).Authorization).toBe(
        "Bearer re_test",
      );
      const sent = JSON.parse(init.body as string);
      expect(sent.to).toBe("elena@nordic-systems.example"); // extracted from "Name · email"
      expect(sent.subject).toBe("hello");
      const audits = await auditActions(id);
      expect(audits.map((a) => a.action)).toContain("outbox.dispatched");
      expect(
        audits.find((a) => a.action === "outbox.dispatched")?.detail,
      ).toMatchObject({ provider: "resend", messageId: "re_123" });
    } finally {
      vi.unstubAllGlobals();
      delete process.env.AIGTM_EMAIL_PROVIDER;
      delete process.env.AIGTM_RESEND_API_KEY;
      delete process.env.AIGTM_EMAIL_FROM;
    }
  });

  it("marks outbox failed when provider configured but send errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("boom", { status: 500 })),
    );
    process.env.AIGTM_EMAIL_PROVIDER = "resend";
    process.env.AIGTM_RESEND_API_KEY = "re_test";
    process.env.AIGTM_EMAIL_FROM = "gtm@aigtm.example";
    try {
      const id = await makeOutbox(emailPayload);
      await dispatchOutbox(handle, ctx(), id);
      const row = await outboxRow(id);
      expect(row.status).toBe("failed");
      expect(row.payload.dispatchAttempts).toBe(1);
      const audits = await auditActions(id);
      expect(audits.map((a) => a.action)).toContain("outbox.dispatch_failed");
    } finally {
      vi.unstubAllGlobals();
      delete process.env.AIGTM_EMAIL_PROVIDER;
      delete process.env.AIGTM_RESEND_API_KEY;
      delete process.env.AIGTM_EMAIL_FROM;
    }
  });

  it("dispatchPendingOutbox retries failed rows and caps attempts", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify({ id: "re_9" }), { status: 200 })),
      );
    vi.stubGlobal("fetch", fetchMock);
    process.env.AIGTM_EMAIL_PROVIDER = "resend";
    process.env.AIGTM_RESEND_API_KEY = "re_test";
    process.env.AIGTM_EMAIL_FROM = "gtm@aigtm.example";
    try {
      const id = await makeOutbox(
        { ...emailPayload, dispatchAttempts: 4 },
        "failed",
      );
      const n = await dispatchPendingOutbox(handle, ctx());
      expect(n).toBeGreaterThanOrEqual(1);
      expect((await outboxRow(id)).status).toBe("dispatched");

      // capped at 5 attempts: a row already at 5 stays failed
      const capped = await makeOutbox(
        { ...emailPayload, dispatchAttempts: 5 },
        "failed",
      );
      const callsBefore = fetchMock.mock.calls.length;
      await dispatchPendingOutbox(handle, ctx());
      expect(fetchMock.mock.calls.length).toBe(callsBefore);
      expect((await outboxRow(capped)).status).toBe("failed");
    } finally {
      vi.unstubAllGlobals();
      delete process.env.AIGTM_EMAIL_PROVIDER;
      delete process.env.AIGTM_RESEND_API_KEY;
      delete process.env.AIGTM_EMAIL_FROM;
    }
  });

  it("falls back to marked mock dispatch with no provider configured", async () => {
    const id = await makeOutbox(emailPayload);
    await dispatchOutbox(handle, ctx(), id);
    const row = await outboxRow(id);
    expect(row.status).toBe("dispatched");
    const audits = await auditActions(id);
    expect(
      audits.find((a) => a.action === "outbox.dispatched")?.detail,
    ).toMatchObject({ mock: true });
  });
});

describe("syncSpecs", () => {
  it("loads agents/*.yaml and signals/*.yaml into every org", async () => {
    const res = await syncSpecs(handle);
    expect(res.agents).toBeGreaterThanOrEqual(3); // 3 agent yamls, 1 org
    expect(res.signals).toBeGreaterThanOrEqual(2);
    const rows = (await withOrg(handle, ctx(), async (tx) => ({
      agents: await tx.select({ name: schema.agents.name }).from(schema.agents),
      signals: await tx.select({ name: schema.signals.name }).from(schema.signals),
    }))) as { agents: { name: string }[]; signals: { name: string }[] };
    expect(rows.agents.map((a) => a.name)).toContain("Weekly Pipeline Digest");
    expect(rows.signals.map((s) => s.name)).toContain("Stalled deal");
    // idempotent: no duplicates on re-sync
    await syncSpecs(handle);
    const agents2 = (await withOrg(handle, ctx(), (tx) =>
      tx.select({ name: schema.agents.name }).from(schema.agents),
    )) as { name: string }[];
    expect(
      agents2.filter((a) => a.name === "Weekly Pipeline Digest"),
    ).toHaveLength(1);
  });
});

describe("signal evaluator (internal_sor)", () => {
  it("emits deduped signal_events for stale deals and runs enqueue_agent", async () => {
    // agent the signal enqueues — name slug must match "deal-saver"
    const agentSpec = {
      name: "Deal Saver",
      trigger: { type: "manual" },
      steps: [
        {
          id: "s1",
          kind: "llm",
          model: "reasoning",
          prompt: "x",
          input: {},
          output: { y: "string" },
        },
      ],
      approval: { before_act: "none" },
    };
    const signalSpec = {
      name: "Stale deal watch",
      description: "",
      sources: [
        {
          type: "internal_sor",
          watch: { entity: "deal", field: "last_activity_at", older_than_days: 1 },
        },
      ],
      actions: [{ emit: "signal_event" }, { enqueue_agent: "deal-saver" }],
    };
    let agentId = "";
    let signalId = "";
    let dealId = "";
    await withOrg(handle, ctx(), async (tx) => {
      const [a] = await tx
        .insert(schema.agents)
        .values({ orgId, name: "Deal Saver", spec: agentSpec })
        .returning();
      agentId = a.id;
      const [s] = await tx
        .insert(schema.signals)
        .values({ orgId, name: "Stale deal watch", spec: signalSpec })
        .returning();
      signalId = s.id;
      const [acc] = await tx
        .select({ id: schema.accounts.id })
        .from(schema.accounts)
        .limit(1);
      const [d] = await tx
        .insert(schema.deals)
        .values({
          orgId,
          accountId: acc.id,
          name: "very stale deal",
          stage: "open",
          lastActivityAt: new Date(Date.now() - 10 * 86_400_000),
        })
        .returning();
      dealId = d.id;
    });

    const router = new ModelRouter([new MockProvider()]);
    const launched = await tick(handle, { now: new Date(), router });
    expect(launched).toBeGreaterThanOrEqual(1);

    const events = (await withOrg(handle, ctx(), (tx) =>
      tx
        .select()
        .from(schema.signalEvents)
        .where(eq(schema.signalEvents.signalId, signalId)),
    )) as { id: string; evidence: Record<string, unknown> }[];
    expect(events.length).toBeGreaterThanOrEqual(1);
    const mine = events.find((e) => e.evidence.dealId === dealId);
    expect(mine).toBeTruthy();

    const runs = (await withOrg(handle, ctx(), (tx) =>
      tx
        .select({ tc: schema.runs.triggerContext, kind: schema.runs.triggerKind })
        .from(schema.runs)
        .where(eq(schema.runs.agentId, agentId)),
    )) as { tc: Record<string, unknown> | null; kind: string }[];
    expect(runs.some((r) => r.kind === "event" && r.tc?.signalEventId === mine!.id)).toBe(
      true,
    );

    // second tick: fingerprint dedupe → no new event for the same deal
    await tick(handle, { now: new Date(Date.now() + 60_000), router });
    const events2 = (await withOrg(handle, ctx(), (tx) =>
      tx
        .select()
        .from(schema.signalEvents)
        .where(eq(schema.signalEvents.signalId, signalId)),
    )) as { evidence: Record<string, unknown> }[];
    expect(
      events2.filter((e) => e.evidence.dealId === dealId),
    ).toHaveLength(1);
  });

  it("named events (inbound.submitted) fire only matching event agents", async () => {
    const spec = {
      name: "Inbound Router",
      trigger: { type: "event", event: "inbound.submitted" },
      steps: [
        {
          id: "s1",
          kind: "llm",
          model: "reasoning",
          prompt: "x",
          input: {},
          output: { y: "string" },
        },
      ],
      approval: { before_act: "none" },
    };
    let agentId = "";
    await withOrg(handle, ctx(), async (tx) => {
      const [a] = await tx
        .insert(schema.agents)
        .values({ orgId, name: "Inbound Router", spec })
        .returning();
      agentId = a.id;
      // an event WITHOUT a matching eventType must not fire it
      await tx.insert(schema.signalEvents).values({
        orgId,
        evidence: { note: "untyped" },
        detectedAt: new Date(Date.now() + 1000),
      });
      await tx.insert(schema.signalEvents).values({
        orgId,
        evidence: { eventType: "inbound.submitted", form: "demo" },
        detectedAt: new Date(Date.now() + 2000),
      });
    });

    const router = new ModelRouter([new MockProvider()]);
    await tick(handle, { now: new Date(Date.now() + 3000), router });

    const runs = (await withOrg(handle, ctx(), (tx) =>
      tx
        .select({ tc: schema.runs.triggerContext })
        .from(schema.runs)
        .where(eq(schema.runs.agentId, agentId)),
    )) as { tc: Record<string, unknown> | null }[];
    expect(runs).toHaveLength(1); // only the matching event fired it
  });
});

async function setOrgConfig(patch: Partial<OrgProviderConfig>) {
  const [org] = (await handle.db
    .select({ providerConfig: schema.organizations.providerConfig })
    .from(schema.organizations)
    .where(eq(schema.organizations.id, orgId))
    .limit(1)) as { providerConfig: OrgProviderConfig | null }[];
  await handle.db
    .update(schema.organizations)
    .set({ providerConfig: { ...(org?.providerConfig ?? {}), ...patch } })
    .where(eq(schema.organizations.id, orgId));
}

describe("slack + action webhook dispatch", () => {
  it("post_slack posts {text} to the org slack webhook", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() => Promise.resolve(new Response("ok", { status: 200 })));
    vi.stubGlobal("fetch", fetchMock);
    await setOrgConfig({
      slackWebhookUrl: encryptSecret("https://hooks.slack.com/services/T/B/x"),
    });
    try {
      const id = await withOrg(handle, ctx(), async (tx) => {
        const [ob] = await tx
          .insert(schema.outbox)
          .values({
            orgId,
            kind: "post_slack",
            payload: { context: { summarize: { digest: "weekly digest body" } } },
            status: "released",
          })
          .returning();
        return ob.id;
      });
      await dispatchOutbox(handle, ctx(), id);
      expect((await outboxRow(id)).status).toBe("dispatched");
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://hooks.slack.com/services/T/B/x");
      expect(JSON.parse(init.body as string).text).toBe("weekly digest body");
      const audits = await auditActions(id);
      expect(
        audits.find((a) => a.action === "outbox.dispatched")?.detail,
      ).toMatchObject({ provider: "slack" });
    } finally {
      vi.unstubAllGlobals();
      await setOrgConfig({ slackWebhookUrl: undefined });
    }
  });

  it("crm_write posts {kind, payload} to the org action webhook", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() => Promise.resolve(new Response("{}", { status: 200 })));
    vi.stubGlobal("fetch", fetchMock);
    await setOrgConfig({
      actionWebhookUrl: encryptSecret("https://hooks.zapier.com/x"),
    });
    try {
      const id = await withOrg(handle, ctx(), async (tx) => {
        const [ob] = await tx
          .insert(schema.outbox)
          .values({
            orgId,
            kind: "crm_write",
            payload: { action: "crm_write", fields: { stage: "negotiation" } },
            status: "released",
          })
          .returning();
        return ob.id;
      });
      await dispatchOutbox(handle, ctx(), id);
      expect((await outboxRow(id)).status).toBe("dispatched");
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://hooks.zapier.com/x");
      const sent = JSON.parse(init.body as string);
      expect(sent.kind).toBe("crm_write");
      expect(sent.payload.fields.stage).toBe("negotiation");
    } finally {
      vi.unstubAllGlobals();
      await setOrgConfig({ actionWebhookUrl: undefined });
    }
  });

  it("post_slack without configured webhook stays marked mock", async () => {
    const id = await withOrg(handle, ctx(), async (tx) => {
      const [ob] = await tx
        .insert(schema.outbox)
        .values({ orgId, kind: "post_slack", payload: {}, status: "released" })
        .returning();
      return ob.id;
    });
    await dispatchOutbox(handle, ctx(), id);
    expect((await outboxRow(id)).status).toBe("dispatched");
    const audits = await auditActions(id);
    expect(
      audits.find((a) => a.action === "outbox.dispatched")?.detail,
    ).toMatchObject({ mock: true });
  });
});

describe("org monthly budget", () => {
  it("rejects new LLM steps once the month's spend crosses the org budget", async () => {
    // set a tiny org budget and pre-load this month's spend above it
    await handle.db
      .update(schema.organizations)
      .set({ budgetMonthlyCents: 50 })
      .where(eq(schema.organizations.id, orgId));
    const agent = await withOrg(handle, ctx(), async (tx) => {
      const [a] = await tx
        .insert(schema.agents)
        .values({
          orgId,
          name: "Budget Probe",
          spec: {
            name: "Budget Probe",
            trigger: { type: "manual" },
            steps: [
              {
                id: "s1",
                kind: "llm",
                model: "reasoning",
                prompt: "x",
                input: {},
                output: { y: "string" },
              },
            ],
            approval: { before_act: "none" },
          },
        })
        .returning();
      // prior month spend already over budget
      await tx.insert(schema.runs).values({
        orgId,
        agentId: a.id,
        triggerKind: "manual",
        status: "fulfilled",
        costCents: "60",
      });
      return a;
    });

    const { executeRun } = await import("./runner");
    const res = await executeRun(
      handle,
      ctx(),
      { agentId: agent.id, triggerKind: "manual" },
      new ModelRouter([new MockProvider()]),
    );
    expect(res.status).toBe("rejected");
    expect(res.error).toContain("org monthly budget");
    await handle.db
      .update(schema.organizations)
      .set({ budgetMonthlyCents: null })
      .where(eq(schema.organizations.id, orgId));
  });
});
