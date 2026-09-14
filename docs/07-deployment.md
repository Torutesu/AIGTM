# Deployment & Operations

Status of what's verified: migrations, RLS, seed, and the agent runtime have
been exercised against real PostgreSQL (pgvector/pg16 via docker-compose), and
the web app served authenticated pages + `/api/search` on that database.
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
| `AIGTM_E2E` (internal) | — | Set by Playwright's webServer env via `DATABASE_URL=pglite://./.pglite-e2e`. |

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
DATABASE_URL=... pnpm db:seed   # migrate + demo org/users/data
```

## Roles

`memberships.role`: `viewer` | `editor` | `admin` (seeded: admin + viewer).

- `viewer` — read-only. Server actions reject mutations (`requireActor` throws
  `forbidden`); the UI also hides action affordances (Run now, Approve/Dismiss,
  Retry/Cancel, segment creation) and shows a "view only" notice on pending
  approvals.
- `editor`/`admin` — all operational actions. Admin-only surface (org/member
  management) is not yet built; treat editor≡admin until it lands.

## External actions — mock-only invariant

Connectors and the model router are mocks. `send_email` never leaves the
process: actions are written to `outbox` behind `approvals`, and "dispatch"
only flips the outbox status. There is no real network egress in the runtime.
Do not introduce real dispatch without an explicit phase gate (see
`docs/05-roadmap.md`).

## Production checklist (not yet done)

These are the honest gaps before selling this:

- [ ] Managed Postgres + migrations in CI (`applyRls` is idempotent, safe in deploy)
- [ ] Real auth provider (current: cookie session + bcrypt, single org-admin)
- [ ] LLM provider credentials + cost ceilings (`ModelRouter` is provider-abstract)
- [ ] Connector real implementations behind env flags, keeping mock default
- [ ] Scheduled/event triggers: needs a worker process (cron / queue consumer)
- [ ] Session store hardening (rotate `aigtm_session`, rate-limit sign-in)
- [ ] Backups, PITR, and per-region data residency story for JP customers
- [ ] Observability: audit_events exist, but ship them to a log sink
