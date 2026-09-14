import { dirname, join } from "node:path";
import type { DbHandle } from "./client";
import { packageRequire } from "./client";
import { applyRls } from "./rls";

/**
 * Resolve the migrations folder via require.resolve on the package name.
 * import.meta.url is unreliable inside webpack-bundled server code.
 */
function migrationsFolder(): string {
  const req = packageRequire();
  try {
    return join(dirname(req.resolve("@aigtm/db/package.json")), "migrations");
  } catch {
    return join(process.cwd(), "migrations");
  }
}

/** Apply drizzle migrations + RLS policies. Idempotent. */
export async function migrate(handle: DbHandle, folder = migrationsFolder()) {
  const req = packageRequire();
  const mod =
    handle.driver === "pglite"
      ? (req("drizzle-orm/pglite/migrator") as typeof import("drizzle-orm/pglite/migrator"))
      : (req("drizzle-orm/node-postgres/migrator") as typeof import("drizzle-orm/node-postgres/migrator"));
  await mod.migrate(handle.db, { migrationsFolder: folder });
  await applyRls(handle.db);
}
