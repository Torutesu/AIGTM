import "server-only";
import { fetchWithTimeout } from "@aigtm/db";

/**
 * Transactional mail for auth flows (verification codes). Same provider as
 * outbox dispatch — Resend — but deliberately separate: auth mail is
 * internal infrastructure, not an approval-gated agent action.
 */
export async function sendMail(input: {
  to: string;
  subject: string;
  text: string;
}): Promise<void> {
  const apiKey = process.env.AIGTM_RESEND_API_KEY;
  const from = process.env.AIGTM_EMAIL_FROM;
  if (!apiKey || !from) {
    // Verification is fail-closed: when AIGTM_EMAIL_VERIFICATION=1 the
    // caller checks mailConfigured() first and surfaces an honest error
    // instead of silently skipping the check.
    throw new Error("mail not configured: AIGTM_RESEND_API_KEY / AIGTM_EMAIL_FROM");
  }
  const res = await fetchWithTimeout(
    "https://api.resend.com/emails",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [input.to],
        subject: input.subject,
        text: input.text,
      }),
    },
    15_000,
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`resend ${res.status}: ${body.slice(0, 200)}`);
  }
}

export function mailConfigured(): boolean {
  return Boolean(process.env.AIGTM_RESEND_API_KEY && process.env.AIGTM_EMAIL_FROM);
}
