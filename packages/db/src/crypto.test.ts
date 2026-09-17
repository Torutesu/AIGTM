import { describe, it, expect } from "vitest";
import { encryptSecret, decryptSecret, maskSecret } from "./crypto";

describe("crypto", () => {
  it("round-trips secrets", () => {
    const enc = encryptSecret("sk-test-abcdef1234");
    expect(enc.startsWith("v1:")).toBe(true);
    expect(enc).not.toContain("sk-test");
    expect(decryptSecret(enc)).toBe("sk-test-abcdef1234");
  });

  it("returns null on corrupt payloads", () => {
    expect(decryptSecret("garbage")).toBeNull();
    expect(decryptSecret(null)).toBeNull();
    expect(decryptSecret(undefined)).toBeNull();
    expect(decryptSecret("v1:bad:bad:bad")).toBeNull();
  });

  it("masks without revealing the middle", () => {
    expect(maskSecret("sk-abcdefgh1234")).toBe("sk-…1234");
    expect(maskSecret("tiny")).toBe("…");
  });
});
