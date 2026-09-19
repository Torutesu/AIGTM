import { eq, and, inArray, sql } from "drizzle-orm";
import {
  schema,
  withOrg,
  audit,
  decryptSecret,
  type DbHandle,
  type OrgContext,
  type OrgProviderConfig,
} from "@aigtm/db";
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

async function orgProviderConfig(
  handle: DbHandle,
  orgId: string,
): Promise<OrgProviderConfig> {
  const [org] = (await handle.db
    .select({ providerConfig: schema.organizations.providerConfig })
    .from(schema.organizations)
    .where(eq(schema.organizations.id, orgId))
    .limit(1)) as { providerConfig: OrgProviderConfig | null }[];
  return org?.providerConfig ?? {};
}

/** Slack text: edited body → digest/note fields → JSON of steps. */
function slackText(payload: Record<string, any>): string {
  const { body } = emailFields(payload);
  if (body) return body;
  const ctx = (payload.context ?? {}) as Record<string, any>;
  for (const v of Object.values(ctx)) {
    if (v && typeof v === "object") {
      for (const k of ["digest", "text", "summary"]) {
        if (typeof (v as any)[k] === "string") return (v as any)[k];
      }
    }
  }
  return JSON.stringify(payload).slice(0, 3000);
}

async function postToSlack(webhookUrl: string, payload: Record<string, any>) {
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: slackText(payload).slice(0, 3900) }),
  });
  if (!res.ok) {
    const msg = (await res.text()).slice(0, 300);
    throw new Error(`slack webhook ${res.status}: ${msg}`);
  }
  return { ok: true };
}

async function postToActionWebhook(url: string, kind: string, orgId: string, payload: Record<string, any>) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind, orgId, payload }),
  });
  if (!res.ok) {
    const msg = (await res.text()).slice(0, 300);
    throw new Error(`action webhook ${res.status}: ${msg}`);
  }
  return { ok: true };
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
 * Provider resolution order:
 *  - email kinds (send_email/draft_email) + AIGTM_EMAIL_PROVIDER=resend
 *    → api.resend.com
 *  - post_slack + org Slack webhook (Settings → Integrations) → Slack
 *  - any kind + org action webhook → POST {kind, orgId, payload}
 *  - otherwise → marked mock dispatch (audit records mock: true + reason)
 *
 * Failures land on `failed` and are retried by dispatchPendingOutbox
 * (worker sweep), capped at MAX_DISPATCH_ATTEMPTS.
 */
export async function dispatchOutbox(
  handle: DbHandle,
  ctx: OrgContext,
  outboxId: string,
) {
  let realResult: { id?: string } | null = null;
  let providerName: string | null = null;
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
  const cfg = await orgProviderConfig(handle, ctx.orgId);
  const slackUrl = decryptSecret(cfg.slackWebhookUrl);
  const actionUrl = decryptSecret(cfg.actionWebhookUrl);
  const resend =
    EMAIL_KINDS.has(row.kind) &&
    process.env.AIGTM_EMAIL_PROVIDER === "resend";

  try {
    if (resend) {
      realResult = await sendViaResend(payload);
      providerName = "resend";
    } else if (row.kind === "post_slack" && slackUrl) {
      await postToSlack(slackUrl, payload);
      providerName = "slack";
    } else if (actionUrl) {
      await postToActionWebhook(actionUrl, row.kind, ctx.orgId, payload);
      providerName = "webhook";
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    providerName = null;
    logEvent("outbox.dispatch_error", {
      outboxId,
      kind: row.kind,
      attempts,
      error,
    });
  }

  const delivered = providerName !== null && !error;
  const realAttempted = resend || (row.kind === "post_slack" && !!slackUrl) || !!actionUrl;
  await withOrg(handle, { ...ctx, actorType: "system" }, async (tx) => {
    await tx
      .update(schema.outbox)
      .set({
        status: delivered || !realAttempted ? "dispatched" : "failed",
        dispatchedAt: delivered || !realAttempted ? new Date() : null,
        payload: { ...payload, dispatchAttempts: attempts },
      })
      .where(eq(schema.outbox.id, outboxId));
    await audit(tx, { ...ctx, actorType: "system" }, {
      action:
        delivered || !realAttempted
          ? "outbox.dispatched"
          : "outbox.dispatch_failed",
      entityType: "outbox",
      entityId: outboxId,
      detail: delivered
        ? providerName === "resend"
          ? { kind: row.kind, provider: "resend", messageId: realResult?.id }
          : { kind: row.kind, provider: providerName }
        : realAttempted
          ? { kind: row.kind, error, attempts }
          : {
              kind: row.kind,
              mock: true,
              reason: EMAIL_KINDS.has(row.kind)
                ? "AIGTM_EMAIL_PROVIDER not configured"
                : row.kind === "post_slack"
                  ? "org Slack webhook not configured"
                  : "no action webhook configured",
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
