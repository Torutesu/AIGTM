import { describe, it, expect, beforeAll, afterAll, vi, afterEach } from "vitest";
import {
  createDb,
  migrate,
  seed,
  audit,
  withOrg,
  type DbHandle,
} from "@aigtm/db";
import { drainAuditSink, resetAuditSinkForTest } from "./audit-sink";

let handle: DbHandle;
let orgId: string;

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

describe("drainAuditSink", () => {
  it("returns 0 and never fetches when AIGTM_AUDIT_WEBHOOK_URL is unset", async () => {
    const mock = vi.fn();
    vi.stubGlobal("fetch", mock);
    resetAuditSinkForTest();
    expect(await drainAuditSink(handle)).toBe(0);
    expect(mock).not.toHaveBeenCalled();
  });

  it("forwards new events as {events:[…]} and advances the watermark", async () => {
    const mock = vi
      .fn()
      .mockImplementation(() => Promise.resolve(new Response("ok", { status: 200 })));
    vi.stubGlobal("fetch", mock);
    process.env.AIGTM_AUDIT_WEBHOOK_URL = "https://siem.example.com/hook";
    resetAuditSinkForTest();

    // first call just primes the watermark to now — no history dump
    await drainAuditSink(handle);
    const primedCalls = mock.mock.calls.length;
    // pglite timestamps can share a tick — ensure the insert lands
    // strictly after the watermark regardless of clock granularity
    await new Promise((r) => setTimeout(r, 10));

    await withOrg(handle, { orgId }, (tx) =>
      audit(tx, { orgId }, {
        action: "test.sink",
        entityType: "organization",
        entityId: orgId,
        detail: { probe: true },
      }),
    );

    const n = await drainAuditSink(handle);
    expect(n).toBeGreaterThanOrEqual(1);
    const body = JSON.parse(
      (mock.mock.calls[primedCalls]?.[1] as RequestInit).body as string,
    ) as { events: { action: string }[] };
    expect(body.events.some((e) => e.action === "test.sink")).toBe(true);

    // second drain: watermark advanced — nothing new to send
    const callsBefore = mock.mock.calls.length;
    expect(await drainAuditSink(handle)).toBe(0);
    expect(mock.mock.calls.length).toBe(callsBefore);
  });

  it("throws on non-2xx so the tick logs the failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("bad", { status: 500 }))),
    );
    process.env.AIGTM_AUDIT_WEBHOOK_URL = "https://siem.example.com/hook";
    resetAuditSinkForTest();
    // prime watermark first, then insert a newer event
    try {
      await drainAuditSink(handle);
    } catch {
      /* priming with no events never fetches */
    }
    await new Promise((r) => setTimeout(r, 10));
    await withOrg(handle, { orgId }, (tx) =>
      audit(tx, { orgId }, {
        action: "test.sink2",
        entityType: "organization",
        entityId: orgId,
      }),
    );
    await expect(drainAuditSink(handle)).rejects.toThrow(/audit sink 500/);
  });
});
