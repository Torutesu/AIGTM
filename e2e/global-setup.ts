import { rm } from "node:fs/promises";
import { join } from "node:path";

/**
 * The e2e dev server runs PGlite against apps/web/.pglite-e2e. Seed data is
 * consumable (a pending approval gets approved by the suite), so wipe the
 * store before every run to keep tests deterministic.
 */
export default async function globalSetup() {
  await rm(join(process.cwd(), "apps/web/.pglite-e2e"), {
    recursive: true,
    force: true,
  });
}
