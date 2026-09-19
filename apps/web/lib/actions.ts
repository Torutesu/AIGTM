"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { and, eq } from "drizzle-orm";
import { signIn, signUp, signOut, SignInLocked } from "@aigtm/auth";
import { hashPassword } from "@aigtm/db";
import {
  executeRun,
  decideApproval,
  retryableAgentId,
  cancelRun,
  routerForOrg,
} from "@aigtm/agent-runtime";
import {
  schema,
  withOrg,
  audit,
  encryptSecret,
  newIngestKey,
  hashSecret,
  erasePerson,
  eraseAccount,
  type OrgProviderConfig,
} from "@aigtm/db";
import { ensureDb } from "./db";
import {
  SESSION_COOKIE,
  setSessionCookie,
  clearSessionCookie,
  currentSession,
} from "./session";
import { flash } from "./toast";

export async function signInAction(locale: string, formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) redirect(`/${locale}/login?error=invalid`);
  const handle = await ensureDb();
  let result;
  try {
    result = await signIn(handle, { email, password });
  } catch (e) {
    if (e instanceof SignInLocked) redirect(`/${locale}/login?error=locked`);
    throw e;
  }
  if (!result) redirect(`/${locale}/login?error=invalid`);
  await setSessionCookie(result.token);
  await flash("signedIn");
  redirect(`/${locale}/inbox`);
}

export async function signUpAction(locale: string, formData: FormData) {
  const handle = await ensureDb();
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  await signUp(handle, {
    email,
    password,
    name: String(formData.get("name") ?? ""),
    orgName: String(formData.get("orgName") ?? ""),
  });
  const res = await signIn(handle, { email, password });
  if (res) {
    await setSessionCookie(res.token);
    await flash("signedIn");
  }
  redirect(`/${locale}/inbox`);
}

export async function signOutAction(locale: string) {
  const handle = await ensureDb();
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await signOut(handle, token);
  await clearSessionCookie();
  redirect(`/${locale}/login`);
}

function requireActor(session: { role: string }) {
  if (session.role === "viewer") {
    throw new Error("forbidden: viewers cannot perform actions");
  }
}

function requireAdmin(session: { role: string }) {
  if (session.role !== "admin") {
    throw new Error("forbidden: admin role required");
  }
}

const MEMBER_ROLES = ["viewer", "editor", "admin"] as const;
type MemberRole = (typeof MEMBER_ROLES)[number];

function parseRole(raw: unknown): MemberRole {
  const r = String(raw ?? "");
  if (!(MEMBER_ROLES as readonly string[]).includes(r)) {
    throw new Error(`invalid role: ${r}`);
  }
  return r as MemberRole;
}

/** Transaction handle as passed to withOrg callbacks. */
type Tx = Parameters<Parameters<typeof withOrg>[2]>[0];

/** True when `targetUserId` is the org's last remaining admin.
 * memberships is not RLS-scoped, so always filter by orgId explicitly. */
async function isLastAdmin(
  tx: Tx,
  orgId: string,
  targetUserId: string,
): Promise<boolean> {
  const admins = (await tx
    .select({ userId: schema.memberships.userId })
    .from(schema.memberships)
    .where(
      and(
        eq(schema.memberships.orgId, orgId),
        eq(schema.memberships.role, "admin"),
      ),
    )) as { userId: string }[];
  return admins.length === 1 && admins[0].userId === targetUserId;
}

export async function updateMemberRoleAction(locale: string, formData: FormData) {
  const handle = await ensureDb();
  const session = await currentSession();
  if (!session) redirect(`/${locale}/login`);
  requireAdmin(session);
  const userId = String(formData.get("userId") ?? "");
  const role = parseRole(formData.get("role"));
  if (userId === session.userId) throw new Error("cannot change your own role");
  await withOrg(
    handle,
    { orgId: session.orgId, userId: session.userId },
    async (tx) => {
      if (role !== "admin" && (await isLastAdmin(tx, session.orgId, userId))) {
        throw new Error("cannot demote the last admin");
      }
      const updated = await tx
        .update(schema.memberships)
        .set({ role })
        .where(
          and(
            eq(schema.memberships.orgId, session.orgId),
            eq(schema.memberships.userId, userId),
          ),
        )
        .returning({ userId: schema.memberships.userId });
      if (!updated.length) throw new Error(`member not found: ${userId}`);
      await audit(
        tx,
        { orgId: session.orgId, userId: session.userId, actorType: "user" },
        {
          action: "member.role_changed",
          entityType: "membership",
          entityId: userId,
          detail: { role },
        },
      );
    },
  );
  await flash("roleChanged");
  revalidatePath(`/${locale}/settings`);
}

export async function addMemberAction(locale: string, formData: FormData) {
  const handle = await ensureDb();
  const session = await currentSession();
  if (!session) redirect(`/${locale}/login`);
  requireAdmin(session);
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const name = String(formData.get("name") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const role = parseRole(formData.get("role"));
  if (!email || !password) return;
  await withOrg(
    handle,
    { orgId: session.orgId, userId: session.userId },
    async (tx) => {
      let [user] = (await tx
        .select()
        .from(schema.users)
        .where(eq(schema.users.email, email))
        .limit(1)) as { id: string }[];
      if (!user) {
        [user] = await tx
          .insert(schema.users)
          .values({ email, name: name || email, passwordHash: hashPassword(password) })
          .returning({ id: schema.users.id });
      }
      const [existing] = (await tx
        .select()
        .from(schema.memberships)
        .where(
          and(
            eq(schema.memberships.orgId, session.orgId),
            eq(schema.memberships.userId, user.id),
          ),
        )
        .limit(1)) as { userId: string }[];
      if (existing) throw new Error(`already a member: ${email}`);
      await tx
        .insert(schema.memberships)
        .values({ orgId: session.orgId, userId: user.id, role });
      await audit(
        tx,
        { orgId: session.orgId, userId: session.userId, actorType: "user" },
        {
          action: "member.added",
          entityType: "membership",
          entityId: user.id,
          detail: { email, role },
        },
      );
    },
  );
  await flash("memberAdded");
  revalidatePath(`/${locale}/settings`);
}

export async function removeMemberAction(locale: string, formData: FormData) {
  const handle = await ensureDb();
  const session = await currentSession();
  if (!session) redirect(`/${locale}/login`);
  requireAdmin(session);
  const userId = String(formData.get("userId") ?? "");
  if (userId === session.userId) throw new Error("cannot remove yourself");
  await withOrg(
    handle,
    { orgId: session.orgId, userId: session.userId },
    async (tx) => {
      if (await isLastAdmin(tx, session.orgId, userId)) {
        throw new Error("cannot remove the last admin");
      }
      await tx
        .delete(schema.memberships)
        .where(
          and(
            eq(schema.memberships.orgId, session.orgId),
            eq(schema.memberships.userId, userId),
          ),
        );
      await audit(
        tx,
        { orgId: session.orgId, userId: session.userId, actorType: "user" },
        {
          action: "member.removed",
          entityType: "membership",
          entityId: userId,
          detail: {},
        },
      );
    },
  );
  await flash("memberRemoved");
  revalidatePath(`/${locale}/settings`);
}

export async function runAgentAction(locale: string, formData: FormData) {
  const handle = await ensureDb();
  const session = await currentSession();
  if (!session) redirect(`/${locale}/login`);
  requireActor(session);
  const agentId = String(formData.get("agentId") ?? "");
  await executeRun(
    handle,
    { orgId: session.orgId, userId: session.userId },
    { agentId, triggerKind: "manual" },
    await routerForOrg(handle, session.orgId),
  );
  await flash("runStarted");
  revalidatePath(`/${locale}/agents`);
  revalidatePath(`/${locale}/inbox`);
}

export async function decideApprovalAction(locale: string, formData: FormData) {
  const handle = await ensureDb();
  const session = await currentSession();
  if (!session) redirect(`/${locale}/login`);
  requireActor(session);
  const approvalId = String(formData.get("approvalId") ?? "");
  const decision = String(formData.get("decision")) === "rejected" ? "rejected" : "approved";
  const reason = String(formData.get("reason") ?? "").trim() || undefined;
  const editedBody = formData.get("editedBody");
  await decideApproval(
    handle,
    { orgId: session.orgId, userId: session.userId },
    approvalId,
    decision,
    reason,
    editedBody == null ? undefined : { body: String(editedBody) },
  );
  await flash(decision === "approved" ? "approved" : "dismissed");
  revalidatePath(`/${locale}/inbox`);
  revalidatePath(`/${locale}/approvals`);
}

export async function retryRunAction(locale: string, formData: FormData) {
  const handle = await ensureDb();
  const session = await currentSession();
  if (!session) redirect(`/${locale}/login`);
  requireActor(session);
  const runId = String(formData.get("runId") ?? "");
  const ctx = { orgId: session.orgId, userId: session.userId };
  const agentId = await retryableAgentId(handle, ctx, runId);
  const result = await executeRun(handle, ctx, {
    agentId,
    triggerKind: "manual",
    triggerContext: { retriedFrom: runId },
  }, await routerForOrg(handle, session.orgId));
  await flash("retried");
  revalidatePath(`/${locale}/agents`);
  redirect(`/${locale}/runs/${result.runId}`);
}

export async function cancelRunAction(locale: string, formData: FormData) {
  const handle = await ensureDb();
  const session = await currentSession();
  if (!session) redirect(`/${locale}/login`);
  requireActor(session);
  const runId = String(formData.get("runId") ?? "");
  await cancelRun(
    handle,
    { orgId: session.orgId, userId: session.userId },
    runId,
  );
  await flash("cancelled");
  revalidatePath(`/${locale}/runs/${runId}`);
  revalidatePath(`/${locale}/agents`);
}

const SEGMENT_STAGES = ["prospect", "opportunity", "customer"];

function parseSegmentFilter(formData: FormData) {
  const stage = String(formData.get("stage") ?? "");
  return {
    minScore: Number(formData.get("minScore")) || undefined,
    stage: SEGMENT_STAGES.includes(stage) ? stage : undefined,
    industry: String(formData.get("industry") ?? "").trim() || undefined,
  };
}

export async function createSegmentAction(locale: string, formData: FormData) {
  const handle = await ensureDb();
  const session = await currentSession();
  if (!session) redirect(`/${locale}/login`);
  requireActor(session);
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const filter = parseSegmentFilter(formData);
  await withOrg(
    handle,
    { orgId: session.orgId, userId: session.userId },
    async (tx) => {
      const [seg] = await tx
        .insert(schema.segments)
        .values({ orgId: session.orgId, name, filter })
        .returning();
      await audit(
        tx,
        { orgId: session.orgId, userId: session.userId, actorType: "user" },
        {
          action: "segment.created",
          entityType: "segment",
          entityId: seg.id,
          detail: { name, filter },
        },
      );
    },
  );
  await flash("segmentCreated");
  revalidatePath(`/${locale}/segments`);
}

export async function updateSegmentAction(locale: string, formData: FormData) {
  const handle = await ensureDb();
  const session = await currentSession();
  if (!session) redirect(`/${locale}/login`);
  requireActor(session);
  const segmentId = String(formData.get("segmentId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!segmentId || !name) return;
  const filter = parseSegmentFilter(formData);
  await withOrg(
    handle,
    { orgId: session.orgId, userId: session.userId },
    async (tx) => {
      await tx
        .update(schema.segments)
        .set({ name, filter })
        .where(
          and(
            eq(schema.segments.id, segmentId),
            eq(schema.segments.orgId, session.orgId),
          ),
        );
      await audit(
        tx,
        { orgId: session.orgId, userId: session.userId, actorType: "user" },
        {
          action: "segment.updated",
          entityType: "segment",
          entityId: segmentId,
          detail: { name, filter },
        },
      );
    },
  );
  await flash("segmentUpdated");
  revalidatePath(`/${locale}/segments`);
}

export async function deleteSegmentAction(locale: string, formData: FormData) {
  const handle = await ensureDb();
  const session = await currentSession();
  if (!session) redirect(`/${locale}/login`);
  requireActor(session);
  const segmentId = String(formData.get("segmentId") ?? "");
  if (!segmentId) return;
  await withOrg(
    handle,
    { orgId: session.orgId, userId: session.userId },
    async (tx) => {
      await tx
        .delete(schema.segments)
        .where(
          and(
            eq(schema.segments.id, segmentId),
            eq(schema.segments.orgId, session.orgId),
          ),
        );
      await audit(
        tx,
        { orgId: session.orgId, userId: session.userId, actorType: "user" },
        {
          action: "segment.deleted",
          entityType: "segment",
          entityId: segmentId,
          detail: {},
        },
      );
    },
  );
  await flash("segmentDeleted");
  revalidatePath(`/${locale}/segments`);
}

/* ---------- BYOK: org provider keys + model routing ---------- */

const PROVIDER_IDS = ["openai", "anthropic"] as const;
type ProviderId = (typeof PROVIDER_IDS)[number];

const MODEL_ROLES = ["reasoning", "fast", "writing", "japanese"] as const;

/** Values the routing UI may submit; "provider" or "provider:model". */
const ROUTE_VALUES = new Set([
  "mock",
  "openai",
  "openai:gpt-4.1",
  "openai:gpt-4.1-mini",
  "anthropic",
  "anthropic:claude-sonnet-4-5",
  "anthropic:claude-haiku-4-5",
  "anthropic:claude-opus-4-5",
]);

async function readProviderConfig(
  handle: Awaited<ReturnType<typeof ensureDb>>,
  orgId: string,
): Promise<OrgProviderConfig> {
  const [org] = await handle.db
    .select({ providerConfig: schema.organizations.providerConfig })
    .from(schema.organizations)
    .where(eq(schema.organizations.id, orgId))
    .limit(1);
  return org?.providerConfig ?? {};
}

async function writeProviderConfig(
  handle: Awaited<ReturnType<typeof ensureDb>>,
  orgId: string,
  cfg: OrgProviderConfig,
) {
  await handle.db
    .update(schema.organizations)
    .set({ providerConfig: cfg })
    .where(eq(schema.organizations.id, orgId));
}

export async function saveProviderKeyAction(locale: string, formData: FormData) {
  const handle = await ensureDb();
  const session = await currentSession();
  if (!session) redirect(`/${locale}/login`);
  requireAdmin(session);
  const provider = String(formData.get("provider") ?? "") as ProviderId;
  if (!PROVIDER_IDS.includes(provider)) throw new Error(`invalid provider: ${provider}`);
  const key = String(formData.get("key") ?? "").trim();
  if (!key) throw new Error("key is empty");

  const cfg = await readProviderConfig(handle, session.orgId);
  cfg.keys = { ...cfg.keys, [provider]: encryptSecret(key) };
  await writeProviderConfig(handle, session.orgId, cfg);
  await withOrg(handle, { orgId: session.orgId, userId: session.userId }, (tx) =>
    audit(tx, { orgId: session.orgId, userId: session.userId }, {
      action: "provider.key_saved",
      entityType: "organization",
      entityId: session.orgId,
      detail: { provider },
    }),
  );
  await flash("keySaved");
  revalidatePath(`/${locale}/settings`);
}

export async function removeProviderKeyAction(locale: string, formData: FormData) {
  const handle = await ensureDb();
  const session = await currentSession();
  if (!session) redirect(`/${locale}/login`);
  requireAdmin(session);
  const provider = String(formData.get("provider") ?? "") as ProviderId;
  if (!PROVIDER_IDS.includes(provider)) throw new Error(`invalid provider: ${provider}`);

  const cfg = await readProviderConfig(handle, session.orgId);
  if (cfg.keys) delete cfg.keys[provider];
  await writeProviderConfig(handle, session.orgId, cfg);
  await withOrg(handle, { orgId: session.orgId, userId: session.userId }, (tx) =>
    audit(tx, { orgId: session.orgId, userId: session.userId }, {
      action: "provider.key_removed",
      entityType: "organization",
      entityId: session.orgId,
      detail: { provider },
    }),
  );
  await flash("keyRemoved");
  revalidatePath(`/${locale}/settings`);
}

export async function saveRoutingAction(locale: string, formData: FormData) {
  const handle = await ensureDb();
  const session = await currentSession();
  if (!session) redirect(`/${locale}/login`);
  requireAdmin(session);

  const cfg = await readProviderConfig(handle, session.orgId);
  const roles: OrgProviderConfig["roles"] = {};
  for (const role of MODEL_ROLES) {
    const v = String(formData.get(`role_${role}`) ?? "");
    if (v && !ROUTE_VALUES.has(v)) throw new Error(`invalid route: ${v}`);
    // "" = inherit env/mock; only store explicit choices
    if (v) roles[role] = v;
  }
  cfg.roles = roles;
  await writeProviderConfig(handle, session.orgId, cfg);
  await withOrg(handle, { orgId: session.orgId, userId: session.userId }, (tx) =>
    audit(tx, { orgId: session.orgId, userId: session.userId }, {
      action: "provider.routing_saved",
      entityType: "organization",
      entityId: session.orgId,
      detail: { roles },
    }),
  );
  await flash("routingSaved");
  revalidatePath(`/${locale}/settings`);
}

/* ---------- Integrations (slack/action webhook + google connector) ---------- */

const INTEGRATION_FIELDS = [
  "slackWebhookUrl",
  "actionWebhookUrl",
  "googleClientId",
  "googleClientSecret",
  "googleRefreshToken",
] as const;
type IntegrationField = (typeof INTEGRATION_FIELDS)[number];

export async function saveIntegrationsAction(locale: string, formData: FormData) {
  const handle = await ensureDb();
  const session = await currentSession();
  if (!session) redirect(`/${locale}/login`);
  requireAdmin(session);

  const cfg = await readProviderConfig(handle, session.orgId);
  const set: string[] = [];
  for (const f of INTEGRATION_FIELDS) {
    const v = String(formData.get(f) ?? "").trim();
    if (!v) continue; // blank = keep existing
    if (f === "slackWebhookUrl") cfg.slackWebhookUrl = encryptSecret(v);
    else if (f === "actionWebhookUrl") cfg.actionWebhookUrl = encryptSecret(v);
    else {
      cfg.google = cfg.google ?? {};
      if (f === "googleClientId") cfg.google.clientId = encryptSecret(v);
      else if (f === "googleClientSecret") cfg.google.clientSecret = encryptSecret(v);
      else cfg.google.refreshToken = encryptSecret(v);
    }
    set.push(f);
  }
  await writeProviderConfig(handle, session.orgId, cfg);
  await withOrg(handle, { orgId: session.orgId, userId: session.userId }, (tx) =>
    audit(tx, { orgId: session.orgId, userId: session.userId }, {
      action: "integrations.saved",
      entityType: "organization",
      entityId: session.orgId,
      detail: { fields: set },
    }),
  );
  await flash("integrationsSaved");
  revalidatePath(`/${locale}/settings`);
}

export async function clearIntegrationAction(locale: string, formData: FormData) {
  const handle = await ensureDb();
  const session = await currentSession();
  if (!session) redirect(`/${locale}/login`);
  requireAdmin(session);
  const field = String(formData.get("field") ?? "") as IntegrationField | "google";
  const cfg = await readProviderConfig(handle, session.orgId);
  if (field === "google") delete cfg.google;
  else if (field === "slackWebhookUrl") delete cfg.slackWebhookUrl;
  else if (field === "actionWebhookUrl") delete cfg.actionWebhookUrl;
  else throw new Error(`invalid field: ${field}`);
  await writeProviderConfig(handle, session.orgId, cfg);
  await withOrg(handle, { orgId: session.orgId, userId: session.userId }, (tx) =>
    audit(tx, { orgId: session.orgId, userId: session.userId }, {
      action: "integrations.cleared",
      entityType: "organization",
      entityId: session.orgId,
      detail: { field },
    }),
  );
  await flash("integrationsSaved");
  revalidatePath(`/${locale}/settings`);
}

/* ---------- Org monthly AI budget ---------- */

export async function saveBudgetAction(locale: string, formData: FormData) {
  const handle = await ensureDb();
  const session = await currentSession();
  if (!session) redirect(`/${locale}/login`);
  requireAdmin(session);
  const usd = Number(String(formData.get("budgetUsd") ?? "0"));
  if (!Number.isFinite(usd) || usd < 0) throw new Error("invalid budget");
  const cents = Math.round(usd * 100);
  await handle.db
    .update(schema.organizations)
    .set({ budgetMonthlyCents: cents || null })
    .where(eq(schema.organizations.id, session.orgId));
  await withOrg(handle, { orgId: session.orgId, userId: session.userId }, (tx) =>
    audit(tx, { orgId: session.orgId, userId: session.userId }, {
      action: "budget.saved",
      entityType: "organization",
      entityId: session.orgId,
      detail: { budgetMonthlyCents: cents },
    }),
  );
  await flash("budgetSaved");
  revalidatePath(`/${locale}/settings`);
}

/* ---------- Inbound webhook key ---------- */

export async function generateIngestKeyAction(locale: string) {
  const handle = await ensureDb();
  const session = await currentSession();
  if (!session) redirect(`/${locale}/login`);
  requireAdmin(session);

  const key = newIngestKey();
  const cfg = await readProviderConfig(handle, session.orgId);
  cfg.ingestKeyHash = hashSecret(key);
  await writeProviderConfig(handle, session.orgId, cfg);
  await withOrg(handle, { orgId: session.orgId, userId: session.userId }, (tx) =>
    audit(tx, { orgId: session.orgId, userId: session.userId }, {
      action: "provider.ingest_key_generated",
      entityType: "organization",
      entityId: session.orgId,
      detail: {},
    }),
  );
  // shown once via ?k= — only the sha256 is stored
  redirect(`/${locale}/settings?k=${encodeURIComponent(key)}`);
}

export async function revokeIngestKeyAction(locale: string) {
  const handle = await ensureDb();
  const session = await currentSession();
  if (!session) redirect(`/${locale}/login`);
  requireAdmin(session);

  const cfg = await readProviderConfig(handle, session.orgId);
  delete cfg.ingestKeyHash;
  await writeProviderConfig(handle, session.orgId, cfg);
  await withOrg(handle, { orgId: session.orgId, userId: session.userId }, (tx) =>
    audit(tx, { orgId: session.orgId, userId: session.userId }, {
      action: "provider.ingest_key_revoked",
      entityType: "organization",
      entityId: session.orgId,
      detail: {},
    }),
  );
  await flash("ingestRevoked");
  revalidatePath(`/${locale}/settings`);
}

/* ---------- GDPR erasure ---------- */

export async function erasePersonAction(locale: string, formData: FormData) {
  const handle = await ensureDb();
  const session = await currentSession();
  if (!session) redirect(`/${locale}/login`);
  requireAdmin(session);
  const personId = String(formData.get("personId") ?? "");
  if (!personId) return;
  await withOrg(
    handle,
    { orgId: session.orgId, userId: session.userId, actorType: "user" },
    (tx) => erasePerson(tx, { orgId: session.orgId, userId: session.userId, actorType: "user" }, personId),
  );
  await flash("personErased");
  revalidatePath(`/${locale}/contacts`);
  revalidatePath(`/${locale}/accounts`);
}

export async function eraseAccountAction(locale: string, formData: FormData) {
  const handle = await ensureDb();
  const session = await currentSession();
  if (!session) redirect(`/${locale}/login`);
  requireAdmin(session);
  const accountId = String(formData.get("accountId") ?? "");
  if (!accountId) return;
  await withOrg(
    handle,
    { orgId: session.orgId, userId: session.userId, actorType: "user" },
    (tx) => eraseAccount(tx, { orgId: session.orgId, userId: session.userId, actorType: "user" }, accountId),
  );
  await flash("accountErased");
  revalidatePath(`/${locale}/accounts`);
  revalidatePath(`/${locale}/contacts`);
  revalidatePath(`/${locale}/deals`);
}
