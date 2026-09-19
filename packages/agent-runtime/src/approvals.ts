import { eq, and, inArray, sql } from "drizzle-orm";
import { schema, withOrg, audit, type DbHandle, type OrgContext } from "@aigtm/db";
import { logEvent } from "./log";

const EMAIL_KINDS = new Set(["send_email", "draft_email"]);
const MAX_DISPATCH_ATTEMPTS = 5;

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Extract an RFC-5322-ish address from loose recipient strings such as
 * "Elena Marlow · elena@x.example" or "Elena <elena@x.example>".
 */
function extractEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const m = raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return m ? m[0] : null;
}

/** Resolve {to, subject, body} from an outbox payload (edited body wins). */
function emailFields(payload: Record<string, any>) {
  const ctx = (payload.context ?? {}) as Record<string, any>;
  const steps = Object.values(ctx).filter(
    (v): v is Record<string, any> => typeof v === "object" && v !== null,
  );
  const pick = (...keys: string[]) => {
    for (const k of keys) {
      if (typeof payload[k] === "string" && payload[k]) return payload[k];
      for (const s of steps) {
        if (typeof s[k] === "string" && s[k]) return s[k];
      }
    }
    return null;
  };
  return {
    to: extractEmail(pick("to", "recipient", "email")),
    subject: pick("subject") ?? "(no subject)",
    body: pick("body", "text", "note_draft"),
  };
}

async function sendViaResend(payload: Record<string, any>) {
  const apiKey = process.env.AIGTM_RESEND_API_KEY;
  const from = process.env.AIGTM_EMAIL_FROM;
  if (!apiKey || !from)
    throw new Error("AIGTM_RESEND_API_KEY and AIGTM_EMAIL_FROM are required");
  const { to, subject, body } = emailFields(payload);
  if (!to) throw new Error("outbox payload has no resolvable recipient");
  if (!body) throw new Error("outbox payload has no body");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to, subject, text: body }),
  });
  if (!res.ok) {
    const msg = (await res.text()).slice(0, 300);
    throw new Error(`resend ${res.status}: ${msg}`);
  }
  return (await res.json()) as { id?: string };
}

/**
 * Dispatch a released outbox row. Runs outside the approval transaction so
 * a provider failure never rolls back the recorded decision.
 *
 * Real send: kind ∈ {send_email, draft_email} AND
 * AIGTM_EMAIL_PROVIDER=resend (+AIGTM_RESEND_API_KEY, AIGTM_EMAIL_FROM).
 * Anything else transitions to `dispatched` with `mock: true` in audit —
 * marked, not hidden. Failures land on `failed` and are retried by
 * dispatchPendingOutbox (worker sweep), capped at MAX_DISPATCH_ATTEMPTS.
 */
export async function dispatchOutbox(
  handle: DbHandle,
  ctx: OrgContext,
  outboxId: string,
) {
  const provider = process.env.AIGTM_EMAIL_PROVIDER;
  let realResult: { id?: string } | null = null;
  let error: string | null = null;

  const row = await withOrg(handle, ctx, async (tx) => {
    const [ob] = await tx
      .select()
      .from(schema.outbox)
      .where(eq(schema.outbox.id, outboxId))
      .limit(1);
    return ob as any | undefined;
  });
  if (!row || !["released", "failed"].includes(row.status)) return;

  const payload = (row.payload ?? {}) as Record<string, any>;
  const attempts = Number(payload.dispatchAttempts ?? 0) + 1;
  const real = EMAIL_KINDS.has(row.kind) && provider === "resend";
  if (real) {
    try {
      realResult = await sendViaResend(payload);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      logEvent("outbox.dispatch_error", {
        outboxId,
        kind: row.kind,
        attempts,
        error,
      });
    }
  }

  const delivered = real && !error;
  await withOrg(handle, { ...ctx, actorType: "system" }, async (tx) => {
    await tx
      .update(schema.outbox)
      .set({
        status: delivered || !real ? "dispatched" : "failed",
        dispatchedAt: delivered || !real ? new Date() : null,
        payload: { ...payload, dispatchAttempts: attempts },
      })
      .where(eq(schema.outbox.id, outboxId));
    await audit(tx, { ...ctx, actorType: "system" }, {
      action: delivered || !real ? "outbox.dispatched" : "outbox.dispatch_failed",
      entityType: "outbox",
      entityId: outboxId,
      detail: delivered
        ? { kind: row.kind, provider: "resend", messageId: realResult?.id }
        : real
          ? { kind: row.kind, error, attempts }
          : {
              kind: row.kind,
              mock: true,
              reason: EMAIL_KINDS.has(row.kind)
                ? "AIGTM_EMAIL_PROVIDER not configured"
                : `no connector for ${row.kind}`,
            },
    });
  });
}

/**
 * Worker sweep: retry released-but-undispatched and failed outbox rows
 * (bounded attempts). Approval stays human-gated — this only retries
 * delivery of already-approved actions.
 */
export async function dispatchPendingOutbox(
  handle: DbHandle,
  ctx: OrgContext,
): Promise<number> {
  const rows = await withOrg(handle, ctx, async (tx) => {
    return (await tx
      .select({ id: schema.outbox.id, payload: schema.outbox.payload })
      .from(schema.outbox)
      .where(
        and(
          inArray(schema.outbox.status, ["released", "failed"]),
          sql`coalesce((${schema.outbox.payload}->>'dispatchAttempts')::int, 0) < ${MAX_DISPATCH_ATTEMPTS}`,
        ),
      )) as { id: string }[];
  });
  for (const r of rows) await dispatchOutbox(handle, ctx, r.id);
  return rows.length;
}

/** Approve or reject a pending approval. Approving dispatches the outbox. */
export async function decideApproval(
  handle: DbHandle,
  ctx: OrgContext,
  approvalId: string,
  decision: "approved" | "rejected",
  reason?: string,
  edits?: { body?: string },
) {
  const res = await withOrg(
    handle,
    { ...ctx, actorType: "user" },
    async (tx) => {
      const [ap] = await tx
        .select()
        .from(schema.approvals)
        .where(
          and(eq(schema.approvals.id, approvalId), eq(schema.approvals.status, "pending")),
        )
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

      const edited = decision === "approved" && edits?.body != null;
      await audit(tx, ctx, {
        action: "approval.decided",
        entityType: "approval",
        entityId: approvalId,
        detail: { decision, reason: reason ?? null, edited },
      });

      if (ap.outboxId) {
        if (decision === "approved") {
          const set: Record<string, any> = { status: "released" };
          if (edits?.body != null) {
            const [cur] = await tx
              .select({ payload: schema.outbox.payload })
              .from(schema.outbox)
              .where(eq(schema.outbox.id, ap.outboxId))
              .limit(1);
            set.payload = {
              ...(typeof cur?.payload === "object" && cur.payload !== null
                ? (cur.payload as Record<string, unknown>)
                : {}),
              body: edits.body,
              editedBy: ctx.userId,
            };
          }
          await tx
            .update(schema.outbox)
            .set(set)
            .where(eq(schema.outbox.id, ap.outboxId));
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
      return { approvalId, decision, outboxId: ap.outboxId };
    },
  );

  if (decision === "approved" && res.outboxId) {
    await dispatchOutbox(handle, ctx, res.outboxId);
  }
  return { approvalId: res.approvalId, decision: res.decision };
}
