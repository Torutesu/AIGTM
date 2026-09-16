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
  defaultRouter,
} from "@aigtm/agent-runtime";
import { schema, withOrg, audit } from "@aigtm/db";
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
    defaultRouter(),
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
  }, defaultRouter());
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
