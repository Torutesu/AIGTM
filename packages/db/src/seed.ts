import { createDb, migrate, withOrg, audit } from "./index";
import { schema } from "./index";
import { hashPassword } from "./password";
import { eq } from "drizzle-orm";

export const DEMO = {
  orgName: "Internal Corp",
  email: process.env.SEED_ADMIN_EMAIL ?? "admin@aigtm.local",
  password: process.env.SEED_ADMIN_PASSWORD ?? "admin-password",
  name: "Admin",
};

const stalledDealRecoverySpec = {
  name: "Stalled Deal Recovery",
  description: "Flags deals with no activity in 14+ days and drafts a recovery note.",
  trigger: { type: "manual" },
  steps: [
    {
      id: "find_stalled",
      kind: "tool",
      tool: "deals.stalled",
      input: { days: 14 },
      output: { deals: "array" },
    },
    {
      id: "diagnose",
      kind: "llm",
      model: "reasoning",
      prompt: "prompts/diagnose-stall.md",
      output: { stall_reason: "string", evidence: "array" },
    },
    {
      id: "draft",
      kind: "llm",
      model: "writing",
      prompt: "prompts/recovery-note.md",
      output: { note_draft: "string" },
    },
  ],
  approval: { before_act: "required" },
  act: [{ type: "create_task", assignee: "deal.owner" }],
  learn: [{ write: { claim: "stall_reason", about: "deal", from: "find_stalled" } }],
};

const outboundSpec = {
  name: "Outbound to high ICP fit",
  description: "Drafts a first-touch email when an account crosses the ICP-fit threshold.",
  trigger: { type: "event", on: "signal_event", where: { score_gte: 0.8 } },
  steps: [
    {
      id: "research",
      kind: "tool",
      tool: "accounts.lookup",
      input: { accountId: "$event.account_id" },
      output: { account: "object" },
    },
    {
      id: "draft",
      kind: "llm",
      model: "writing",
      prompt: "prompts/first-touch.md",
      output: { email_draft: "string" },
    },
  ],
  approval: { before_act: "required" },
  act: [{ type: "send_email", channel: "email" }],
  learn: [{ write: { claim: "outcome", about: "account", from: "research" } }],
};

const jobPostingSignalSpec = {
  name: "First GTM hire",
  description: "Company with no prior GTM headcount posts its first GTM role.",
  sources: [{ type: "job_boards", watch: { role_keywords: ["GTM", "RevOps", "グロース"] } }],
  resolve: { entity: "account", constraints: ["no prior GTM headcount"] },
  score: { icp_filter: "default" },
  actions: [{ emit: "signal_event" }],
};

/** Seed demo data. Returns ids used by tests. Idempotent per email. */
export async function seed(handle: Awaited<ReturnType<typeof createDb>>) {
  const db = handle.db;
  const [existing] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, DEMO.email))
    .limit(1);
  if (existing) {
    const [m] = await db
      .select()
      .from(schema.memberships)
      .where(eq(schema.memberships.userId, existing.id))
      .limit(1);
    return { userId: existing.id, orgId: m!.orgId };
  }

  const [org] = await db
    .insert(schema.organizations)
    .values({ name: DEMO.orgName })
    .returning();
  const [user] = await db
    .insert(schema.users)
    .values({
      email: DEMO.email,
      name: DEMO.name,
      passwordHash: hashPassword(DEMO.password),
    })
    .returning();
  await db
    .insert(schema.memberships)
    .values({ orgId: org.id, userId: user.id, role: "admin" });

  await withOrg(handle, { orgId: org.id, userId: user.id, actorType: "system" }, async (tx) => {
    const [acme, globex, sakura, nordic, hummingbird, tsubame, cascade] = await tx
      .insert(schema.accounts)
      .values([
        { orgId: org.id, name: "Acme Robotics", domain: "acme-robotics.example", industry: "robotics", employeeCount: 210, icpFitScore: "82", stage: "prospect" },
        { orgId: org.id, name: "GlobeX", domain: "globex.example", industry: "logistics", employeeCount: 1200, icpFitScore: "55", stage: "customer" },
        { orgId: org.id, name: "さくら産業", domain: "sakura-sangyo.example", industry: "manufacturing", employeeCount: 480, icpFitScore: "71", stage: "prospect" },
        { orgId: org.id, name: "Nordic Systems", domain: "nordic-systems.example", industry: "devtools", employeeCount: 340, icpFitScore: "96", stage: "prospect" },
        { orgId: org.id, name: "Hummingbird Labs", domain: "hummingbird.example", industry: "ai", employeeCount: 90, icpFitScore: "88", stage: "opportunity" },
        { orgId: org.id, name: "株式会社つばめ", domain: "tsubame.example", industry: "fintech", employeeCount: 150, icpFitScore: "64", stage: "prospect" },
        { orgId: org.id, name: "Cascade AI", domain: "cascade-ai.example", industry: "ai", employeeCount: 45, icpFitScore: "45", stage: "prospect" },
        { orgId: org.id, name: "Polar Bear Energy", domain: "polarbear.example", industry: "energy", employeeCount: 800, icpFitScore: "33", stage: "prospect" },
      ])
      .returning();

    await tx.insert(schema.people).values([
      { orgId: org.id, accountId: acme.id, name: "Rin Sato", email: "rin@acme-robotics.example", role: "Head of Sales" },
      { orgId: org.id, accountId: globex.id, name: "Mark Chen", email: "mark@globex.example", role: "VP Revenue" },
      { orgId: org.id, accountId: nordic.id, name: "Elena Marlow", email: "elena@nordic-systems.example", role: "VP Sales" },
      { orgId: org.id, accountId: nordic.id, name: "Jonas Berg", email: "jonas@nordic-systems.example", role: "RevOps Lead" },
      { orgId: org.id, accountId: hummingbird.id, name: "Priya Shah", email: "priya@hummingbird.example", role: "Head of Growth" },
      { orgId: org.id, accountId: tsubame.id, name: "田中 翼", email: "tanaka@tsubame.example", role: "営業本部長" },
    ]);

    const [stalledDeal] = await tx
      .insert(schema.deals)
      .values([
        {
          orgId: org.id,
          accountId: acme.id,
          name: "Acme Robotics - Platform",
          stage: "negotiation",
          amount: "48000",
          ownerId: user.id,
          lastActivityAt: new Date(Date.now() - 30 * 86400_000),
        },
        {
          orgId: org.id,
          accountId: globex.id,
          name: "GlobeX - Renewal",
          stage: "open",
          amount: "120000",
          ownerId: user.id,
          lastActivityAt: new Date(Date.now() - 2 * 86400_000),
        },
      ])
      .returning();

    await tx.insert(schema.conversations).values([
      {
        orgId: org.id,
        accountId: acme.id,
        channel: "email",
        subject: "Re: Platform pricing",
        participants: ["rin@acme-robotics.example", "admin@aigtm.local"],
        summary: "Asked for pricing; went quiet after legal review mention.",
        occurredAt: new Date(Date.now() - 30 * 86400_000),
      },
      {
        orgId: org.id,
        accountId: nordic.id,
        channel: "meeting",
        subject: "Intro call — GTM stack",
        participants: ["elena@nordic-systems.example", "admin@aigtm.local"],
        summary: "Elena is rebuilding the outbound motion post-Series B. Evaluating tools this quarter.",
        occurredAt: new Date(Date.now() - 6 * 86400_000),
      },
      {
        orgId: org.id,
        accountId: nordic.id,
        channel: "email",
        subject: "Follow-up: pilot scope",
        participants: ["jonas@nordic-systems.example", "admin@aigtm.local"],
        summary: "Jonas asked for a pilot scoped to the Nordics sales pod.",
        occurredAt: new Date(Date.now() - 3 * 86400_000),
      },
      {
        orgId: org.id,
        accountId: tsubame.id,
        channel: "email",
        subject: "営業企画部の新設について",
        participants: ["tanaka@tsubame.example", "admin@aigtm.local"],
        summary: "営業企画部の立ち上げに伴い、GTM ツールの選定を開始。来月ヒアリング予定。",
        occurredAt: new Date(Date.now() - 4 * 86400_000),
      },
      {
        orgId: org.id,
        accountId: hummingbird.id,
        channel: "slack",
        subject: "#growth — tool evaluation",
        participants: ["priya@hummingbird.example"],
        summary: "Priya shared headcount plans: 6 GTM roles this quarter.",
        occurredAt: new Date(Date.now() - 1 * 86400_000),
      },
    ]);

    await tx.insert(schema.knowledge).values([
      {
        orgId: org.id,
        subjectType: "account",
        subjectId: nordic.id,
        claim: "Post-Series B; rebuilding outbound motion. Elena Marlow is the economic buyer; Jonas Berg runs RevOps evaluation.",
        confidence: "0.9",
        validFrom: new Date(Date.now() - 6 * 86400_000),
      },
      {
        orgId: org.id,
        subjectType: "account",
        subjectId: nordic.id,
        claim: "Pilot scope requested: Nordics sales pod only.",
        confidence: "0.85",
        validFrom: new Date(Date.now() - 3 * 86400_000),
      },
      {
        orgId: org.id,
        subjectType: "deal",
        subjectId: stalledDeal.id,
        claim: "Stall reason: legal review mention caused silence for 30 days.",
        confidence: "0.7",
        validFrom: new Date(Date.now() - 2 * 86400_000),
      },
    ]);

    const [sig, execSig, fundingSig, headcountSig] = await tx
      .insert(schema.signals)
      .values([
        { orgId: org.id, name: "First GTM hire", spec: jobPostingSignalSpec },
        { orgId: org.id, name: "Executive hire", spec: jobPostingSignalSpec },
        { orgId: org.id, name: "New funding round", spec: jobPostingSignalSpec },
        { orgId: org.id, name: "Headcount growth", spec: jobPostingSignalSpec },
      ])
      .returning();

    await tx.insert(schema.signalEvents).values([
      {
        orgId: org.id,
        signalId: sig.id,
        accountId: sakura.id,
        evidence: {
          source: "job_boards",
          url: "https://example.com/jobs/sakura-gtm-1",
          excerpt: "グロース責任者（初のGTM採用）を募集",
        },
        score: "0.71",
      },
      {
        orgId: org.id,
        signalId: sig.id,
        accountId: acme.id,
        evidence: { source: "job_boards", url: "https://example.com/jobs/acme-revops", excerpt: "First RevOps lead" },
        score: "0.82",
      },
      {
        orgId: org.id,
        signalId: execSig.id,
        accountId: nordic.id,
        evidence: { source: "linkedin", url: "https://example.com/nordic-vp", excerpt: "New VP of Revenue Operations, ex-unicorn" },
        score: "0.96",
      },
      {
        orgId: org.id,
        signalId: fundingSig.id,
        accountId: nordic.id,
        evidence: { source: "news", url: "https://example.com/nordic-b", excerpt: "Series B $40M" },
        score: "0.9",
      },
      {
        orgId: org.id,
        signalId: headcountSig.id,
        accountId: hummingbird.id,
        evidence: { source: "job_boards", url: "https://example.com/hb-jobs", excerpt: "+18% headcount in 90 days, 6 GTM roles open" },
        score: "0.88",
      },
      {
        orgId: org.id,
        signalId: execSig.id,
        accountId: tsubame.id,
        evidence: { source: "job_boards", url: "https://example.com/tsubame-vp", excerpt: "営業企画部長を新規公募" },
        score: "0.64",
      },
      {
        orgId: org.id,
        signalId: fundingSig.id,
        accountId: cascade.id,
        evidence: { source: "news", url: "https://example.com/cascade-seed", excerpt: "Seed $6M" },
        score: "0.45",
      },
    ]);

    const [agent, outboundAgent] = await tx
      .insert(schema.agents)
      .values([
        { orgId: org.id, name: "Stalled Deal Recovery", spec: stalledDealRecoverySpec },
        { orgId: org.id, name: "Outbound to high ICP fit", spec: outboundSpec },
      ])
      .returning();

    const [run] = await tx
      .insert(schema.runs)
      .values({
        orgId: org.id,
        agentId: agent.id,
        triggerKind: "manual",
        status: "fulfilled",
        tokensIn: 1240,
        tokensOut: 380,
        finishedAt: new Date(),
      })
      .returning();

    await tx.insert(schema.runSteps).values([
      {
        orgId: org.id,
        runId: run.id,
        stepId: "find_stalled",
        kind: "tool",
        tool: "deals.stalled",
        input: { days: 14 },
        output: { deals: [{ id: stalledDeal.id, name: stalledDeal.name, stage: "negotiation" }] },
        latencyMs: 103,
      },
      {
        orgId: org.id,
        runId: run.id,
        stepId: "diagnose",
        kind: "llm",
        model: "mock:reasoning",
        output: {
          stall_reason: "Went quiet after legal review mention",
          evidence: ["Re: Platform pricing — 30 days no reply"],
        },
        tokensIn: 640,
        tokensOut: 120,
        latencyMs: 412,
      },
      {
        orgId: org.id,
        runId: run.id,
        stepId: "draft",
        kind: "llm",
        model: "mock:writing",
        output: { note_draft: "[mock] draft recovery note referencing last thread" },
        tokensIn: 600,
        tokensOut: 260,
        latencyMs: 388,
      },
    ]);

    const [run2] = await tx
      .insert(schema.runs)
      .values({
        orgId: org.id,
        agentId: outboundAgent.id,
        triggerKind: "event",
        triggerContext: { signal: "Executive hire", account: "Nordic Systems", score: 0.96 },
        status: "fulfilled",
        tokensIn: 820,
        tokensOut: 210,
        finishedAt: new Date(Date.now() - 3600_000),
      })
      .returning();

    await tx.insert(schema.runSteps).values([
      {
        orgId: org.id,
        runId: run2.id,
        stepId: "research",
        kind: "tool",
        tool: "accounts.lookup",
        output: { account: { name: "Nordic Systems", icpFitScore: 96, stage: "prospect" } },
        latencyMs: 87,
      },
      {
        orgId: org.id,
        runId: run2.id,
        stepId: "draft",
        kind: "llm",
        model: "mock:writing",
        output: { email_draft: "[mock] first-touch draft for Nordic Systems" },
        tokensIn: 820,
        tokensOut: 210,
        latencyMs: 502,
      },
    ]);

    const [ob] = await tx
      .insert(schema.outbox)
      .values({
        orgId: org.id,
        runId: run.id,
        kind: "create_task",
        payload: {
          title: `Recovery note for ${stalledDeal.name}`,
          body: "[mock] draft recovery note referencing last thread",
          dealId: stalledDeal.id,
        },
        status: "pending_approval",
      })
      .returning();

    const [ap] = await tx
      .insert(schema.approvals)
      .values({
        orgId: org.id,
        runId: run.id,
        outboxId: ob.id,
        kind: "review_action",
        payload: {
          agent: "Stalled Deal Recovery",
          action: "create_task",
          preview: {
            find_stalled: { deals: [stalledDeal.name] },
            draft: { note_draft: `[mock] draft recovery note for ${stalledDeal.name}` },
          },
        },
        status: "pending",
      })
      .returning();

    await audit(tx, { orgId: org.id, actorType: "system" }, {
      action: "seed.created",
      entityType: "approval",
      entityId: ap.id,
      detail: { note: "demo seed" },
    });

    // A second pending approval carrying a full email draft, so the
    // for-review pane can render the artifact a human is approving.
    const [ob2] = await tx
      .insert(schema.outbox)
      .values({
        orgId: org.id,
        runId: run2.id,
        kind: "draft_email",
        payload: {
          action: "send_email",
          from: "admin@aigtm.local",
          to: "Elena Marlow · elena@nordic-systems.example",
          subject: "Nordic Systems の GTM 体制立ち上げについて",
          body: "Elena さま\n\nVP of Revenue Operations の着任と Series B 調達、拝見しました。立ち上げ期の GTM 体制づくりを支援しています。\n\n来週 20 分ほどお時間をいただけますか？\n\nAdmin",
          mock: true,
        },
        status: "pending_approval",
      })
      .returning();
    const [ap2] = await tx
      .insert(schema.approvals)
      .values({
        orgId: org.id,
        runId: run2.id,
        outboxId: ob2.id,
        kind: "review_action",
        payload: {
          agent: "Outbound to high ICP fit",
          action: "send_email",
          preview: {
            research: { account: "Nordic Systems", score: 96 },
            draft: { note_draft: "email ready for review" },
          },
        },
        status: "pending",
      })
      .returning();
    await audit(tx, { orgId: org.id, actorType: "system" }, {
      action: "seed.created",
      entityType: "approval",
      entityId: ap2.id,
      detail: { note: "demo seed: draft email" },
    });
  });

  return { userId: user.id, orgId: org.id };
}

// CLI entry: pnpm --filter @aigtm/db seed
if (process.argv[1] && process.argv[1].endsWith("seed.ts")) {
  const handle = await createDb();
  await migrate(handle);
  const ids = await seed(handle);
  console.log("seeded:", ids);
  await handle.close();
}
