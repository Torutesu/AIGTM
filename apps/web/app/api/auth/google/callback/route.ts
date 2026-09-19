import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ssoSignIn } from "@aigtm/auth";
import { ensureDb } from "../../../../../lib/db";
import { setSessionCookie } from "../../../../../lib/session";
import { flash } from "../../../../../lib/toast";

export const dynamic = "force-dynamic";

const STATE_COOKIE = "aigtm_oauth_state";

function baseUrl() {
  return (process.env.AIGTM_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

/**
 * GET /api/auth/google/callback?code&state — verify state, exchange the
 * code, fetch userinfo, then sign in (or provision) the user.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const store = await cookies();
  const expected = store.get(STATE_COOKIE)?.value;
  store.delete(STATE_COOKIE);
  if (!code || !state || !expected || state !== expected) {
    redirect("/en/login?error=sso_state");
  }

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID!;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET!;

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: `${baseUrl()}/api/auth/google/callback`,
      grant_type: "authorization_code",
    }),
  });
  if (!tokenRes.ok) redirect("/en/login?error=sso_exchange");
  const { access_token } = (await tokenRes.json()) as {
    access_token?: string;
  };
  if (!access_token) redirect("/en/login?error=sso_exchange");

  const infoRes = await fetch(
    "https://openidconnect.googleapis.com/v1/userinfo",
    { headers: { Authorization: `Bearer ${access_token}` } },
  );
  if (!infoRes.ok) redirect("/en/login?error=sso_userinfo");
  const info = (await infoRes.json()) as { email?: string; name?: string };
  if (!info.email) redirect("/en/login?error=sso_userinfo");

  const handle = await ensureDb();
  let result;
  try {
    result = await ssoSignIn(handle, {
      email: info.email,
      name: info.name ?? "",
      provider: "google",
    });
  } catch {
    redirect("/en/login?error=sso_no_org");
  }
  await setSessionCookie(result.token);
  await flash("signedIn");
  redirect("/en/inbox");
}
