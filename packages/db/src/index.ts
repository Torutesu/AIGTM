export * from "./schema";
export * from "./client";
export * from "./migrate";
export * from "./password";
export { seed, DEMO, VIEWER } from "./seed";
export { TENANT_TABLES } from "./rls";
export {
  encryptSecret,
  decryptSecret,
  maskSecret,
  newIngestKey,
  hashSecret,
} from "./crypto";

/** Shape stored in organizations.provider_config (keys are ciphertext). */
export interface OrgProviderConfig {
  keys?: { openai?: string; anthropic?: string };
  /** role → "provider" or "provider:model" */
  roles?: Partial<Record<"reasoning" | "fast" | "writing" | "japanese", string>>;
  /** sha256 of the org's ingest key — compared against Bearer tokens. */
  ingestKeyHash?: string;
}
