import { eq, and, gt } from "drizzle-orm";
import {
  schema,
  verifyPassword,
  hashPassword,
  newSessionToken,
  type DbHandle,
} from "@aigtm/db";

const SESSION_TTL_MS =
  Number(process.env.AIGTM_SESSION_TTL_HOURS ?? 168) * 3600_000;

/* Sign-in throttling: in-memory per-email failure counter. 5 failures in
 * a 10-minute window locks that email for 60s. Process-local — sufficient
 * for a single-node deploy; move to a shared store when scaling out. */
const SIGNIN_WINDOW_MS = 10 * 60_000;
const SIGNIN_MAX_FAILS = 5;
const SIGNIN_LOCK_MS = 60_000;
const failures = new Map<string, { count: number; first: number; lockedUntil: number }>();

export class SignInLocked extends Error {
  constructor(public retryAfterMs: number) {
    super("too many failed sign-in attempts");
    this.name = "SignInLocked";
  }
}

// Valid-format hash used to keep verify timing uniform for unknown emails.
const DUMMY_HASH = hashPassword("timing-equalizer");

function checkThrottle(email: string) {
  const f = failures.get(email);
  if (!f) return;
  if (f.lockedUntil > Date.now()) throw new SignInLocked(f.lockedUntil - Date.now());
  if (Date.now() - f.first > SIGNIN_WINDOW_MS) failures.delete(email);
}

function recordFailure(email: string) {
  const now = Date.now();
  const f = failures.get(email);
  if (!f || now - f.first > SIGNIN_WINDOW_MS) {
    failures.set(email, { count: 1, first: now, lockedUntil: 0 });
    return;
  }
  f.count++;
  if (f.count >= SIGNIN_MAX_FAILS) f.lockedUntil = now + SIGNIN_LOCK_MS;
}

function clearFailures(email: string) {
  failures.delete(email);
}

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
  const email = input.email.toLowerCase();
  checkThrottle(email);
  const db = handle.db;
  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .limit(1);
  // verify a fixed dummy hash for unknown emails so lookup timing doesn't
  // reveal whether the account exists
  const ok = verifyPassword(input.password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok) {
    recordFailure(email);
    return null;
  }
  clearFailures(email);

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
  // sliding expiration: extend sessions past their half-life
  const remaining = row.session.expiresAt.getTime() - Date.now();
  if (remaining < SESSION_TTL_MS / 2) {
    await db
      .update(schema.sessions)
      .set({ expiresAt: new Date(Date.now() + SESSION_TTL_MS) })
      .where(eq(schema.sessions.id, row.session.id));
  }
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
