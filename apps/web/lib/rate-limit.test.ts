import { describe, it, expect } from "vitest";
import { createRateLimiter } from "./rate-limit";

describe("createRateLimiter", () => {
  it("allows up to the limit then rejects within the window", () => {
    const l = createRateLimiter({ limit: 3, windowMs: 60_000 });
    const t = 1_000_000;
    expect(l.limited("k", t)).toBe(false);
    expect(l.limited("k", t)).toBe(false);
    expect(l.limited("k", t)).toBe(false);
    expect(l.limited("k", t)).toBe(true);
    expect(l.limited("k", t + 30_000)).toBe(true);
  });

  it("resets after the window and isolates keys", () => {
    const l = createRateLimiter({ limit: 1, windowMs: 60_000 });
    const t = 1_000_000;
    expect(l.limited("a", t)).toBe(false);
    expect(l.limited("a", t)).toBe(true);
    expect(l.limited("b", t)).toBe(false); // different key unaffected
    expect(l.limited("a", t + 61_000)).toBe(false); // window elapsed
  });
});
