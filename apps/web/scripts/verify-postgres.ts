/**
 * End-to-end validation against a real PostgreSQL database (not PGlite).
 *
 * Usage:
 *   docker compose up -d db
 *   DATABASE_URL=postgres://aigtm:aigtm@localhost:54329/aigtm \
 *     pnpm --filter @aigtm/web exec tsx scripts/verify-postgres.ts
 *
 * Checks: migrations + RLS apply, role/grant setup, tenant isolation,
 * cross-org insert rejection, agent runtime end-to-end, retry/cancel.
 * Idempotent — safe to re-run.
 */
import { sql, eq } from "drizzle-orm";
import {
  createDb,
  migrate,
  withOrg,
  schema,
  seed,
  TENANT_TABLES,
  VIEWER,
} from "@aigtm/db";
import { executeRun, cancelRun, retryableAgentId } from "@aigtm/agent-runtime";

const url = process.env.DATABASE_URL;
if (!url || url.startsWith("pglite:") || url === "memory:") {
  console.error("Set DATABASE_URL to a postgres:// URL (this script is for real Postgres).");
  process.exit(1);
}

let failures = 0;
const check = (name: string, ok: boolean, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? ` — ${extra}` : ""}`);
  if (!ok) failures++;
};

const handle = await createDb(url);
console.log(`driver: ${handle.driver}`);
check("pg driver selected", handle.driver === "pg");

await migrate(handle);
check("migrations + RLS applied", true);

const { orgId, userId } = await seed(handle);
const ctx = { orgId, userId, actorType: "user" as const };

// Forced RLS on every tenant table.
const names = TENANT_TABLES.map((n) => `'${n}'`).join(",");
const rls = await handle.db.execute(
  sql.raw(`SELECT relname, relrowsecurity, relforcerowsecurity
           FROM pg_class WHERE relname IN (${names})`),
);
const rlsRows = (rls as { rows: { relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }[] }).rows;
check(
  "all tenant tables have forced RLS",
  rlsRows.length === TENANT_TABLES.length &&
    rlsRows.every((r) => r.relrowsecurity && r.relforcerowsecurity),
  `${rlsRows.length}/${TENANT_TABLES.length}`,
);

// Tenant isolation.
const [org2] = await handle.db
  .insert(schema.organizations)
  .values({ name: `Verify Corp ${Date.now()}` })
  .onConflictDoNothing()
  .returning();
const orgB =
  org2 ??
  ((
    (await handle.db
      .select()
      .from(schema.organizations)
      .limit(2)) as { id: string }[]
  ).find((o) => o.id !== orgId))!;

const inOrgA: unknown[] = await withOrg(handle, ctx, (tx) =>
  tx.select().from(schema.accounts),
);
const inOrgB: unknown[] = await withOrg(handle, { orgId: orgB.id }, (tx) =>
  tx.select().from(schema.accounts),
);
check("org A sees seeded accounts", inOrgA.length > 0, `${inOrgA.length} rows`);
check("org B sees nothing", inOrgB.length === 0);

let insertBlocked = false;
try {
  await withOrg(handle, ctx, (tx) =>
    tx.insert(schema.accounts).values({ orgId: orgB.id, name: "sneaky" }),
  );
} catch {
  insertBlocked = true;
}
check("cross-org insert rejected by WITH CHECK", insertBlocked);

// Viewer membership seeded.
const viewer = await handle.db
  .select({ role: schema.memberships.role })
  .from(schema.memberships)
  .innerJoin(schema.users, eq(schema.memberships.userId, schema.users.id))
  .where(eq(schema.users.email, VIEWER.email));
check("viewer user exists with viewer role", viewer[0]?.role === "viewer");

// Agent runtime end-to-end on real Postgres.
const [agent] = (await withOrg(handle, ctx, (tx) =>
  tx
    .select()
    .from(schema.agents)
    .where(eq(schema.agents.name, "Stalled Deal Recovery"))
    .limit(1),
)) as { id: string }[];
const run = await executeRun(handle, ctx, { agentId: agent.id, triggerKind: "manual" });
check("executeRun fulfills on pg", run.status === "fulfilled", run.runId);

const resolved = await retryableAgentId(handle, ctx, run.runId!);
check("retryableAgentId resolves", resolved === agent.id);

const [hung] = (await withOrg(handle, ctx, async (tx) =>
  tx
    .insert(schema.runs)
    .values({ orgId, agentId: agent.id, triggerKind: "manual" })
    .returning(),
)) as { id: string }[];
const cancelled = await cancelRun(handle, ctx, hung.id);
check("cancelRun cancels running run", cancelled.status === "cancelled");

// Worker lease: pg advisory lock grants once, denies the second holder,
// and frees on release.
const first = await handle.tryLease("verify-lease");
check("advisory lease granted", first !== null);
const second = await handle.tryLease("verify-lease");
check("second lease denied while held", second === null);
await first!();
const third = await handle.tryLease("verify-lease");
check("lease reacquired after release", third !== null);
await third!();

await handle.close();
console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
