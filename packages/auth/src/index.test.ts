import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { createDb, migrate, schema, type DbHandle } from "@aigtm/db";
import {
  signUp,
  signIn,
  getSession,
  signOut,
  SignInLocked,
  ssoSignIn,
  switchOrg,
  issueVerificationCode,
  verifyEmailCode,
} from "./index";

let handle: DbHandle;

beforeAll(async () => {
  handle = await createDb("memory:");
  await migrate(handle);
});

afterAll(async () => {
  await handle.close();
});

describe("auth", () => {
  it("signUp creates org+user+membership and signIn issues a session", async () => {
    await signUp(handle, {
      email: "A@B.COM",
      password: "pw-123456",
      name: "A B",
      orgName: "Acme",
    });
    const res = await signIn(handle, { email: "a@b.com", password: "pw-123456" });
    expect(res).not.toBeNull();
    expect(res!.session.role).toBe("admin");

    const session = await getSession(handle, res!.token);
    expect(session?.email).toBe("a@b.com");

    await signOut(handle, res!.token);
    expect(await getSession(handle, res!.token)).toBeNull();
  });

  it("rejects wrong password", async () => {
    expect(
      await signIn(handle, { email: "a@b.com", password: "wrong" }),
    ).toBeNull();
  });

  it("throttles repeated failures and locks the email", async () => {
    const email = "brute@b.com";
    await signUp(handle, {
      email,
      password: "pw-123456",
      name: "B",
      orgName: "Brute Org",
    });
    for (let i = 0; i < 5; i++) {
      expect(await signIn(handle, { email, password: "bad" })).toBeNull();
    }
    // even the correct password is refused while locked
    await expect(
      signIn(handle, { email, password: "pw-123456" }),
    ).rejects.toThrow(SignInLocked);

    // lock state lives in the DB, so it survives process restarts
    const [row] = await handle.db
      .select()
      .from(schema.loginAttempts)
      .where(eq(schema.loginAttempts.email, email));
    expect(row.failCount).toBeGreaterThanOrEqual(5);
    expect(row.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
  });

  it("returns null for expired sessions", async () => {
    const res = await signIn(handle, { email: "a@b.com", password: "pw-123456" });
    expect(res).not.toBeNull();
    await handle.db
      .update(schema.sessions)
      .set({ expiresAt: new Date(0) })
      .where(eq(schema.sessions.token, res!.token));
    expect(await getSession(handle, res!.token)).toBeNull();
  });
});

describe("ssoSignIn", () => {
  it("signs in an existing user by email", async () => {
    const res = await ssoSignIn(handle, {
      email: "a@b.com",
      name: "A B",
      provider: "google",
    });
    expect(res.token).toBeTruthy();
    expect(res.session.email).toBe("a@b.com");
    const session = await getSession(handle, res.token);
    expect(session?.userId).toBe(res.session.userId);
  });

  it("refuses to provision a new user when multiple orgs exist", async () => {
    // test db has ≥2 orgs from signUp/other tests — can't pick safely
    await expect(
      ssoSignIn(handle, {
        email: "new-sso@example.com",
        name: "New",
        provider: "google",
      }),
    ).rejects.toThrowError("sso_no_org");
  });
});

describe("multi-org sessions", () => {
  it("switchOrg re-pins the session to a member org and refuses others", async () => {
    // user in two orgs
    const res = await signIn(handle, { email: "a@b.com", password: "pw-123456" });
    const firstOrg = res!.session.orgId;
    const [otherOrg] = await handle.db
      .insert(schema.organizations)
      .values({ name: "Second Org" })
      .returning();
    await handle.db.insert(schema.memberships).values({
      orgId: otherOrg.id,
      userId: res!.session.userId,
      role: "member",
    });

    const next = await switchOrg(handle, {
      userId: res!.session.userId,
      token: res!.token,
      orgId: otherOrg.id,
    });
    expect(next?.orgId).toBe(otherOrg.id);
    expect(next?.role).toBe("member");
    // the same token now resolves to the new org — not the arbitrary first
    const session = await getSession(handle, res!.token);
    expect(session?.orgId).toBe(otherOrg.id);

    // non-member org is refused
    const [stranger] = await handle.db
      .insert(schema.organizations)
      .values({ name: "Stranger Org" })
      .returning();
    expect(
      await switchOrg(handle, {
        userId: res!.session.userId,
        token: res!.token,
        orgId: stranger.id,
      }),
    ).toBeNull();
    expect((await getSession(handle, res!.token))?.orgId).toBe(otherOrg.id);

    // and switching back works
    await switchOrg(handle, {
      userId: res!.session.userId,
      token: res!.token,
      orgId: firstOrg,
    });
    expect((await getSession(handle, res!.token))?.orgId).toBe(firstOrg);
  });
});

describe("email verification OTP", () => {
  it("issues a code, enforces expiry/attempts, verifies and clears", async () => {
    const email = "otp@b.com";
    await signUp(handle, {
      email,
      password: "pw-123456",
      name: "Otp",
      orgName: "Otp Org",
    });
    // simulate a deployment requiring verification: strip the stamp
    await handle.db
      .update(schema.users)
      .set({ emailVerifiedAt: null })
      .where(eq(schema.users.email, email));

    const issued = await issueVerificationCode(handle, email);
    expect(issued?.code).toMatch(/^\d{6}$/);

    // wrong code burns an attempt
    expect(await verifyEmailCode(handle, { email, code: "000000" })).toBe(
      "invalid",
    );
    // correct code verifies
    expect(await verifyEmailCode(handle, { email, code: issued!.code })).toBe(
      "ok",
    );
    // verified users are idempotent and get no new codes
    expect(await verifyEmailCode(handle, { email, code: "123456" })).toBe(
      "already",
    );
    expect(await issueVerificationCode(handle, email)).toBeNull();
  });

  it("locks after 5 wrong attempts", async () => {
    const email = "otp-lock@b.com";
    await signUp(handle, {
      email,
      password: "pw-123456",
      name: "Lock",
      orgName: "Lock Org",
    });
    await handle.db
      .update(schema.users)
      .set({ emailVerifiedAt: null })
      .where(eq(schema.users.email, email));
    await issueVerificationCode(handle, email);
    for (let i = 0; i < 5; i++) {
      expect(await verifyEmailCode(handle, { email, code: "999999" })).toBe(
        "invalid",
      );
    }
    expect(await verifyEmailCode(handle, { email, code: "999999" })).toBe(
      "locked",
    );
  });
});
