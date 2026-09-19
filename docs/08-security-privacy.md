# Security & privacy

What AIGTM does today to protect tenant data, and what an operator must
configure. Written for internal review and customer security
questionnaires.

## Data classification

| Data | Where | Protection |
|---|---|---|
| Passwords | `users.password_hash` | salted hash (never plaintext); SSO users get a `sso:<provider>` sentinel that can never match a password |
| Sessions | `sessions` (token = random, expiry enforced) | httpOnly + SameSite=Lax cookie; `Secure` in production; sliding TTL |
| BYOK provider keys, webhooks, OAuth refresh tokens | `organizations.provider_config` | AES-256-GCM ciphertext; key = `AIGTM_MASTER_KEY`; UI shows masked values only |
| Ingest keys | `provider_config.ingest_key_hash` | SHA-256 hash only — the plaintext is shown once at generation and never stored |
| Conversations / CRM data / signals / runs | tenant tables | Postgres RLS (forced) scoped by `organization_id`; verified on real Postgres (15 tables) |
| Audit trail | `audit_events` | append-only via the shared `audit()` writer; optional forwarding to an external sink |
| Prompt contents / LLM outputs | `run_steps` | tenant-scoped; never written to logs (structured logs carry ids, counts, costs — no content) |

## Tenant isolation

- Every tenant table carries `organization_id`; RLS is `ENABLED` + `FORCED`
  on all 15 tables (verified: `apps/web/scripts/verify-postgres.ts`).
- Cross-org reads/writes are rejected by policy, not by app convention.
- `withOrg()` sets the org context inside a transaction — used by every
  runtime and UI query path.

## Authentication

- Password sign-in with DB-backed throttling (5 failures → 60s lock;
  `login_attempts`, works across replicas).
- Google SSO: state-cookie flow, `userinfo` validation. New users are
  provisioned only when the target org is unambiguous — multi-org
  deployments reject rather than guess a tenant.
- Roles: `viewer` < `editor` < `admin`. Admin-only: settings, members,
  provider keys, integrations, ingest keys, Google connect.

## Destructive actions

Send/write-back never executes directly: `Approval` (human decision,
reason required for dismissal, draft diff tracked) → `Outbox` → provider
dispatch. Unconfigured providers report `mock: true` in the audit trail —
nothing pretends to have sent.

## Network surface

- Security headers on every route (`nosniff`, `DENY`, Referrer-Policy,
  Permissions-Policy). TLS is terminated upstream; `Secure` cookies on in
  production.
- `/api/ingest`: bearer key + 256KB body cap + per-key rate limit.
- `/api/metrics`: off unless `AIGTM_METRICS_TOKEN` is set, then Bearer.
- `/api/health`: liveness only, no data.
- All outbound calls have deadlines (15–90s) and bounded retries — no
  endpoint can hang a worker or handler indefinitely.

## Secrets handling

- `AIGTM_MASTER_KEY` encrypts org secrets. Rotating it invalidates stored
  ciphertexts — treat it like a KMS root: keep it in your secret manager.
- No secret is ever logged; API keys are shown once (ingest) or masked.
- Provider keys can also come from env (`OPENAI_API_KEY`, …) — org-stored
  keys take precedence per tenant.

## Availability & integrity

- Worker singleton via `pg_try_advisory_lock` (crash = auto-release).
- Per-run and per-org-monthly cost ceilings bound LLM spend.
- Backups: `scripts/backup.sh` (pg_dump custom format). **Restore is
  verified**: table counts and forced-RLS flags survive a pg_restore
  round-trip. For managed Postgres, enable PITR as well.

## Data subject rights (GDPR erasure)

- **Person**: Contacts → Erase (admin only, confirmed). Anonymizes the
  record: name → `[erased]`, email/role nulled, and the identity is
  scrubbed from every conversation `participants[]`. Audited as
  `person.erased`. Idempotent.
- **Account**: Account 360 → Erase (admin only, confirmed). Same for the
  account plus all attached people. Audited as `account.erased`.
- Implemented in `@aigtm/db` (`erasure.ts`) inside `withOrg` — org-scoped
  and RLS-covered; viewers/members cannot call the server actions.
- Tombstone-not-delete is deliberate: foreign keys make hard deletes
  unsafe and the audit trail must survive the subject.

## Known limits (honest list)

- Audit sink forwarding is at-least-once and may duplicate events (the
  watermark is durable in `worker_state`; a crash between POST and
  watermark write re-sends the batch).
- Rate limits are per-instance (multiplied by replica count).
- No field-level encryption for conversation content — relies on Postgres
  at-rest encryption (volume/TDE) from your provider.
- GDPR erasure anonymizes/tombstones records (name/email/role nulled,
  `[erased]` marker, participants scrubbed) — hard deletes are unsafe
  under the FK graph. Conversation bodies/summaries are not rewritten.
- Automated retention policies (per-record TTL, scheduled purges) are
  not yet productized.
