import { eq } from "drizzle-orm";
import {
  schema,
  decryptSecret,
  type DbHandle,
  type OrgProviderConfig,
} from "@aigtm/db";
import { fetchWithTimeout } from "@aigtm/db";
import { ingestMessages, type RawMessage } from "./index";

export interface GoogleCreds {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

async function googleAccessToken(c: GoogleCreds): Promise<string> {
  const res = await fetchWithTimeout("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: c.clientId,
      client_secret: c.clientSecret,
      refresh_token: c.refreshToken,
      grant_type: "refresh_token",
    }),
  }, 15_000);
  if (!res.ok) {
    throw new Error(`google token refresh ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error("google token refresh: no access_token");
  return json.access_token;
}

/** Gmail → RawMessage. Needs gmail.readonly scope on the refresh token. */
export async function fetchGmailMessages(
  creds: GoogleCreds,
  opts: { days?: number; max?: number } = {},
): Promise<RawMessage[]> {
  const token = await googleAccessToken(creds);
  const days = opts.days ?? 2;
  const max = opts.max ?? 25;
  const q = encodeURIComponent(`newer_than:${days}d -in:chats`);
  const list = await fetchWithTimeout(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${q}&maxResults=${max}`,
    { headers: { Authorization: `Bearer ${token}` } },
    20_000,
  );
  if (!list.ok) throw new Error(`gmail list ${list.status}`);
  const { messages = [] } = (await list.json()) as {
    messages?: { id: string }[];
  };

  const out: RawMessage[] = [];
  for (const m of messages) {
    const r = await fetchWithTimeout(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata` +
        `&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Date`,
      { headers: { Authorization: `Bearer ${token}` } },
      20_000,
    );
    if (!r.ok) continue;
    const meta = (await r.json()) as {
      snippet?: string;
      internalDate?: string;
      payload?: { headers?: { name: string; value: string }[] };
    };
    const hdr = (n: string) =>
      meta.payload?.headers?.find((h) => h.name.toLowerCase() === n.toLowerCase())
        ?.value ?? "";
    out.push({
      externalId: `gmail:${m.id}`,
      channel: "email",
      subject: hdr("Subject") || "(no subject)",
      from: hdr("From"),
      to: hdr("To") ? [hdr("To")] : [],
      body: meta.snippet ?? "",
      occurredAt: meta.internalDate
        ? new Date(Number(meta.internalDate)).toISOString()
        : hdr("Date"),
    });
  }
  return out;
}

/** Calendar → RawMessage (channel meeting). Needs calendar.readonly. */
export async function fetchCalendarEvents(
  creds: GoogleCreds,
  opts: { days?: number; max?: number } = {},
): Promise<RawMessage[]> {
  const token = await googleAccessToken(creds);
  const days = opts.days ?? 1;
  const max = opts.max ?? 25;
  const timeMin = new Date(Date.now() - days * 86_400_000).toISOString();
  const res = await fetchWithTimeout(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events` +
      `?timeMin=${encodeURIComponent(timeMin)}&maxResults=${max}` +
      `&singleEvents=true&orderBy=startTime`,
    { headers: { Authorization: `Bearer ${token}` } },
    20_000,
  );
  if (!res.ok) throw new Error(`calendar list ${res.status}`);
  const { items = [] } = (await res.json()) as {
    items?: {
      id: string;
      summary?: string;
      description?: string;
      organizer?: { email?: string };
      attendees?: { email?: string }[];
      start?: { dateTime?: string; date?: string };
    }[];
  };
  return items.map((e) => ({
    externalId: `gcal:${e.id}`,
    channel: "meeting" as const,
    subject: e.summary ?? "(no title)",
    from: e.organizer?.email ?? "",
    to: (e.attendees ?? []).map((a) => a.email ?? "").filter(Boolean),
    body: (e.description ?? e.summary ?? "").slice(0, 2000),
    occurredAt: e.start?.dateTime ?? e.start?.date ?? new Date().toISOString(),
  }));
}

/**
 * Sync one org's Google Workspace connector into conversations. Creds are
 * ciphertext in provider_config.google; returns counts or null when the
 * org has no google config. `sinceDays` bounds the lookback.
 */
export async function syncGoogleWorkspace(
  handle: DbHandle,
  orgId: string,
  opts: { days?: number } = {},
): Promise<{ gmail: number; calendar: number } | null> {
  const [org] = (await handle.db
    .select({ providerConfig: schema.organizations.providerConfig })
    .from(schema.organizations)
    .where(eq(schema.organizations.id, orgId))
    .limit(1)) as { providerConfig: OrgProviderConfig | null }[];
  const g = org?.providerConfig?.google;
  if (!g?.clientId || !g.clientSecret || !g.refreshToken) return null;

  const creds: GoogleCreds = {
    clientId: decryptSecret(g.clientId) ?? "",
    clientSecret: decryptSecret(g.clientSecret) ?? "",
    refreshToken: decryptSecret(g.refreshToken) ?? "",
  };
  if (!creds.clientId || !creds.clientSecret || !creds.refreshToken) {
    throw new Error("google connector creds failed to decrypt");
  }

  const ctx = { orgId, actorType: "system" as const };
  const gmail = await ingestMessages(
    handle,
    ctx,
    await fetchGmailMessages(creds, { days: opts.days ?? 2 }),
  );
  const calendar = await ingestMessages(
    handle,
    ctx,
    await fetchCalendarEvents(creds, { days: opts.days ?? 1 }),
  );

  // record last-sync marker back into provider_config (plaintext timestamp)
  const cfg = org?.providerConfig ?? {};
  await handle.db
    .update(schema.organizations)
    .set({
      providerConfig: {
        ...cfg,
        connectorsLastSyncAt: new Date().toISOString(),
      },
    })
    .where(eq(schema.organizations.id, orgId));

  return { gmail: gmail.inserted, calendar: calendar.inserted };
}
