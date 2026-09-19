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

/* Sign-in throttling: DB-backed per-email failure counter (`login_attempts`
 * table). 5 failures in a 10-minute window locks that email for 60s. Shared
 * state so it holds across replicas — the counter survives restarts and
 * concurrent app instances see the same lock. */
const SIGNIN_WINDOW_MS = 10 * 60_000;
const SIGNIN_MAX_FAILS = 5;
const SIGNIN_LOCK_MS = 60_000;

export class SignInLocked extends Error {
  constructor(public retryAfterMs: number) {
    super("too many failed sign-in attempts");
    this.name = "SignInLocked";
  }
}

// Valid-format hash used to keep verify timing uniform for unknown emails.
const DUMMY_HASH = hashPassword("timing-equalizer");

type Db = DbHandle["db"];

async function checkThrottle(db: Db, email: string) {
  const [row] = await db
    .select()
    .from(schema.loginAttempts)
    .where(eq(schema.loginAttempts.email, email))
    .limit(1);
  if (row?.lockedUntil && row.lockedUntil.getTime() > Date.now()) {
    throw new SignInLocked(row.lockedUntil.getTime() - Date.now());
  }
}

async function recordFailure(db: Db, email: string) {
  const now = new Date();
  const [row] = await db
    .select()
    .from(schema.loginAttempts)
    .where(eq(schema.loginAttempts.email, email))
    .limit(1);
  const windowExpired =
    !row || now.getTime() - row.windowStartedAt.getTime() > SIGNIN_WINDOW_MS;
  const count = windowExpired ? 1 : row.failCount + 1;
  await db
    .insert(schema.loginAttempts)
    .values({
      email,
      failCount: count,
      windowStartedAt: windowExpired || !row ? now : row.windowStartedAt,
      lockedUntil: count >= SIGNIN_MAX_FAILS ? new Date(now.getTime() + SIGNIN_LOCK_MS) : null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: schema.loginAttempts.email,
      set: {
        failCount: count,
        windowStartedAt: windowExpired || !row ? now : row.windowStartedAt,
        lockedUntil: count >= SIGNIN_MAX_FAILS ? new Date(now.getTime() + SIGNIN_LOCK_MS) : null,
        updatedAt: now,
      },
    });
}

async function clearFailures(db: Db, email: string) {
  await db
    .delete(schema.loginAttempts)
    .where(eq(schema.loginAttempts.email, email));
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
  const db = handle.db;
  await checkThrottle(db, email);
  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .limit(1);
  // verify a fixed dummy hash for unknown emails so lookup timing doesn't
  // reveal whether the account exists
  const ok = verifyPassword(input.password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok) {
    await recordFailure(db, email);
    return null;
  }
  await clearFailures(db, email);

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

/**
 * Sign in (or provision) a user verified by an external IdP (OAuth).
 * - existing user + membership → session
 * - unknown email → create user + membership: joins the deployment's single
 *   org as "member" when exactly one exists; creates a new org when none
 *   exist; throws sso_no_org when several orgs exist (can't pick safely)
 * The user's passwordHash is an IdP sentinel, not a usable password.
 */
export async function ssoSignIn(
  handle: DbHandle,
  input: { email: string; name: string; provider: string },
): Promise<{ token: string; session: SessionInfo }> {
  const db = handle.db;
  const email = input.email.toLowerCase();
  let [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .limit(1);

  if (!user) {
    const orgs = await db.select({ id: schema.organizations.id }).from(schema.organizations);
    if (orgs.length > 1) throw new Error("sso_no_org");
    let role = "member";
    const orgId =
      orgs[0]?.id ??
      (
        await db
          .insert(schema.organizations)
          .values({ name: `${input.name}'s workspace` })
          .returning()
      )[0].id;
    if (!orgs[0]) role = "admin";
    [user] = await db
      .insert(schema.users)
      .values({
        email,
        name: input.name || email.split("@")[0],
        passwordHash: `sso:${input.provider}`,
      })
      .returning();
    await db
      .insert(schema.memberships)
      .values({ orgId, userId: user.id, role });
  }

  const [membership] = await db
    .select()
    .from(schema.memberships)
    .where(eq(schema.memberships.userId, user.id))
    .limit(1);
  if (!membership) throw new Error("sso_no_membership");

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
