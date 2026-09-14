import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { createDb, migrate, schema, type DbHandle } from "@aigtm/db";
import { signUp, signIn, getSession, signOut, SignInLocked } from "./index";

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
