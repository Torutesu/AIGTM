import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import {
  schema,
  encryptSecret,
  withOrg,
  audit,
  type OrgProviderConfig,
} from "@aigtm/db";
import { ensureDb } from "../../../../../lib/db";
import { currentSession } from "../../../../../lib/session";
import { GWS_STATE_COOKIE, gwsBaseUrl } from "../../../../../lib/google-connect";
import { fetchWithTimeout } from "@aigtm/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/google/connect/callback?code&state — verify state, exchange the
 * code, require a refresh_token (offline+consent guarantees one), store the
 * connector credentials on the caller's org, and record the connected
 * Google account for display.
 */
export async function GET(req: Request) {
  const session = await currentSession();
  if (!session) redirect("/en/login");
  if (session.role !== "admin") redirect("/en/settings?error=gws_forbidden");

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const store = await cookies();
  const expected = store.get(GWS_STATE_COOKIE)?.value;
  store.delete(GWS_STATE_COOKIE);
  if (!code || !state || !expected || state !== expected) {
    redirect("/en/settings?error=gws_state");
  }

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID!;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET!;

  const tokenRes = await fetchWithTimeout("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: `${gwsBaseUrl()}/api/google/connect/callback`,
      grant_type: "authorization_code",
    }),
  }, 15_000);
  if (!tokenRes.ok) redirect("/en/settings?error=gws_exchange");
  const tokens = (await tokenRes.json()) as {
    access_token?: string;
    refresh_token?: string;
  };
  if (!tokens.access_token || !tokens.refresh_token) {
    redirect("/en/settings?error=gws_no_refresh");
  }

  const infoRes = await fetch(
    "https://openidconnect.googleapis.com/v1/userinfo",
    { headers: { Authorization: `Bearer ${tokens.access_token}` } },
  );
  const info = infoRes.ok
    ? ((await infoRes.json()) as { email?: string })
    : {};

  const handle = await ensureDb();
  await withOrg(
    handle,
    { orgId: session.orgId, userId: session.userId },
    async (tx) => {
      const [org] = await tx
        .select({ providerConfig: schema.organizations.providerConfig })
        .from(schema.organizations)
        .where(eq(schema.organizations.id, session.orgId))
        .limit(1);
      const cfg: OrgProviderConfig = {
        ...((org?.providerConfig as OrgProviderConfig | null) ?? {}),
        google: {
          clientId: encryptSecret(clientId),
          clientSecret: encryptSecret(clientSecret),
          refreshToken: encryptSecret(tokens.refresh_token!),
          email: info.email,
          connectedAt: new Date().toISOString(),
        },
      };
      await tx
        .update(schema.organizations)
        .set({ providerConfig: cfg })
        .where(eq(schema.organizations.id, session.orgId));
      await audit(
        tx,
        { orgId: session.orgId, userId: session.userId },
        {
          action: "google.connected",
          entityType: "organization",
          entityId: session.orgId,
          detail: { email: info.email ?? null },
        },
      );
    },
  );
  redirect("/en/settings?gws=connected");
}
