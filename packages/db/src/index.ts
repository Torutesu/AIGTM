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
export { fetchWithTimeout, HttpTimeoutError } from "./http";

/** Shape stored in organizations.provider_config (keys are ciphertext). */
export interface OrgProviderConfig {
  keys?: { openai?: string; anthropic?: string };
  /** role → "provider" or "provider:model" */
  roles?: Partial<Record<"reasoning" | "fast" | "writing" | "japanese", string>>;
  /** sha256 of the org's ingest key — compared against Bearer tokens. */
  ingestKeyHash?: string;
  /** Slack incoming webhook URL (ciphertext) — post_slack dispatch target. */
  slackWebhookUrl?: string;
  /**
   * Generic action webhook URL (ciphertext). Outbox kinds without a native
   * provider (crm_write, create_task, …) POST {kind, payload} here — the
   * production path for CRM writebacks via Zapier/n8n/custom endpoints.
   */
  actionWebhookUrl?: string;
  /**
   * Google Workspace connector (all ciphertext). OAuth desktop/web client
   * with a refresh token covering gmail.readonly + calendar.readonly.
   */
  google?: {
    clientId?: string;
    clientSecret?: string;
    refreshToken?: string;
    /** Google account the workspace was connected as (plaintext, display only). */
    email?: string;
    /** RFC3339 — when the OAuth connect flow completed. */
    connectedAt?: string;
  };
  /** RFC3339 — last successful connector sync (plaintext is fine). */
  connectorsLastSyncAt?: string;
}
export { erasePerson, eraseAccount } from "./erasure";
