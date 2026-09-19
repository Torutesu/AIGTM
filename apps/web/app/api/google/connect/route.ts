import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { currentSession } from "../../../../lib/session";
import {
  GWS_STATE_COOKIE,
  GWS_SCOPES,
  gwsBaseUrl,
} from "../../../../lib/google-connect";

export const dynamic = "force-dynamic";

/**
 * GET /api/google/connect — start the Google Workspace connector OAuth
 * flow. Admin-only: the resulting refresh token is stored on the caller's
 * org. Reuses the deployment's GOOGLE_OAUTH_CLIENT_*; register
 * `$AIGTM_BASE_URL/api/google/connect/callback` as an additional redirect
 * URI in the same Google client. `access_type=offline` + `prompt=consent`
 * guarantee a refresh_token on every connect.
 */
export async function GET() {
  const session = await currentSession();
  if (!session) redirect("/en/login");
  if (session.role !== "admin") redirect("/en/settings?error=gws_forbidden");
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  if (!clientId || !process.env.GOOGLE_OAUTH_CLIENT_SECRET) {
    redirect("/en/settings?error=gws_unconfigured");
  }
  const state = crypto.randomUUID();
  const store = await cookies();
  store.set(GWS_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600,
  });
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set(
    "redirect_uri",
    `${gwsBaseUrl()}/api/google/connect/callback`,
  );
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GWS_SCOPES);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);
  redirect(url.toString());
}
