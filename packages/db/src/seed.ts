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
    const [acme, globex, sakura] = await tx
      .insert(schema.accounts)
      .values([
        { orgId: org.id, name: "Acme Robotics", domain: "acme-robotics.example", industry: "robotics", employeeCount: 210, icpFitScore: "82", stage: "prospect" },
        { orgId: org.id, name: "GlobeX", domain: "globex.example", industry: "logistics", employeeCount: 1200, icpFitScore: "55", stage: "customer" },
        { orgId: org.id, name: "さくら産業", domain: "sakura-sangyo.example", industry: "manufacturing", employeeCount: 480, icpFitScore: "71", stage: "prospect" },
      ])
      .returning();

    await tx.insert(schema.people).values([
      { orgId: org.id, accountId: acme.id, name: "Rin Sato", email: "rin@acme-robotics.example", role: "Head of Sales" },
      { orgId: org.id, accountId: globex.id, name: "Mark Chen", email: "mark@globex.example", role: "VP Revenue" },
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
    ]);

    const [sig] = await tx
      .insert(schema.signals)
      .values({ orgId: org.id, name: "First GTM hire", spec: jobPostingSignalSpec })
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
    ]);

    const [agent] = await tx
      .insert(schema.agents)
      .values({ orgId: org.id, name: "Stalled Deal Recovery", spec: stalledDealRecoverySpec })
      .returning();

    const [run] = await tx
      .insert(schema.runs)
      .values({
        orgId: org.id,
        agentId: agent.id,
        triggerKind: "manual",
        status: "fulfilled",
        finishedAt: new Date(),
      })
      .returning();

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
