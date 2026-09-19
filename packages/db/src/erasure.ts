/* eslint-disable @typescript-eslint/no-explicit-any */
import { eq, and } from "drizzle-orm";
import * as schema from "./schema";
import { audit, type OrgContext } from "./client";

/**
 * GDPR-style erasure. FK constraints make hard deletes unsafe, so erasure
 * anonymizes: PII fields are nulled/masked, the record remains (referential
 * integrity + a visible "[erased]" tombstone), and the event is audited.
 * Conversation message bodies/summaries are not rewritten — that's a
 * documented limit (see docs/08).
 */

const ERASED = "[erased]";

/** Scrub `email`/`name` out of every participants[] array in the org. */
async function scrubParticipants(tx: any, orgId: string, needles: string[]) {
  if (!needles.length) return 0;
  const convs = (await tx
    .select({ id: schema.conversations.id, participants: schema.conversations.participants })
    .from(schema.conversations)
    .where(eq(schema.conversations.orgId, orgId))) as {
    id: string;
    participants: string[] | null;
  }[];
  let touched = 0;
  for (const c of convs) {
    const parts = c.participants ?? [];
    if (!parts.some((p) => needles.includes(p))) continue;
    const next = parts.map((p) => (needles.includes(p) ? ERASED : p));
    await tx
      .update(schema.conversations)
      .set({ participants: next })
      .where(eq(schema.conversations.id, c.id));
    touched++;
  }
  return touched;
}

export async function erasePerson(
  tx: any,
  ctx: OrgContext,
  personId: string,
): Promise<{ erased: boolean }> {
  const [person] = await tx
    .select()
    .from(schema.people)
    .where(and(eq(schema.people.id, personId), eq(schema.people.orgId, ctx.orgId)))
    .limit(1);
  if (!person || person.name === ERASED) return { erased: false };

  const convTouched = await scrubParticipants(
    tx,
    ctx.orgId,
    [person.email, person.name].filter((v): v is string => !!v),
  );
  await tx
    .update(schema.people)
    .set({ name: ERASED, email: null, role: null })
    .where(eq(schema.people.id, personId));
  await audit(tx, ctx, {
    action: "person.erased",
    entityType: "person",
    entityId: personId,
    detail: { hadEmail: !!person.email, conversationsScrubbed: convTouched },
  });
  return { erased: true };
}

export async function eraseAccount(
  tx: any,
  ctx: OrgContext,
  accountId: string,
): Promise<{ erased: boolean; peopleErased: number }> {
  const [account] = await tx
    .select()
    .from(schema.accounts)
    .where(and(eq(schema.accounts.id, accountId), eq(schema.accounts.orgId, ctx.orgId)))
    .limit(1);
  if (!account || account.name === ERASED) return { erased: false, peopleErased: 0 };

  // erase all people attached to the account
  const people = (await tx
    .select({ id: schema.people.id })
    .from(schema.people)
    .where(and(eq(schema.people.accountId, accountId), eq(schema.people.orgId, ctx.orgId)))) as {
    id: string;
  }[];
  let peopleErased = 0;
  for (const p of people) {
    const r = await erasePerson(tx, ctx, p.id);
    if (r.erased) peopleErased++;
  }

  const convTouched = await scrubParticipants(
    tx,
    ctx.orgId,
    [account.domain, account.name].filter((v): v is string => !!v),
  );
  await tx
    .update(schema.accounts)
    .set({ name: ERASED, domain: null, industry: null })
    .where(eq(schema.accounts.id, accountId));
  await audit(tx, ctx, {
    action: "account.erased",
    entityType: "account",
    entityId: accountId,
    detail: { peopleErased, conversationsScrubbed: convTouched },
  });
  return { erased: true, peopleErased };
}
