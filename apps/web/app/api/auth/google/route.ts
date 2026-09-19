import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

const STATE_COOKIE = "aigtm_oauth_state";

function baseUrl() {
  return (process.env.AIGTM_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

/**
 * GET /api/auth/google — start the OAuth flow. Requires deployment-level
 * GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET. Not configured →
 * back to login with an error rather than a broken redirect.
 */
export async function GET() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  if (!clientId || !process.env.GOOGLE_OAUTH_CLIENT_SECRET) {
    redirect("/en/login?error=sso_unconfigured");
  }
  const state = crypto.randomUUID();
  const store = await cookies();
  store.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600,
  });
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", `${baseUrl()}/api/auth/google/callback`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  redirect(url.toString());
}
