import { describe, it, expect, vi, afterEach } from "vitest";
import {
  fetchWithTimeout,
  fetchWithRetry,
  HttpTimeoutError,
} from "./http";

afterEach(() => vi.unstubAllGlobals());

describe("fetchWithTimeout", () => {
  it("aborts a hung fetch with HttpTimeoutError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((_u: string, init?: RequestInit) =>
        new Promise((_res, rej) => {
          init?.signal?.addEventListener("abort", () =>
            rej(new DOMException("aborted", "AbortError")),
          );
        }),
      ),
    );
    await expect(
      fetchWithTimeout("https://x.test", {}, 30),
    ).rejects.toBeInstanceOf(HttpTimeoutError);
  });

  it("passes through a fast response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("ok", { status: 200 }))),
    );
    const res = await fetchWithTimeout("https://x.test", {}, 5_000);
    expect(res.status).toBe(200);
  });
});

describe("fetchWithRetry", () => {
  it("retries 429 then succeeds", async () => {
    const mock = vi
      .fn()
      .mockImplementationOnce(() =>
        Promise.resolve(new Response("slow down", { status: 429 })),
      )
      .mockImplementationOnce(() =>
        Promise.resolve(new Response("ok", { status: 200 })),
      );
    vi.stubGlobal("fetch", mock);
    const res = await fetchWithRetry("https://x.test", {}, { baseDelayMs: 1 });
    expect(res.status).toBe(200);
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it("does not retry non-retryable statuses like 400", async () => {
    const mock = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(new Response("bad", { status: 400 })),
      );
    vi.stubGlobal("fetch", mock);
    const res = await fetchWithRetry("https://x.test", {}, { baseDelayMs: 1 });
    expect(res.status).toBe(400);
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it("retries network failures then gives up after `attempts`", async () => {
    const mock = vi
      .fn()
      .mockImplementation(() => Promise.reject(new TypeError("fetch failed")));
    vi.stubGlobal("fetch", mock);
    await expect(
      fetchWithRetry("https://x.test", {}, { attempts: 2, baseDelayMs: 1 }),
    ).rejects.toBeInstanceOf(TypeError);
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it("honors Retry-After instead of the computed backoff", async () => {
    vi.useFakeTimers();
    try {
      const mock = vi
        .fn()
        .mockImplementationOnce(() =>
          Promise.resolve(
            new Response("rl", {
              status: 429,
              headers: { "Retry-After": "1" },
            }),
          ),
        )
        .mockImplementationOnce(() =>
          Promise.resolve(new Response("ok", { status: 200 })),
        );
      vi.stubGlobal("fetch", mock);
      const p = fetchWithRetry("https://x.test", {}, { baseDelayMs: 1 });
      await vi.runAllTimersAsync();
      const res = await p;
      expect(res.status).toBe(200);
      expect(mock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
