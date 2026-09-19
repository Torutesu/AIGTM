import { getDb, migrate, type DbHandle } from "@aigtm/db";
import { seed } from "@aigtm/db/seed";
import { syncSpecs } from "@aigtm/agent-runtime";

let ready: Promise<DbHandle> | null = null;

/**
 * Lazily create the DB, run migrations, and seed demo data on first use.
 * Declarative specs (agents/*.yaml, signals/*.yaml) are synced into every
 * org — Git is the source of truth for specs. PGlite (default) keeps
 * dev/test hermetic — no external services.
 */
export function ensureDb(): Promise<DbHandle> {
  if (!ready) {
    ready = (async () => {
      const handle = await getDb();
      await migrate(handle);
      if (process.env.AIGTM_AUTO_SEED !== "0") await seed(handle);
      await syncSpecs(handle);
      return handle;
    })();
  }
  return ready;
}
