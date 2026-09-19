import { fetchWithTimeout, HttpTimeoutError } from "@aigtm/db";

export { fetchWithTimeout, HttpTimeoutError };

/** Status codes worth retrying — provider-side transients. */
const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

export function isRetryable(e: unknown): boolean {
  if (e instanceof HttpTimeoutError) return true;
  // undici network failures surface as TypeError("fetch failed")
  if (e instanceof TypeError) return true;
  return false;
}

/**
 * fetch + timeout + bounded retries on transient failures (429/5xx,
 * network errors, timeouts; honors Retry-After). `init` must be reusable
 * (string body — no streams).
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  opts: { timeoutMs?: number; attempts?: number; baseDelayMs?: number } = {},
): Promise<Response> {
  const { timeoutMs = 15_000, attempts = 3, baseDelayMs = 400 } = opts;
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetchWithTimeout(url, init, timeoutMs);
      if (!RETRYABLE_STATUS.has(res.status) || i === attempts - 1) return res;
      await res.text().catch(() => "");
      const ra = Number(res.headers.get("retry-after"));
      const delay =
        Number.isFinite(ra) && ra > 0
          ? Math.min(ra * 1000, 30_000)
          : baseDelayMs * 2 ** i + Math.floor(Math.random() * 100);
      await new Promise((r) => setTimeout(r, delay));
    } catch (e) {
      last = e;
      if (!isRetryable(e) || i === attempts - 1) throw e;
      await new Promise((r) =>
        setTimeout(r, baseDelayMs * 2 ** i + Math.floor(Math.random() * 100)),
      );
    }
  }
  throw last;
}
