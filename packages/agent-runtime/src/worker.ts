/**
 * Scheduler worker: polls agent specs for due schedule/event triggers and
 * executes runs. All dispatch remains mock-safe (approvals + outbox only).
 *
 *   pnpm --filter @aigtm/agent-runtime worker          # loop every 15s
 *   pnpm --filter @aigtm/agent-runtime worker -- --once # single tick
 *   AIGTM_WORKER_INTERVAL_MS=5000 …                    # custom interval
 *   DATABASE_URL=postgres://…                         # real Postgres
 */
import { createDb, migrate } from "@aigtm/db";
import { tick } from "./scheduler";
import { defaultRouter } from "./model";

const intervalMs = Number(process.env.AIGTM_WORKER_INTERVAL_MS ?? 15_000);
const once = process.argv.includes("--once");

const handle = await createDb();
await migrate(handle);
const router = defaultRouter();

async function loop() {
  try {
    const n = await tick(handle, { router });
    if (n > 0) console.log(`[worker] ${new Date().toISOString()} launched ${n} run(s)`);
  } catch (err) {
    console.error("[worker] tick failed:", err);
  }
}

await loop();
if (once) {
  await handle.close();
  process.exit(0);
}
console.log(`[worker] polling every ${intervalMs}ms (driver: ${handle.driver})`);
setInterval(loop, intervalMs);
