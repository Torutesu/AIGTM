import { describe, it, expect, beforeAll, afterAll, vi, afterEach } from "vitest";
import { sql } from "drizzle-orm";
import {
  createDb,
  migrate,
  seed,
  audit,
  withOrg,
  schema,
  type DbHandle,
} from "@aigtm/db";
import { drainAuditSink } from "./audit-sink";

let handle: DbHandle;
let orgId: string;

async function resetWatermark() {
  await handle.db
    .delete(schema.workerState)
    .where(sql`${schema.workerState.key} = 'audit_sink_watermark'`);
}

beforeAll(async () => {
  handle = await createDb("memory:");
  await migrate(handle);
  const seeded = await seed(handle);
  orgId = seeded.orgId;
});

afterAll(async () => handle.close());
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.AIGTM_AUDIT_WEBHOOK_URL;
});

async function insertAudit(action: string) {
  await new Promise((r) => setTimeout(r, 10));
  await withOrg(handle, { orgId }, (tx) =>
    audit(tx, { orgId }, {
      action,
      entityType: "organization",
      entityId: orgId,
    }),
  );
}

describe("drainAuditSink", () => {
  it("returns 0 and never fetches when AIGTM_AUDIT_WEBHOOK_URL is unset", async () => {
    const mock = vi.fn();
    vi.stubGlobal("fetch", mock);
    await resetWatermark();
    expect(await drainAuditSink(handle)).toBe(0);
    expect(mock).not.toHaveBeenCalled();
  });

  it("forwards new events as {events:[…]} and persists the watermark", async () => {
    const mock = vi
      .fn()
      .mockImplementation(() => Promise.resolve(new Response("ok", { status: 200 })));
    vi.stubGlobal("fetch", mock);
    process.env.AIGTM_AUDIT_WEBHOOK_URL = "https://siem.example.com/hook";
    await resetWatermark();

    // first call primes a fresh watermark to now — no history dump
    await drainAuditSink(handle);
    const primedCalls = mock.mock.calls.length;

    await insertAudit("test.sink");
    const n = await drainAuditSink(handle);
    expect(n).toBeGreaterThanOrEqual(1);
    const body = JSON.parse(
      (mock.mock.calls[primedCalls]?.[1] as RequestInit).body as string,
    ) as { events: { action: string }[] };
    expect(body.events.some((e) => e.action === "test.sink")).toBe(true);

    // watermark is durable — a "restart" (fresh drain) sees nothing new
    const callsBefore = mock.mock.calls.length;
    expect(await drainAuditSink(handle)).toBe(0);
    expect(mock.mock.calls.length).toBe(callsBefore);
  });

  it("does not advance the watermark when the sink rejects", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("bad", { status: 500 }))),
    );
    process.env.AIGTM_AUDIT_WEBHOOK_URL = "https://siem.example.com/hook";
    await resetWatermark();
    // prime watermark (no fetch — no events newer than now)
    await drainAuditSink(handle);
    await insertAudit("test.sink2");
    await expect(drainAuditSink(handle)).rejects.toThrow(/audit sink 500/);

    // watermark didn't advance — next drain retries the same event
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("ok", { status: 200 }))),
    );
    const n = await drainAuditSink(handle);
    expect(n).toBeGreaterThanOrEqual(1);
  });
});
