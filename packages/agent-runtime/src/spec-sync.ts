import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { and, eq } from "drizzle-orm";
import { schema, withOrg, type DbHandle } from "@aigtm/db";
import {
  loadSpecDir,
  parseAgentSpec,
  parseSignalSpec,
} from "@aigtm/specs";
import { logEvent } from "./log";

/**
 * Declarative specs in `agents/*.yaml` and `signals/*.yaml` are the source
 * of truth (AGENTS.md principle 2). syncSpecs upserts them into every org —
 * keyed on name, preserving `enabled`. Called at worker boot, by ensureDb
 * after seeding, and via `pnpm --filter @aigtm/agent-runtime sync-specs`.
 */
function repoRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const base of [join(here, "..", "..", ".."), process.cwd()]) {
    if (existsSync(join(base, "agents"))) return base;
  }
  return process.cwd();
}

export async function syncSpecs(
  handle: DbHandle,
  root = repoRoot(),
): Promise<{ agents: number; signals: number }> {
  const agentSpecs = existsSync(join(root, "agents"))
    ? loadSpecDir(join(root, "agents"), (raw) => parseAgentSpec(raw))
    : [];
  const signalSpecs = existsSync(join(root, "signals"))
    ? loadSpecDir(join(root, "signals"), (raw) => parseSignalSpec(raw))
    : [];
  const orgs = (await handle.db
    .select({ id: schema.organizations.id })
    .from(schema.organizations)) as { id: string }[];

  let a = 0,
    s = 0;
  for (const org of orgs) {
    await withOrg(handle, { orgId: org.id, actorType: "system" }, async (tx) => {
      for (const spec of agentSpecs) {
        const [existing] = await tx
          .select({ id: schema.agents.id })
          .from(schema.agents)
          .where(and(eq(schema.agents.orgId, org.id), eq(schema.agents.name, spec.name)))
          .limit(1);
        if (existing) {
          await tx
            .update(schema.agents)
            .set({ spec })
            .where(eq(schema.agents.id, existing.id));
        } else {
          await tx
            .insert(schema.agents)
            .values({ orgId: org.id, name: spec.name, spec, enabled: true });
        }
        a++;
      }
      for (const spec of signalSpecs) {
        const [existing] = await tx
          .select({ id: schema.signals.id })
          .from(schema.signals)
          .where(and(eq(schema.signals.orgId, org.id), eq(schema.signals.name, spec.name)))
          .limit(1);
        if (existing) {
          await tx
            .update(schema.signals)
            .set({ spec })
            .where(eq(schema.signals.id, existing.id));
        } else {
          await tx
            .insert(schema.signals)
            .values({ orgId: org.id, name: spec.name, spec, enabled: true });
        }
        s++;
      }
    });
  }
  return { agents: a, signals: s };
}

// CLI entry: pnpm --filter @aigtm/agent-runtime sync-specs
if (process.argv[1] && process.argv[1].endsWith("spec-sync.ts")) {
  const { createDb, migrate } = await import("@aigtm/db");
  const handle = await createDb();
  await migrate(handle);
  const res = await syncSpecs(handle);
  logEvent("specs.synced", res);
  await handle.close();
}
