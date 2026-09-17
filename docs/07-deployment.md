# Deployment & Operations

Status of what's verified: migrations, RLS, seed, and the agent runtime have
been exercised against real PostgreSQL (pgvector/pg16 via docker-compose).
The web app has been verified in **production mode** (`next build` +
`next start` on real Postgres): login, every sidebar page, JA/EN locales,
`/api/search`, `/api/health`, and security headers all pass.
Everything below reflects what was actually run — not aspirational config.

## Environments

| Env | Database | How |
|---|---|---|
| Local dev (default) | PGlite (embedded, zero setup) | `pnpm dev` → `apps/web/.pglite` |
| E2E | PGlite, wiped per run | `pnpm test:e2e` → `apps/web/.pglite-e2e` |
| Local Postgres | docker-compose pg16 | `docker compose up -d db` |
| Production | Managed Postgres 16+ (pgvector optional today) | `DATABASE_URL` env |

`DATABASE_URL` selects the driver:

- unset or `pglite://<dir>` → embedded PGlite
- `postgres://…` / `postgresql://…` → `pg` pool (node-postgres)

## Environment variables

| Var | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | `pglite://./.pglite` | DB connection. |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | `admin@aigtm.local` / `admin-password` | Seed admin credentials. **Always override outside local dev.** |
| `SEED_VIEWER_EMAIL` / `SEED_VIEWER_PASSWORD` | `viewer@aigtm.local` / `viewer-password` | Seed read-only user (role demo + tests). |
| `AIGTM_SESSION_TTL_HOURS` | `168` | Session lifetime; also the cookie `maxAge`. Sessions extend on use past half-life (sliding expiration). |
| `ANTHROPIC_API_KEY` | unset | Registers the Anthropic provider. Never shipped to the client. |
| `OPENAI_API_KEY` | unset | Registers the OpenAI provider. |
| `AIGTM_MASTER_KEY` | dev fallback | Encrypts org BYOK keys (`organizations.provider_config`) with AES-256-GCM. **Set in production** — rotating it invalidates stored keys. |
| `AIGTM_MODEL_<ROLE>` | `mock` | Per-role provider routing. `<ROLE>` ∈ `REASONING` `FAST` `WRITING` `JAPANESE`; value = provider name (`mock`/`anthropic`/`openai`). Prefs naming an unregistered provider are ignored. |
| `AIGTM_ANTHROPIC_MODEL_<ROLE>` / `AIGTM_OPENAI_MODEL_<ROLE>` | per-provider defaults | Override the concrete model id per role. |
| `AIGTM_WORKER_INTERVAL_MS` | `15000` | Scheduler poll interval for the trigger worker. |
| `AIGTM_RUN_COST_LIMIT_CENTS` | `0` (unlimited) | Per-run spend brake. A run that would cross the ceiling is rejected before its next LLM step; partial spend is recorded on `runs.cost_cents`. |
| `AIGTM_E2E` (internal) | — | Set by Playwright's webServer env via `DATABASE_URL=pglite://./.pglite-e2e`. |

### Model providers (BYOK)

Two layers, org key wins over env:

- **`/settings` (admin)** — paste an OpenAI/Anthropic key per org; stored
  AES-256-GCM encrypted in `organizations.provider_config`, shown only
  masked. The same screen routes each role (`reasoning`/`fast`/`writing`/
  `japanese`) to a provider or a concrete model (`openai:gpt-4.1-mini`, …).
- **Env fallback** — `OPENAI_API_KEY`/`ANTHROPIC_API_KEY` register providers
  deployment-wide; `AIGTM_MODEL_<ROLE>` routes, `AIGTM_<PROVIDER>_MODEL_<ROLE>`
  overrides the concrete model.

`routerForOrg(handle, orgId)` resolves both layers per run — the worker calls
it per org, so one deployment serves tenants on different providers. With no
keys at all every role falls back to `MockProvider` — deterministic and fully
offline. LLM step prompts may be inline strings or repo-relative paths
(`prompts/*.md`).

### Trigger worker

Schedule/event triggers run in a separate process:

```bash
pnpm --filter @aigtm/agent-runtime worker           # poll loop
pnpm --filter @aigtm/agent-runtime worker -- --once # single tick (cron-friendly)
```

- `schedule` triggers use 5-field cron in **UTC**; each occurrence fires once
  (deduped by `triggerContext.scheduledFor`).
- `event: signal_event` triggers scan new `signal_events` rows; each event id
  fires once (deduped by `triggerContext.signalEventId`), honoring
  `trigger.where.score_gte`.
- The tick iterates every organization in isolation via `withOrg` and runs as
  `actorType: "system"`.
- **Multi-replica safe**: on pg the worker takes a session-scoped advisory
  lock (`pg_try_advisory_lock`); a second replica logs `worker.lease_denied`
  and exits. A crashed holder releases automatically.

## Observability

Run lifecycle and worker events emit single-line JSON on stdout
(`{"ts","level","event",…}`) via `logEvent` — ingest with any log sink.
Events: `run.completed`, `run.failed` (with orgId/runId/agentId, tokens,
costCents, durationMs), `worker.started`, `worker.tick`, `worker.tick_failed`,
`worker.lease_denied`. Prompts/outputs/secrets are never logged. Per-run cost
is also persisted on `runs.cost_cents` (price table in
`packages/agent-runtime/src/model.ts`).

## Backups

```bash
DATABASE_URL=postgres://... ./scripts/backup.sh [outdir]   # compressed pg_dump
pg_restore --clean --if-exists -d "$DATABASE_URL" file.dump
```

Schedule it via cron/systemd; on managed Postgres, enable provider PITR and
treat `backup.sh` as the export/portability path.

## CI

`.github/workflows/ci.yml` runs three jobs on push/PR: lint + typecheck +
unit tests + build; a pg16 service job running migrate → seed →
`verify-postgres.ts` (RLS + lease + runtime checks); and the Playwright E2E
suite with the report uploaded on failure.

## Local Postgres workflow (verified)

```bash
docker compose up -d db                     # pg16+pgvector on localhost:54329
DATABASE_URL=postgres://aigtm:aigtm@localhost:54329/aigtm pnpm db:seed
# seed.ts CLI runs migrate() first: drizzle migrations + RLS role/policies

DATABASE_URL=postgres://aigtm:aigtm@localhost:54329/aigtm pnpm dev
```

Postgres validation harness (idempotent, exits non-zero on failure):

```bash
DATABASE_URL=postgres://aigtm:aigtm@localhost:54329/aigtm \
  pnpm --filter @aigtm/web exec tsx scripts/verify-postgres.ts
```

It asserts: pg driver, migrations+RLS applied, all 14 tenant tables have
forced RLS, cross-org reads return nothing, cross-org inserts are rejected by
`WITH CHECK`, the viewer user exists, and `executeRun` / `retryableAgentId` /
`cancelRun` work on the pg driver.

## Multi-tenancy mechanics

- Every tenant table carries `org_id`; `applyRls` enables **FORCED** row-level
  security with an `org_isolation` policy keyed on `app.current_org`.
- All tenant access goes through `withOrg(handle, ctx, fn)`, which inside a
  transaction does `SET LOCAL ROLE aigtm_app` (non-owner, so RLS binds even
  though the connecting role is a superuser) then sets `app.current_org` /
  `app.current_user` GUCs.
- `aigtm_app` is created by `applyRls` and granted to `CURRENT_USER`, so
  non-superuser app roles work too. If the app connects as a dedicated role,
  ensure it's granted `aigtm_app` (or re-run migrate as it).

## Build & start

```bash
pnpm install
pnpm build                # turbo: all packages + next build
pnpm --filter @aigtm/web start   # serves apps/web on :3000
```

First boot on a fresh database:

```bash
DATABASE_URL=... pnpm db:migrate  # drizzle migrations + RLS (idempotent)
DATABASE_URL=... pnpm db:seed     # + demo org/users/data (skip for a clean tenant)
```

## Docker

One image serves web, worker, and one-shot jobs:

```bash
docker build -t aigtm .
docker run -e DATABASE_URL=... aigtm            # web on :3000
docker run -e DATABASE_URL=... aigtm worker     # trigger worker
docker run -e DATABASE_URL=... aigtm migrate    # migrations + RLS
docker run -e DATABASE_URL=... aigtm seed       # + demo seed
```

Full local stack (db + migrate + seed + web + worker):

```bash
docker compose --profile app up --build
# web on http://localhost:3000, admin@aigtm.local / admin-password
```

## HTTP surface

- `GET /api/health` — liveness/readiness probe; `200 {"ok":true,"db":"up"}` or
  `503`. Unauthenticated, for load balancers/uptime checks.
- `POST /api/ingest` — org-scoped webhook intake. `Authorization: Bearer
  <ingest key>` (generated per-org in `/settings`; only the sha256 is
  stored). Two payload types:
  - `{"type":"message","channel":"email|call|meeting|slack","from":"…","to":[…],
     "subject":"…","body":"…","occurredAt":"…"}` → `conversations` (sender
     domain → account resolution, deduped by channel+subject)
  - `{"type":"signal_event","signalName"|"signalId","accountDomain"|"accountId",
     "score":…,"evidence":{…}}` → `signal_events`; qualifying events fire
     `event: signal_event` agents on the next worker tick
  Both write `ingest.*` audit events. This is the real capture path until
  native connectors ship — point Zapier/n8n/cron jobs at it.
- Security headers on all routes: `X-Content-Type-Options: nosniff`,
  `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`,
  `Permissions-Policy` denying camera/mic/geo.
- TLS: the session cookie is `secure` in production — terminate TLS in front
  (load balancer / ingress). Plain-HTTP deployments behind a domain won't
  carry the cookie.

## Roles

`memberships.role`: `viewer` | `editor` | `admin` (seeded: admin + viewer).

- `viewer` — read-only. Server actions reject mutations (`requireActor` throws
  `forbidden`); the UI also hides action affordances (Run now, Approve/Dismiss,
  Retry/Cancel, segment creation) and shows a "view only" notice on pending
  approvals.
- `editor` — all operational actions.
- `admin` — additionally manages the org at `/settings`: list members, add
  members (creates the user if unknown), change roles, remove members.
  Self-demotion and removing/demoting the last admin are rejected server-side.
  The settings nav item renders for admins only, and non-admins hitting the
  URL directly get an admin-only notice.

## Authentication

- Sessions live in the `sessions` table; cookie `aigtm_session` is `httpOnly`,
  `sameSite=lax`, `path=/`, and `secure` when `NODE_ENV=production`.
- TTL via `AIGTM_SESSION_TTL_HOURS`; sessions past half-life get a fresh
  `expiresAt` on read (sliding expiration).
- Sign-in is throttled per email in the `login_attempts` table: 5 failures
  within 10 minutes locks for 60s (`SignInLocked` → `?error=locked`). Being
  DB-backed, the lock holds across replicas and restarts. Passwords are
  verified against a dummy hash for unknown emails so timing doesn't reveal
  account existence.

## External actions — mock-only invariant

Connectors are mocks. `send_email` never leaves the process: actions are
written to `outbox` behind `approvals`, and "dispatch" only flips the outbox
status. LLM calls are mock unless provider keys are configured (above) — model
egress is env-gated per role. Do not introduce real connector dispatch without
an explicit phase gate (see `docs/05-roadmap.md`).

## Production checklist (not yet done)

These are the honest gaps before selling this:

- [x] Deployable artifact: root Dockerfile (web/worker/migrate/seed) +
      `docker compose --profile app`; prod-mode smoke verified on real Postgres
- [x] `/api/health` probe + baseline security headers
- [x] CI: lint/typecheck/unit/build + pg16 migrate/seed/RLS-verify + E2E
      (`.github/workflows/ci.yml`)
- [ ] Real auth provider (current: cookie sessions + scrypt). Rate limiting,
      sliding TTL and secure cookies are in; SSO/OAuth and email verification
      are not.
- [x] Sign-in throttle is DB-backed (`login_attempts`) — consistent across
      replicas; sessions live in `sessions` so invalidation is already global
- [x] LLM providers behind env + per-run cost ceiling
      (`AIGTM_RUN_COST_LIMIT_CENTS`) and `runs.cost_cents` accounting;
      still needed: eval gating and per-org budgets
- [ ] Connector real implementations behind env flags, keeping mock default
- [x] Scheduled/event triggers: `worker` is multi-replica safe via pg
      advisory lease; a queued executor (Temporal/Trigger.dev) is the scale-up path
- [x] Backups: `scripts/backup.sh` (pg_dump custom format); provider PITR and
      a per-region residency story are still an ops decision
- [x] Observability: structured JSON logs for run lifecycle + worker events;
      audit_events remain queryable in-app. Next: a metrics endpoint
