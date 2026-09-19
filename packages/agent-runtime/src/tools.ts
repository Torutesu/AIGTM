import { and, eq, lt, ne, desc, isNull, sql } from "drizzle-orm";
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

  "accounts.lookup": async (tx, orgId, input) => {
    if (!input.accountId) throw new Error("accounts.lookup requires accountId");
    const [account] = await tx
      .select()
      .from(schema.accounts)
      .where(
        and(
          eq(schema.accounts.orgId, orgId),
          eq(schema.accounts.id, String(input.accountId)),
        ),
      )
      .limit(1);
    if (!account) throw new Error(`account not found: ${input.accountId}`);
    return account;
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
    if (!input.accountId) throw new Error("people.for_account requires accountId");
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
    if (!input.subjectId) throw new Error("knowledge.recent requires subjectId");
    return tx
      .select()
      .from(schema.knowledge)
      .where(
        and(
          eq(schema.knowledge.orgId, orgId),
          eq(schema.knowledge.subjectType, String(input.subjectType ?? "account")),
          eq(schema.knowledge.subjectId, String(input.subjectId)),
          isNull(schema.knowledge.validTo),
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

  // Segments are the org's saved audience filters — this is how they stop
  // being write-only CRUD: agent specs call `segments.members` to scope
  // their target list (e.g. outbound only to the "high-fit" segment).
  "segments.members": async (tx, orgId, input) => {
    if (!input.segment) throw new Error("segments.members requires segment (id or name)");
    const seg = String(input.segment);
    const [segment] = await tx
      .select()
      .from(schema.segments)
      .where(
        and(
          eq(schema.segments.orgId, orgId),
          // id is a uuid — match by name when the input isn't one
          sql`${schema.segments.id}::text = ${seg} OR ${schema.segments.name} = ${seg}`,
        ),
      )
      .limit(1);
    if (!segment) throw new Error(`segment not found: ${seg}`);
    const filter = (segment.filter ?? {}) as {
      minScore?: number;
      stage?: string;
      industry?: string;
    };
    const accounts = (await tx
      .select()
      .from(schema.accounts)
      .where(eq(schema.accounts.orgId, orgId))) as {
      id: string;
      name: string;
      icpFitScore: string | null;
      stage: string;
      industry: string | null;
    }[];
    const limit = Math.min(Math.max(Number(input.limit ?? 50), 1), 100);
    return accounts
      .filter(
        (a) =>
          (filter.minScore == null ||
            Number(a.icpFitScore ?? 0) >= filter.minScore) &&
          (!filter.stage || a.stage === filter.stage) &&
          (!filter.industry ||
            (a.industry ?? "")
              .toLowerCase()
              .includes(filter.industry.toLowerCase())),
      )
      .slice(0, limit);
  },
};
