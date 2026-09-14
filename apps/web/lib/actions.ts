"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { signIn, signUp, signOut } from "@aigtm/auth";
import {
  executeRun,
  decideApproval,
  retryableAgentId,
  cancelRun,
} from "@aigtm/agent-runtime";
import { schema, withOrg, audit } from "@aigtm/db";
import { ensureDb } from "./db";
import {
  SESSION_COOKIE,
  setSessionCookie,
  clearSessionCookie,
  currentSession,
} from "./session";

export async function signInAction(locale: string, formData: FormData) {
  const handle = await ensureDb();
  const result = await signIn(handle, {
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
  });
  if (!result) redirect(`/${locale}/login?error=invalid`);
  await setSessionCookie(result.token);
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
  if (res) await setSessionCookie(res.token);
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
  );
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
  });
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
  revalidatePath(`/${locale}/runs/${runId}`);
  revalidatePath(`/${locale}/agents`);
}

export async function createSegmentAction(locale: string, formData: FormData) {
  const handle = await ensureDb();
  const session = await currentSession();
  if (!session) redirect(`/${locale}/login`);
  requireActor(session);
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const stage = String(formData.get("stage") ?? "");
  const filter = {
    minScore: Number(formData.get("minScore")) || undefined,
    stage: ["prospect", "opportunity", "customer"].includes(stage)
      ? stage
      : undefined,
    industry: String(formData.get("industry") ?? "").trim() || undefined,
  };
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
  revalidatePath(`/${locale}/segments`);
}
