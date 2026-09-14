"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { signIn, signUp, signOut } from "@aigtm/auth";
import { executeRun, decideApproval } from "@aigtm/agent-runtime";
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

export async function runAgentAction(locale: string, formData: FormData) {
  const handle = await ensureDb();
  const session = await currentSession();
  if (!session) redirect(`/${locale}/login`);
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
