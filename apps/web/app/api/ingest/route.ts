import { ensureDb } from "../../../lib/db";
import {
  schema,
  hashSecret,
  audit,
  withOrg,
  type OrgProviderConfig,
} from "@aigtm/db";
import {
  ingestMessages,
  ingestSignalEvent,
  type RawMessage,
} from "@aigtm/connectors";

export const dynamic = "force-dynamic";

const CHANNELS = new Set(["email", "call", "meeting", "slack"]);

/**
 * POST /api/ingest — org-scoped webhook intake.
 *
 *   Authorization: Bearer <ingest key from /settings>
 *   { "type": "message",       channel, subject?, from, to?, body, occurredAt? }
 *   { "type": "signal_event",  signalName?|signalId?, accountDomain?|accountId?,
 *                              score?, evidence?, detectedAt? }
 *
 * Messages land in conversations (domain-resolved, deduped); signal events
 * land in signal_events and can fire `event: signal_event` agents on the
 * next worker tick.
 */
export async function POST(req: Request) {
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) {
    return Response.json({ error: "missing bearer token" }, { status: 401 });
  }

  const handle = await ensureDb();
  const hash = hashSecret(token);
  const orgs = (await handle.db
    .select({
      id: schema.organizations.id,
      providerConfig: schema.organizations.providerConfig,
    })
    .from(schema.organizations)) as {
    id: string;
    providerConfig: OrgProviderConfig | null;
  }[];
  const org = orgs.find((o) => o.providerConfig?.ingestKeyHash === hash);
  if (!org) {
    return Response.json({ error: "invalid key" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }

  const ctx = { orgId: org.id, actorType: "system" as const, actorId: "ingest" };

  if (body.type === "message") {
    const m = body;
    if (
      typeof m.channel !== "string" ||
      !CHANNELS.has(m.channel) ||
      typeof m.from !== "string" ||
      typeof m.body !== "string"
    ) {
      return Response.json(
        { error: "message requires channel(email|call|meeting|slack), from, body" },
        { status: 400 },
      );
    }
    const msg: RawMessage = {
      externalId: String(m.externalId ?? ""),
      channel: m.channel as RawMessage["channel"],
      subject: String(m.subject ?? "(no subject)"),
      from: m.from,
      to: Array.isArray(m.to) ? m.to.map(String) : [],
      body: m.body,
      occurredAt: String(m.occurredAt ?? new Date().toISOString()),
    };
    const res = await ingestMessages(handle, ctx, [msg]);
    await auditApi(handle, org.id, "ingest.message", {
      channel: msg.channel,
      from: msg.from,
      inserted: res.inserted,
    });
    return Response.json({ ok: true, ...res });
  }

  if (body.type === "signal_event") {
    const row = await ingestSignalEvent(handle, ctx, {
      signalId: body.signalId ? String(body.signalId) : undefined,
      signalName: body.signalName ? String(body.signalName) : undefined,
      accountId: body.accountId ? String(body.accountId) : undefined,
      accountDomain: body.accountDomain ? String(body.accountDomain) : undefined,
      personId: body.personId ? String(body.personId) : undefined,
      score: body.score != null ? Number(body.score) : undefined,
      evidence:
        body.evidence && typeof body.evidence === "object"
          ? (body.evidence as Record<string, unknown>)
          : undefined,
      detectedAt: body.detectedAt ? String(body.detectedAt) : undefined,
    });
    await auditApi(handle, org.id, "ingest.signal_event", {
      signalEventId: row.id,
      signalName: body.signalName ?? null,
      accountDomain: body.accountDomain ?? null,
    });
    return Response.json({ ok: true, id: row.id });
  }

  return Response.json(
    { error: 'type must be "message" or "signal_event"' },
    { status: 400 },
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function auditApi(handle: any, orgId: string, action: string, detail: object) {
  await withOrg(
    handle,
    { orgId, actorType: "system", actorId: "ingest" },
    (tx) =>
      audit(tx, { orgId, actorType: "system", actorId: "ingest" }, {
        action,
        entityType: "organization",
        entityId: orgId,
        detail,
      }),
  );
}
