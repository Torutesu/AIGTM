import { eq, and } from "drizzle-orm";
import { schema, withOrg, type DbHandle, type OrgContext } from "@aigtm/db";

/**
 * Mock connectors. Phase 0 never touches external services — these return
 * deterministic fixtures so the capture pipeline (fetch → normalize →
 * entity-resolve → store) is exercisable end to end. Real connectors
 * (Gmail/Calendar/Slack/Composio) implement this interface later.
 */

export interface RawMessage {
  externalId: string;
  channel: "email" | "call" | "meeting" | "slack";
  subject: string;
  from: string;
  to: string[];
  body: string;
  occurredAt: string; // ISO
}

export const gmailFixtures: RawMessage[] = [
  {
    externalId: "msg-001",
    channel: "email",
    subject: "Re: Platform pricing",
    from: "rin@acme-robotics.example",
    to: ["admin@aigtm.local"],
    body: "Thanks — can you send over the pricing deck? Legal is reviewing on our side.",
    occurredAt: new Date(Date.now() - 30 * 86400_000).toISOString(),
  },
  {
    externalId: "msg-002",
    channel: "email",
    subject: "Renewal timeline",
    from: "mark@globex.example",
    to: ["admin@aigtm.local"],
    body: "Renewal is on track, procurement wants the security docs this week.",
    occurredAt: new Date(Date.now() - 2 * 86400_000).toISOString(),
  },
];

export interface Connector {
  name: string;
  fetch(): Promise<RawMessage[]>;
}

export class MockGmailConnector implements Connector {
  name = "gmail-mock";
  async fetch() {
    return gmailFixtures;
  }
}

/**
 * Ingest raw messages into conversations: resolve sender domains to
 * accounts, normalize, dedupe by (channel, subject). Shared by connector
 * sync and the /api/ingest webhook — entity resolution is domain-match only
 * for now.
 */
export async function ingestMessages(
  handle: DbHandle,
  ctx: OrgContext,
  messages: RawMessage[],
) {
  return withOrg(handle, ctx, async (tx) => {
    const accounts = await tx
      .select()
      .from(schema.accounts)
      .where(eq(schema.accounts.orgId, ctx.orgId));
    const byDomain = new Map(
      accounts.filter((a: { domain: string | null }) => a.domain).map((a: { id: string; domain: string | null }) => [a.domain!, a.id]),
    );

    let inserted = 0;
    for (const m of messages) {
      const domain = m.from.split("@")[1];
      const accountId = domain ? byDomain.get(domain) : undefined;
      const existing = await tx
        .select({ id: schema.conversations.id })
        .from(schema.conversations)
        .where(
          and(
            eq(schema.conversations.orgId, ctx.orgId),
            eq(schema.conversations.channel, m.channel),
            eq(schema.conversations.subject, m.subject),
          ),
        )
        .limit(1);
      if (existing.length) continue;
      await tx.insert(schema.conversations).values({
        orgId: ctx.orgId,
        accountId: accountId ?? null,
        channel: m.channel,
        subject: m.subject,
        participants: [m.from, ...(m.to ?? [])],
        summary: m.body.slice(0, 500),
        occurredAt: m.occurredAt ? new Date(m.occurredAt) : new Date(),
      });
      inserted++;
    }
    return { fetched: messages.length, inserted };
  });
}

/**
 * Ingest a signal event (webhook). Resolves the account by id or domain and
 * the signal by id or name; both are optional in the schema but resolution
 * is what makes event-triggered agents useful.
 */
export async function ingestSignalEvent(
  handle: DbHandle,
  ctx: OrgContext,
  ev: {
    signalId?: string;
    signalName?: string;
    accountId?: string;
    accountDomain?: string;
    personId?: string;
    score?: number;
    evidence?: Record<string, unknown>;
    detectedAt?: string;
  },
) {
  return withOrg(handle, ctx, async (tx) => {
    let accountId = ev.accountId ?? null;
    if (!accountId && ev.accountDomain) {
      const [a] = await tx
        .select({ id: schema.accounts.id })
        .from(schema.accounts)
        .where(eq(schema.accounts.domain, ev.accountDomain))
        .limit(1);
      accountId = a?.id ?? null;
    }
    let signalId = ev.signalId ?? null;
    if (!signalId && ev.signalName) {
      const [s] = await tx
        .select({ id: schema.signals.id })
        .from(schema.signals)
        .where(eq(schema.signals.name, ev.signalName))
        .limit(1);
      signalId = s?.id ?? null;
    }
    const [row] = await tx
      .insert(schema.signalEvents)
      .values({
        orgId: ctx.orgId,
        signalId,
        accountId,
        personId: ev.personId ?? null,
        evidence: ev.evidence ?? {},
        score: ev.score != null ? String(ev.score) : null,
        detectedAt: ev.detectedAt ? new Date(ev.detectedAt) : new Date(),
      })
      .returning();
    return row as { id: string };
  });
}

/**
 * Ingest messages into conversations via a connector (mock in Phase 0).
 */
export async function syncConversations(
  handle: DbHandle,
  ctx: OrgContext,
  connector: Connector = new MockGmailConnector(),
) {
  const messages = await connector.fetch();
  return ingestMessages(handle, ctx, messages);
}
