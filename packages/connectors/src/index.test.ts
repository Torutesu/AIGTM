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

describe("ingestSignalEvent (webhook path)", () => {
  it("resolves account by domain and signal by name", async () => {
    const { ingestSignalEvent } = await import("./index");
    const row = await ingestSignalEvent(
      handle,
      { orgId, userId },
      {
        signalName: "Executive hire",
        accountDomain: "nordic-systems.example",
        score: 91,
        evidence: { source: "test" },
      },
    );
    expect(row.id).toBeTruthy();
    const [ev] = (await withOrg(handle, { orgId }, (tx) =>
      tx
        .select()
        .from(schema.signalEvents)
        .where(eq(schema.signalEvents.id, row.id)),
    )) as { accountId: string | null; signalId: string | null; score: string | null }[];
    expect(ev.accountId).not.toBeNull(); // resolved nordic-systems.example
    expect(ev.signalId).not.toBeNull();  // resolved "Executive hire"
    expect(Number(ev.score)).toBe(91);
  });

  it("leaves refs null when they don't resolve", async () => {
    const { ingestSignalEvent } = await import("./index");
    const row = await ingestSignalEvent(
      handle,
      { orgId, userId },
      { signalName: "nope", accountDomain: "nobody.example", evidence: {} },
    );
    const [ev] = (await withOrg(handle, { orgId }, (tx) =>
      tx
        .select()
        .from(schema.signalEvents)
        .where(eq(schema.signalEvents.id, row.id)),
    )) as { accountId: string | null; signalId: string | null }[];
    expect(ev.accountId).toBeNull();
    expect(ev.signalId).toBeNull();
  });
});
