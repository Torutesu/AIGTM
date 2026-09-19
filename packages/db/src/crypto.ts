import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

let warned = false;

/**
 * AES-256-GCM encryption for org-scoped secrets (BYOK provider keys).
 * Key material derives from AIGTM_MASTER_KEY. The dev fallback exists so
 * local dev needs no setup — it is not safe for production.
 */
function masterKey(): Buffer {
  const secret = process.env.AIGTM_MASTER_KEY;
  if (!secret && !warned) {
    warned = true;
    console.warn(
      "[aigtm] AIGTM_MASTER_KEY unset — using the built-in dev key. " +
        "Set it before storing real secrets.",
    );
  }
  return createHash("sha256")
    .update(secret ?? "aigtm-dev-insecure-master-key")
    .digest();
}

/** Encrypt → "v1:<iv>:<tag>:<ciphertext>" (base64 parts). */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `v1:${iv.toString("base64")}:${cipher.getAuthTag().toString("base64")}:${data.toString("base64")}`;
}

/** Decrypt a payload from encryptSecret; returns null on any corruption. */
export function decryptSecret(payload: string | null | undefined): string | null {
  if (!payload) return null;
  try {
    const [v, iv, tag, data] = payload.split(":");
    if (v !== "v1" || !iv || !tag || !data) return null;
    const decipher = createDecipheriv(
      "aes-256-gcm",
      masterKey(),
      Buffer.from(iv, "base64"),
    );
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(data, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}

/**
 * Field-level encryption for record text (conversation summaries etc.).
 * Transparent mixed-mode read: ciphertext ("v1:") is decrypted, legacy
 * plaintext passes through, corruption yields null rather than garbage.
 */
export function encryptField(plain: string | null | undefined): string | null {
  if (!plain) return null;
  return encryptSecret(plain);
}

export function decryptField(payload: string | null | undefined): string | null {
  if (!payload) return null;
  if (!payload.startsWith("v1:")) return payload;
  return decryptSecret(payload);
}

/** Display form for a stored secret: "sk-…wxyz". Never logs the value. */
export function maskSecret(plain: string): string {
  if (plain.length <= 8) return "…";
  return `${plain.slice(0, 3)}…${plain.slice(-4)}`;
}

/** Generate a new ingest/webhook key: "aigtm_<base64url>". */
export function newIngestKey(): string {
  return `aigtm_${randomBytes(24).toString("base64url")}`;
}

/** sha256 hex — stored for lookup; plaintext keys are never persisted. */
export function hashSecret(plain: string): string {
  return createHash("sha256").update(plain).digest("hex");
}
