import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import {
  createDb,
  migrate,
  withOrg,
  schema,
  seed,
  encryptSecret,
  type DbHandle,
} from "@aigtm/db";
import {
  fetchGmailMessages,
  fetchCalendarEvents,
  syncGoogleWorkspace,
} from "./google";

const CREDS = {
  clientId: "cid",
  clientSecret: "csec",
  refreshToken: "rtok",
};

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Route a fetch call by URL and record it. */
function mockGoogle(routes: {
  token?: unknown;
  gmailList?: unknown;
  gmailMeta?: Record<string, unknown>;
  calendar?: unknown;
}) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal("fetch", async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, init });
    if (u.includes("oauth2.googleapis.com/token")) return jsonRes(routes.token);
    if (u.includes("/gmail/v1/users/me/messages/")) {
      const id = u.split("/messages/")[1].split("?")[0];
      return jsonRes(routes.gmailMeta?.[id] ?? {});
    }
    if (u.includes("/gmail/v1/users/me/messages")) return jsonRes(routes.gmailList);
    if (u.includes("/calendar/v3/")) return jsonRes(routes.calendar);
    return jsonRes({ error: "unrouted" }, 404);
  });
  return calls;
}

describe("google connector API shape", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("refreshes the token with the documented form params", async () => {
    const calls = mockGoogle({ token: { access_token: "ya29.tok" }, gmailList: { messages: [] } });
    await fetchGmailMessages(CREDS);
    const tokenCall = calls.find((c) => c.url.includes("oauth2.googleapis.com/token"));
    const params = new URLSearchParams(tokenCall!.init?.body as string);
    expect(params.get("grant_type")).toBe("refresh_token");
    expect(params.get("client_id")).toBe("cid");
    expect(params.get("client_secret")).toBe("csec");
    expect(params.get("refresh_token")).toBe("rtok");
  });

  it("maps gmail metadata headers into RawMessage", async () => {
    const calls = mockGoogle({
      token: { access_token: "ya29.tok" },
      gmailList: { messages: [{ id: "m1" }] },
      gmailMeta: {
        m1: {
          snippet: "hello there",
          internalDate: "1700000000000",
          payload: {
            headers: [
              { name: "Subject", value: "Pricing question" },
              { name: "From", value: "rin@acme-robotics.example" },
              { name: "To", value: "sales@internal.example" },
            ],
          },
        },
      },
    });
    const msgs = await fetchGmailMessages(CREDS);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({
      externalId: "gmail:m1",
      channel: "email",
      subject: "Pricing question",
      from: "rin@acme-robotics.example",
      to: ["sales@internal.example"],
      body: "hello there",
      occurredAt: new Date(1700000000000).toISOString(),
    });
    // bearer token was used on gmail calls
    const gmailCalls = calls.filter((c) => c.url.includes("gmail.googleapis.com"));
    for (const c of gmailCalls) {
      expect((c.init?.headers as Record<string, string>).Authorization).toBe(
        "Bearer ya29.tok",
      );
    }
  });

  it("maps calendar items into meeting-channel RawMessages", async () => {
    mockGoogle({
      token: { access_token: "ya29.tok" },
      calendar: {
        items: [
          {
            id: "ev1",
            summary: "Discovery call",
            description: "agenda",
            organizer: { email: "me@internal.example" },
            attendees: [{ email: "a@x.example" }, { email: "" }],
            start: { dateTime: "2025-11-14T10:00:00Z" },
          },
        ],
      },
    });
    const msgs = await fetchCalendarEvents(CREDS);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({
      externalId: "gcal:ev1",
      channel: "meeting",
      subject: "Discovery call",
      to: ["a@x.example"],
      occurredAt: "2025-11-14T10:00:00Z",
    });
  });
});

describe("syncGoogleWorkspace", () => {
  let handle: DbHandle;
  let orgId: string;

  beforeAll(async () => {
    handle = await createDb("memory:");
    await migrate(handle);
    ({ orgId } = await seed(handle));
  });
  afterAll(async () => handle.close());
  afterEach(() => vi.unstubAllGlobals());

  it("returns null when the org has no google config", async () => {
    expect(await syncGoogleWorkspace(handle, orgId)).toBeNull();
  });

  it("ingests gmail+calendar into conversations and stamps last-sync", async () => {
    const cfg = {
      google: {
        clientId: encryptSecret("cid"),
        clientSecret: encryptSecret("csec"),
        refreshToken: encryptSecret("rtok"),
      },
    };
    await handle.db
      .update(schema.organizations)
      .set({ providerConfig: cfg })
      .where(eq(schema.organizations.id, orgId));

    mockGoogle({
      token: { access_token: "ya29.tok" },
      gmailList: { messages: [{ id: "sync-m1" }] },
      gmailMeta: {
        "sync-m1": {
          snippet: "synced body",
          internalDate: "1700000000000",
          payload: {
            headers: [
              { name: "From", value: "new.person@acme-robotics.example" },
              { name: "Subject", value: "Synced" },
            ],
          },
        },
      },
      calendar: {
        items: [
          {
            id: "sync-ev1",
            summary: "QBR",
            organizer: { email: "me@internal.example" },
            attendees: [],
            start: { dateTime: "2025-11-14T10:00:00Z" },
          },
        ],
      },
    });

    const res = await syncGoogleWorkspace(handle, orgId);
    expect(res).toEqual({ gmail: 1, calendar: 1 });

    const convos = (await withOrg(handle, { orgId }, (tx) =>
      tx.select().from(schema.conversations),
    )) as { externalId: string | null }[];
    const ext = new Set(convos.map((c) => c.externalId));
    expect(ext.has("gmail:sync-m1")).toBe(true);
    expect(ext.has("gcal:sync-ev1")).toBe(true);

    const [org] = await handle.db
      .select({ cfg: schema.organizations.providerConfig })
      .from(schema.organizations)
      .where(eq(schema.organizations.id, orgId));
    expect((org!.cfg as { connectorsLastSyncAt?: string }).connectorsLastSyncAt).toBeTruthy();

    // idempotent re-sync: same externalIds → no duplicates
    const res2 = await syncGoogleWorkspace(handle, orgId);
    expect(res2).toEqual({ gmail: 0, calendar: 0 });
  });
});
