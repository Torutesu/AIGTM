import { eq, and, gt } from "drizzle-orm";
import {
  schema,
  verifyPassword,
  hashPassword,
  hashSecret,
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
  emailVerified: boolean;
}

/** Email verification is opt-in per deployment: required for external sale,
 * off for internal/dev so nothing breaks without a mail provider. */
export function emailVerificationRequired(): boolean {
  return process.env.AIGTM_EMAIL_VERIFICATION === "1";
}

function sessionInfo(
  user: { id: string; email: string; name: string; emailVerifiedAt: Date | null },
  membership: { orgId: string; role: string },
): SessionInfo {
  return {
    userId: user.id,
    email: user.email,
    name: user.name,
    orgId: membership.orgId,
    role: membership.role,
    emailVerified: user.emailVerifiedAt != null,
  };
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
      emailVerifiedAt: emailVerificationRequired() ? null : new Date(),
    })
    .returning();
  await db
    .insert(schema.memberships)
    .values({ orgId: org.id, userId: user.id, role: "admin" });
  return sessionInfo(user, { orgId: org.id, role: "admin" });
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
    orgId: membership.orgId,
    token,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  });
  return { token, session: sessionInfo(user, membership) };
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
        emailVerifiedAt: new Date(), // the IdP already proved the mailbox
      })
      .returning();
    await db
      .insert(schema.memberships)
      .values({ orgId, userId: user.id, role });
  } else if (!user.emailVerifiedAt) {
    [user] = await db
      .update(schema.users)
      .set({ emailVerifiedAt: new Date() })
      .where(eq(schema.users.id, user.id))
      .returning();
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
    orgId: membership.orgId,
    token,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  });
  return { token, session: sessionInfo(user, membership) };
}

export async function getSession(handle: DbHandle, token: string | undefined) {
  if (!token) return null;
  const db = handle.db;
  const rows = await db
    .select({
      session: schema.sessions,
      user: schema.users,
    })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.sessions.userId, schema.users.id))
    .where(and(eq(schema.sessions.token, token), gt(schema.sessions.expiresAt, new Date())))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  // The session acts as its pinned org; sessions predating org pinning
  // (orgId null) fall back to the first membership. A membership that no
  // longer exists degrades to the first remaining one — never a cross-tenant hop.
  const memberships = (await db
    .select()
    .from(schema.memberships)
    .where(eq(schema.memberships.userId, row.user.id))) as {
    orgId: string;
    role: string;
  }[];
  const membership =
    memberships.find((m) => m.orgId === row.session.orgId) ?? memberships[0];
  if (!membership) return null;
  // sliding expiration: extend sessions past their half-life
  const remaining = row.session.expiresAt.getTime() - Date.now();
  if (remaining < SESSION_TTL_MS / 2) {
    await db
      .update(schema.sessions)
      .set({ expiresAt: new Date(Date.now() + SESSION_TTL_MS) })
      .where(eq(schema.sessions.id, row.session.id));
  }
  return sessionInfo(row.user, membership);
}

/**
 * Switch the session's active org. The target must be an org the user
 * belongs to — org choice is server-side session state, never client input
 * trusted on its own.
 */
export async function switchOrg(
  handle: DbHandle,
  input: { userId: string; token: string; orgId: string },
): Promise<SessionInfo | null> {
  const db = handle.db;
  const [membership] = await db
    .select()
    .from(schema.memberships)
    .where(
      and(
        eq(schema.memberships.userId, input.userId),
        eq(schema.memberships.orgId, input.orgId),
      ),
    )
    .limit(1);
  if (!membership) return null;
  await db
    .update(schema.sessions)
    .set({ orgId: input.orgId })
    .where(
      and(
        eq(schema.sessions.token, input.token),
        eq(schema.sessions.userId, input.userId),
      ),
    );
  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, input.userId))
    .limit(1);
  return user ? sessionInfo(user, membership) : null;
}

/* ------------------------- email verification ------------------------- */

const VERIFY_TTL_MS = 15 * 60_000;
const VERIFY_MAX_ATTEMPTS = 5;

/**
 * Issue a fresh 6-digit OTP for an unverified user. Returns the plaintext
 * code (the caller emails it) or null when the user doesn't exist / is
 * already verified. Stored state is sha256-only, 15-minute TTL.
 */
export async function issueVerificationCode(
  handle: DbHandle,
  email: string,
): Promise<{ code: string; name: string } | null> {
  const db = handle.db;
  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, email.toLowerCase()))
    .limit(1);
  if (!user || user.emailVerifiedAt) return null;
  const code = String(Math.floor(100000 + Math.random() * 900000));
  await db
    .update(schema.users)
    .set({
      verifyCodeHash: hashSecret(code),
      verifyCodeExpiresAt: new Date(Date.now() + VERIFY_TTL_MS),
      verifyAttempts: 0,
    })
    .where(eq(schema.users.id, user.id));
  return { code, name: user.name };
}

/** Attempts-counter for OTP guesses; locks at VERIFY_MAX_ATTEMPTS. */
export async function verifyEmailCode(
  handle: DbHandle,
  input: { email: string; code: string },
): Promise<"ok" | "already" | "expired" | "invalid" | "locked"> {
  const db = handle.db;
  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, input.email.toLowerCase()))
    .limit(1);
  if (!user) return "invalid";
  if (user.emailVerifiedAt) return "already";
  if (!user.verifyCodeHash || !user.verifyCodeExpiresAt) return "invalid";
  if (user.verifyAttempts >= VERIFY_MAX_ATTEMPTS) return "locked";
  if (user.verifyCodeExpiresAt.getTime() < Date.now()) return "expired";
  if (hashSecret(input.code.trim()) !== user.verifyCodeHash) {
    await db
      .update(schema.users)
      .set({ verifyAttempts: user.verifyAttempts + 1 })
      .where(eq(schema.users.id, user.id));
    return "invalid";
  }
  await db
    .update(schema.users)
    .set({
      emailVerifiedAt: new Date(),
      verifyCodeHash: null,
      verifyCodeExpiresAt: null,
      verifyAttempts: 0,
    })
    .where(eq(schema.users.id, user.id));
  return "ok";
}

export async function signOut(handle: DbHandle, token: string) {
  await handle.db.delete(schema.sessions).where(eq(schema.sessions.token, token));
}
