import { eq, and } from "drizzle-orm";
import { schema, withOrg, audit, type DbHandle, type OrgContext } from "@aigtm/db";

/**
 * Mock dispatcher. Phase 0 sends NOTHING externally — dispatch only
 * transitions state and writes audit. Real senders (mail, slack, crm) plug
 * in here behind the same interface, gated by org settings.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function dispatchMock(tx: any, ctx: OrgContext, outboxId: string) {
  const [ob] = await tx
    .update(schema.outbox)
    .set({ status: "dispatched", dispatchedAt: new Date() })
    .where(eq(schema.outbox.id, outboxId))
    .returning();
  await audit(tx, ctx, {
    action: "outbox.dispatched",
    entityType: "outbox",
    entityId: outboxId,
    detail: { kind: ob?.kind, mock: true },
  });
  return ob;
}

/** Approve or reject a pending approval. Approving dispatches the outbox. */
export async function decideApproval(
  handle: DbHandle,
  ctx: OrgContext,
  approvalId: string,
  decision: "approved" | "rejected",
  reason?: string,
) {
  return withOrg(handle, { ...ctx, actorType: "user" }, async (tx) => {
    const [ap] = await tx
      .select()
      .from(schema.approvals)
      .where(and(eq(schema.approvals.id, approvalId), eq(schema.approvals.status, "pending")))
      .limit(1);
    if (!ap) throw new Error(`pending approval not found: ${approvalId}`);

    await tx
      .update(schema.approvals)
      .set({
        status: decision,
        decidedBy: ctx.userId,
        decidedAt: new Date(),
        reason: reason ?? null,
      })
      .where(eq(schema.approvals.id, approvalId));

    await audit(tx, ctx, {
      action: "approval.decided",
      entityType: "approval",
      entityId: approvalId,
      detail: { decision, reason: reason ?? null },
    });

    if (ap.outboxId) {
      if (decision === "approved") {
        await tx
          .update(schema.outbox)
          .set({ status: "released" })
          .where(eq(schema.outbox.id, ap.outboxId));
        await dispatchMock(tx, ctx, ap.outboxId);
      } else {
        await tx
          .update(schema.outbox)
          .set({ status: "cancelled" })
          .where(eq(schema.outbox.id, ap.outboxId));
        await audit(tx, ctx, {
          action: "outbox.cancelled",
          entityType: "outbox",
          entityId: ap.outboxId,
          detail: { reason: reason ?? null },
        });
      }
    }
    return { approvalId, decision };
  });
}
