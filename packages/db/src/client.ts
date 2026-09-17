/* eslint-disable @typescript-eslint/no-explicit-any */
// The cross-driver tx/handle type is intentionally loose: drizzle's pglite
// and node-postgres dialects are structurally different and we only rely on
// their shared query API surface.
import { sql } from "drizzle-orm";
import { join } from "node:path";
import * as schema from "./schema";

// Bypass bundler shims: webpack mocks node:module's createRequire.
const realCreateRequire = (process as any).getBuiltinModule
  ? (process as any).getBuiltinModule("module").createRequire
  : null;

export type DriverKind = "pglite" | "pg";

export interface DbHandle {
  db: any;
  driver: DriverKind;
  close: () => Promise<void>;
  /**
   * Cross-process advisory lease (pg only). Returns a release function, or
   * null when another process holds the lease. PGlite is single-process —
   * the lease is always granted. Lock is session-scoped: it is released
   * automatically if the holder disconnects, so a crashed worker frees it.
   */
  tryLease: (name: string) => Promise<null | (() => Promise<void>)>;
}

export interface OrgContext {
  orgId: string;
  userId?: string;
  actorType?: "user" | "agent" | "system";
  actorId?: string;
}

let cached: DbHandle | null = null;
// PGlite is single-connection: transactions must not interleave or the
// SET LOCAL org context would bleed between requests. Serialize all
// org-scoped work through this mutex. Real pg pools don't need it, but the
// same code path keeps behaviour deterministic.
let mutex: Promise<unknown> = Promise.resolve();

function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = mutex.then(fn, fn);
  mutex = next.catch(() => {});
  return next;
}

export function databaseUrl(): string {
  return process.env.DATABASE_URL ?? "pglite://./.pglite";
}

/**
 * require() anchored at this package's install location. Dynamic imports of
 * native/WASM deps (pglite, pg) must go through Node's real resolver —
 * webpack-bundled dynamic imports break URL handling inside PGlite.
 */
export function packageRequire() {
  if (!realCreateRequire) {
    // unbundled ESM runtime (vitest/tsx): import.meta.url is reliable here
    return createRequireFallback();
  }
  const anchor = realCreateRequire(join(process.cwd(), "package.json"));
  try {
    return realCreateRequire(anchor.resolve("@aigtm/db/package.json"));
  } catch {
    return anchor;
  }
}

function createRequireFallback(): NodeRequire {
  return (eval("require") as NodeRequire) ?? ({} as NodeRequire);
}

export async function createDb(url = databaseUrl()): Promise<DbHandle> {
  const req = packageRequire();
  if (url.startsWith("pglite:") || url === "memory:") {
    const { PGlite } = req("@electric-sql/pglite") as typeof import("@electric-sql/pglite");
    const { drizzle } = req("drizzle-orm/pglite") as typeof import("drizzle-orm/pglite");
    const dataDir = url === "memory:" ? undefined : url.slice("pglite://".length);
    const client = new PGlite(dataDir);
    await client.waitReady;
    return {
      db: drizzle(client, { schema }),
      driver: "pglite",
      close: () => client.close(),
      tryLease: async () => async () => {},
    };
  }
  const { drizzle } = req("drizzle-orm/node-postgres") as typeof import("drizzle-orm/node-postgres");
  const pg = req("pg") as typeof import("pg");
  const pool = new pg.Pool({ connectionString: url });
  return {
    db: drizzle(pool, { schema }),
    driver: "pg",
    close: () => pool.end(),
    tryLease: async (name) => {
      const client = await pool.connect();
      try {
        const r = await client.query(
          "SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS got",
          [name],
        );
        if (!r.rows[0]?.got) {
          client.release();
          return null;
        }
        return async () => {
          await client
            .query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [name])
            .catch(() => {});
          client.release();
        };
      } catch (err) {
        client.release();
        throw err;
      }
    },
  };
}

/** Shared singleton for the app server (one per process). */
export async function getDb(): Promise<DbHandle> {
  if (!cached) cached = await createDb();
  return cached;
}

/**
 * Run `fn` inside a transaction with the org (and actor) bound via SET LOCAL
 * GUCs, which the RLS policies check. NEVER run tenant-table queries outside
 * this wrapper.
 */
export async function withOrg<T>(
  handle: DbHandle,
  ctx: OrgContext,
  fn: (tx: any) => Promise<T>,
): Promise<T> {
  const run = () =>
    handle.db.transaction(async (tx: typeof handle.db) => {
      // Drop to the non-owner role first so RLS binds (superusers bypass it),
      // then bind the org/user context the policies check.
      await tx.execute(sql.raw("SET LOCAL ROLE aigtm_app"));
      await tx.execute(
        sql`SELECT set_config('app.current_org', ${ctx.orgId}, true),
                   set_config('app.current_user', ${ctx.userId ?? ""}, true)`,
      );
      return fn(tx);
    });
  // Serialize only when on the single-connection driver.
  return handle.driver === "pglite" ? withLock(run) : run();
}

/** Write an audit row. Call inside the same transaction as the mutation. */
export async function audit(
  tx: any,
  ctx: OrgContext,
  entry: {
    action: string;
    entityType: string;
    entityId: string;
    detail?: unknown;
  },
) {
  await tx.insert(schema.auditEvents).values({
    orgId: ctx.orgId,
    actorType: ctx.actorType ?? "system",
    actorId: ctx.actorId ?? ctx.userId ?? "system",
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    detail: (entry.detail ?? null) as object,
  });
}

export { schema };
export { sql };
