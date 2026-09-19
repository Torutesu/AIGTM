export const GWS_STATE_COOKIE = "aigtm_gws_state";

export function gwsBaseUrl() {
  return (process.env.AIGTM_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

export const GWS_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar.readonly",
].join(" ");
