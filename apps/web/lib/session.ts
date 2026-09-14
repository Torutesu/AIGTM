import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSession, type SessionInfo } from "@aigtm/auth";
import { ensureDb } from "./db";

export const SESSION_COOKIE = "aigtm_session";

export async function currentSession(): Promise<SessionInfo | null> {
  const handle = await ensureDb();
  const store = await cookies();
  return getSession(handle, store.get(SESSION_COOKIE)?.value);
}

export async function requireSession(locale: string): Promise<SessionInfo> {
  const session = await currentSession();
  if (!session) redirect(`/${locale}/login`);
  return session;
}

export async function setSessionCookie(token: string) {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Number(process.env.AIGTM_SESSION_TTL_HOURS ?? 168) * 3600,
  });
}

export async function clearSessionCookie() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}
