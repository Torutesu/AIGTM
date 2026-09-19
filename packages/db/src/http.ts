/**
 * Shared outbound-HTTP policy. Every external call goes through
 * fetchWithTimeout so a hung provider can never block a worker tick or a
 * request handler forever.
 */

export class HttpTimeoutError extends Error {
  constructor(
    public readonly url: string,
    public readonly timeoutMs: number,
  ) {
    super(`fetch timeout after ${timeoutMs}ms: ${url}`);
    this.name = "HttpTimeoutError";
  }
}

export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = 15_000,
): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  if (init.signal) {
    if (init.signal.aborted) ctrl.abort();
    else init.signal.addEventListener("abort", () => ctrl.abort(), { once: true });
  }
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch (e) {
    if (ctrl.signal.aborted && !init.signal?.aborted) {
      throw new HttpTimeoutError(url, timeoutMs);
    }
    throw e;
  } finally {
    clearTimeout(t);
  }
}
