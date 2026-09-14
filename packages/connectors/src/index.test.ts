import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import {
  createDb,
  migrate,
  withOrg,
  schema,
  seed,
  type DbHandle,
} from "@aigtm/db";
import { syncConversations, MockGmailConnector } from "./index";

let handle: DbHandle;
let orgId: string;
let userId: string;

beforeAll(async () => {
  handle = await createDb("memory:");
  await migrate(handle);
  ({ orgId, userId } = await seed(handle));
});

afterAll(async () => {
  await handle.close();
});

describe("mock connector sync", () => {
  it("ingests fixture messages and resolves accounts by domain", async () => {
    const res = await syncConversations(
      handle,
      { orgId, userId },
      new MockGmailConnector(),
    );
    expect(res.fetched).toBe(2);
    // one may already exist from seed (dedupe) — either way no dupes
    const convos: { accountId: string | null }[] = await withOrg(handle, { orgId }, (tx) =>
      tx.select().from(schema.conversations).where(eq(schema.conversations.orgId, orgId)),
    );
    expect(convos.length).toBeGreaterThanOrEqual(2);
    const linked = convos.filter((c) => c.accountId !== null);
    expect(linked.length).toBeGreaterThanOrEqual(2); // both resolved by domain
  });

  it("is idempotent (no duplicate conversations)", async () => {
    const res = await syncConversations(handle, { orgId, userId });
    expect(res.inserted).toBe(0);
  });
});
