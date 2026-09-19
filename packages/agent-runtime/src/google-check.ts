import { eq } from "drizzle-orm";
import {
  createDb,
  schema,
  decryptSecret,
  type OrgProviderConfig,
} from "@aigtm/db";
import {
  fetchGmailMessages,
  fetchCalendarEvents,
} from "@aigtm/connectors";
import type { GoogleCreds } from "@aigtm/connectors";

/**
 * `pnpm --filter @aigtm/agent-runtime google-check <orgId>` — verifies the
 * org's stored Google Workspace connector against real Google endpoints:
 * refresh-token exchange → Gmail fetch → Calendar fetch. Same code path the
 * worker uses; the only difference is nothing is written.
 */
const orgId = process.argv[2];
if (!orgId) {
  console.error("usage: google-check <orgId>");
  process.exit(2);
}

const handle = await createDb();
try {
  const [org] = (await handle.db
    .select({ providerConfig: schema.organizations.providerConfig })
    .from(schema.organizations)
    .where(eq(schema.organizations.id, orgId))
    .limit(1)) as { providerConfig: OrgProviderConfig | null }[];
  const g = org?.providerConfig?.google;
  if (!g?.clientId || !g.clientSecret || !g.refreshToken) {
    console.error(
      "org has no Google connector config — connect via Settings → Integrations",
    );
    process.exit(1);
  }
  const creds: GoogleCreds = {
    clientId: decryptSecret(g.clientId) ?? "",
    clientSecret: decryptSecret(g.clientSecret) ?? "",
    refreshToken: decryptSecret(g.refreshToken) ?? "",
  };
  console.log(`connected as: ${g.email ?? "?"} (at ${g.connectedAt ?? "?"})`);
  const gmail = await fetchGmailMessages(creds, { days: 7, max: 5 });
  console.log(`gmail: ${gmail.length} messages fetched (last 7d, max 5)`);
  const cal = await fetchCalendarEvents(creds, { days: 7, max: 5 });
  console.log(`calendar: ${cal.length} events fetched (last 7d, max 5)`);
  console.log("google-check: OK");
} finally {
  await handle.close();
}
