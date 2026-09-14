import { and, eq, lt, ne, desc } from "drizzle-orm";
import { schema } from "@aigtm/db";

/**
 * Tool allowlist for agent steps. INVARIANT: tools are read-only or
 * draft-only — nothing here may send email, post externally, or write to
 * third-party systems. Anything that leaves the building goes through
 * spec.act → outbox → approval → dispatcher.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ToolFn = (tx: any, orgId: string, input: Record<string, unknown>) => Promise<unknown>;

export const tools: Record<string, ToolFn> = {
  "deals.stalled": async (tx, orgId, input) => {
    const days = Number(input.days ?? 14);
    const cutoff = new Date(Date.now() - days * 86400_000);
    return tx
      .select()
      .from(schema.deals)
      .where(
        and(
          eq(schema.deals.orgId, orgId),
          lt(schema.deals.lastActivityAt, cutoff),
          ne(schema.deals.stage, "closed"),
        ),
      )
      .orderBy(desc(schema.deals.amount));
  },

  "accounts.search": async (tx, orgId, input) => {
    const limit = Number(input.limit ?? 50);
    return tx
      .select()
      .from(schema.accounts)
      .where(eq(schema.accounts.orgId, orgId))
      .limit(limit);
  },

  "conversations.recent": async (tx, orgId, input) => {
    const days = Number(input.days ?? 90);
    const cutoff = new Date(Date.now() - days * 86400_000);
    const clauses = [
      eq(schema.conversations.orgId, orgId),
      lt(schema.conversations.occurredAt, new Date()),
    ];
    if (input.accountId) clauses.push(eq(schema.conversations.accountId, String(input.accountId)));
    void cutoff;
    return tx
      .select()
      .from(schema.conversations)
      .where(and(...clauses))
      .orderBy(desc(schema.conversations.occurredAt))
      .limit(50);
  },

  "people.for_account": async (tx, orgId, input) => {
    return tx
      .select()
      .from(schema.people)
      .where(
        and(
          eq(schema.people.orgId, orgId),
          eq(schema.people.accountId, String(input.accountId)),
        ),
      );
  },

  "knowledge.recent": async (tx, orgId, input) => {
    return tx
      .select()
      .from(schema.knowledge)
      .where(
        and(
          eq(schema.knowledge.orgId, orgId),
          eq(schema.knowledge.subjectType, String(input.subjectType ?? "account")),
          eq(schema.knowledge.subjectId, String(input.subjectId)),
        ),
      )
      .orderBy(desc(schema.knowledge.createdAt))
      .limit(20);
  },

  "signal_events.recent": async (tx, orgId) => {
    return tx
      .select()
      .from(schema.signalEvents)
      .where(eq(schema.signalEvents.orgId, orgId))
      .orderBy(desc(schema.signalEvents.detectedAt))
      .limit(50);
  },
};
