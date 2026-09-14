import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createDb, migrate, type DbHandle } from "@aigtm/db";
import { signUp, signIn, getSession, signOut } from "./index";

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
});
