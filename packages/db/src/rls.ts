import { sql } from "drizzle-orm";

/**
 * Tenant tables that must be isolated by RLS. Kept as a plain list so the
 * same source of truth drives both migration-time setup and tests that
 * assert coverage.
 */
export const TENANT_TABLES = [
  "accounts",
  "people",
  "deals",
  "conversations",
  "signals",
  "signal_events",
  "agents",
  "runs",
  "run_steps",
  "outbox",
  "approvals",
  "knowledge",
  "segments",
  "audit_events",
] as const;

/**
 * Role used for all org-scoped queries. The app connects as the owning
 * role (superuser in PGlite) for migrations/admin, but withOrg() switches
 * to APP_ROLE via SET LOCAL ROLE inside the transaction — non-owner,
 * non-superuser, so RLS actually binds. Without this, FORCE RLS still lets
 * superusers bypass.
 */
export const APP_ROLE = "aigtm_app";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function applyRls(db: any) {
  await db.execute(sql.raw(`DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${APP_ROLE}') THEN
    CREATE ROLE ${APP_ROLE} NOLOGIN;
  END IF;
END$$`));
  await db.execute(sql.raw(`GRANT USAGE ON SCHEMA public TO ${APP_ROLE}`));
  await db.execute(
    sql.raw(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${APP_ROLE}`,
    ),
  );
  await db.execute(
    sql.raw(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${APP_ROLE}`,
    ),
  );

  for (const table of TENANT_TABLES) {
    await db.execute(sql.raw(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`));
    await db.execute(sql.raw(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`));
    await db.execute(sql.raw(`DROP POLICY IF EXISTS org_isolation ON ${table}`));
    await db.execute(
      sql.raw(
        `CREATE POLICY org_isolation ON ${table}
         USING (org_id::text = current_setting('app.current_org', true))
         WITH CHECK (org_id::text = current_setting('app.current_org', true))`,
      ),
    );
  }
}
