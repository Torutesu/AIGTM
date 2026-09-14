import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * scrypt password hashing. Format: `scrypt$N$r$p$salt$hash` (base64).
 * Phase-0 minimal auth — replace with better-auth before external sale.
 */
const N = 16384,
  r = 8,
  p = 1,
  KEYLEN = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEYLEN, { N, r, p });
  return `scrypt$${N}$${r}$${p}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, rr, pp, saltB64, hashB64] = parts;
  const hash = scryptSync(password, Buffer.from(saltB64, "base64"), KEYLEN, {
    N: Number(n),
    r: Number(rr),
    p: Number(pp),
  });
  const expected = Buffer.from(hashB64, "base64");
  return hash.length === expected.length && timingSafeEqual(hash, expected);
}

export function newSessionToken(): string {
  return randomBytes(32).toString("base64url");
}
