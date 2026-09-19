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
import { syncSpecs } from "./spec-sync";
import { logEvent } from "./log";

const intervalMs = Number(process.env.AIGTM_WORKER_INTERVAL_MS ?? 15_000);
const once = process.argv.includes("--once");

const handle = await createDb();
await migrate(handle);
await syncSpecs(handle); // repo specs (agents/signals yaml) → every org

// Multi-replica safety: only one worker ticks at a time. The pg advisory
// lock is session-scoped, so a crashed holder releases automatically.
const release = await handle.tryLease("aigtm-worker");
if (!release) {
  logEvent("worker.lease_denied", { reason: "another replica holds the lease" });
  await handle.close();
  process.exit(0);
}
process.on("SIGINT", () => void release().finally(() => process.exit(0)));
process.on("SIGTERM", () => void release().finally(() => process.exit(0)));

const router = defaultRouter();

async function loop() {
  try {
    const n = await tick(handle, { router });
    if (n > 0) logEvent("worker.tick", { launched: n });
  } catch (err) {
    logEvent("worker.tick_failed", { error: String(err) }, "warn");
  }
}

await loop();
if (once) {
  await handle.close();
  process.exit(0);
}
logEvent("worker.started", { intervalMs, driver: handle.driver });
setInterval(loop, intervalMs);
