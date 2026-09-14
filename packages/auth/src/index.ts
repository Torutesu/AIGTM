import { eq, and, gt } from "drizzle-orm";
import {
  schema,
  verifyPassword,
  hashPassword,
  newSessionToken,
  type DbHandle,
} from "@aigtm/db";

const SESSION_TTL_MS = 7 * 86400_000;

export interface SessionInfo {
  userId: string;
  email: string;
  name: string;
  orgId: string;
  role: string;
}

/**
 * Phase-0 minimal session auth (email+password, scrypt, httpOnly cookie).
 * Deliberately small; swap for better-auth + SSO before external sale.
 */
export async function signUp(
  handle: DbHandle,
  input: { email: string; password: string; name: string; orgName: string },
): Promise<SessionInfo> {
  const db = handle.db;
  const [org] = await db
    .insert(schema.organizations)
    .values({ name: input.orgName })
    .returning();
  const [user] = await db
    .insert(schema.users)
    .values({
      email: input.email.toLowerCase(),
      name: input.name,
      passwordHash: hashPassword(input.password),
    })
    .returning();
  await db
    .insert(schema.memberships)
    .values({ orgId: org.id, userId: user.id, role: "admin" });
  return { userId: user.id, email: user.email, name: user.name, orgId: org.id, role: "admin" };
}

export async function signIn(
  handle: DbHandle,
  input: { email: string; password: string },
): Promise<{ token: string; session: SessionInfo } | null> {
  const db = handle.db;
  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, input.email.toLowerCase()))
    .limit(1);
  if (!user || !verifyPassword(input.password, user.passwordHash)) return null;

  const [membership] = await db
    .select()
    .from(schema.memberships)
    .where(eq(schema.memberships.userId, user.id))
    .limit(1);
  if (!membership) return null;

  const token = newSessionToken();
  await db.insert(schema.sessions).values({
    userId: user.id,
    token,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  });
  return {
    token,
    session: {
      userId: user.id,
      email: user.email,
      name: user.name,
      orgId: membership.orgId,
      role: membership.role,
    },
  };
}

export async function getSession(handle: DbHandle, token: string | undefined) {
  if (!token) return null;
  const db = handle.db;
  const rows = await db
    .select({
      session: schema.sessions,
      user: schema.users,
      membership: schema.memberships,
    })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.sessions.userId, schema.users.id))
    .innerJoin(schema.memberships, eq(schema.memberships.userId, schema.users.id))
    .where(and(eq(schema.sessions.token, token), gt(schema.sessions.expiresAt, new Date())))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    userId: row.user.id,
    email: row.user.email,
    name: row.user.name,
    orgId: row.membership.orgId,
    role: row.membership.role,
  } satisfies SessionInfo;
}

export async function signOut(handle: DbHandle, token: string) {
  await handle.db.delete(schema.sessions).where(eq(schema.sessions.token, token));
}
