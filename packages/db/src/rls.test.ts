import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { createDb, migrate, withOrg, schema, TENANT_TABLES, type DbHandle } from "./index";
import { seed } from "./seed";

let handle: DbHandle;
let orgId: string;

beforeAll(async () => {
  handle = await createDb("memory:");
  await migrate(handle);
  ({ orgId } = await seed(handle));
});

afterAll(async () => {
  await handle.close();
});

describe("RLS org isolation", () => {
  it("returns rows only for the bound org", async () => {
    // second org, empty
    const db = handle.db;
    const [org2] = await db
      .insert(schema.organizations)
      .values({ name: "Other Corp" })
      .returning();

    const inOrg1: unknown[] = await withOrg(handle, { orgId }, (tx) =>
      tx.select().from(schema.accounts),
    );
    const inOrg2: unknown[] = await withOrg(handle, { orgId: org2.id }, (tx) =>
      tx.select().from(schema.accounts),
    );
    expect(inOrg1.length).toBeGreaterThan(0);
    expect(inOrg2).toHaveLength(0);
  });

  it("returns nothing when org context is unset", async () => {
    const rows: unknown[] = await handle.db.transaction(async (tx: never) => {
      // app role + deliberately no org GUC → policy compares against NULL
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const t = tx as any;
      await t.execute(sql.raw("SET LOCAL ROLE aigtm_app"));
      return t.select().from(schema.accounts);
    });
    expect(rows).toHaveLength(0);
  });

  it("blocks cross-org inserts via WITH CHECK", async () => {
    // Inside org A context, try to insert a row stamped with org B.
    const db = handle.db;
    const [org2] = await db
      .insert(schema.organizations)
      .values({ name: "Evil Corp" })
      .returning();
    await expect(
      withOrg(handle, { orgId }, (tx) =>
        tx.insert(schema.accounts).values({ orgId: org2.id, name: "sneaky" }),
      ),
    ).rejects.toThrowError();
  });

  it("audit_events are also org-scoped", async () => {
    const rows: unknown[] = await withOrg(handle, { orgId }, (tx) =>
      tx.select().from(schema.auditEvents),
    );
    expect(rows.length).toBeGreaterThan(0);
    const db = handle.db;
    const [org2] = await db
      .insert(schema.organizations)
      .values({ name: "Audit Corp" })
      .returning();
    const none: unknown[] = await withOrg(handle, { orgId: org2.id }, (tx) =>
      tx.select().from(schema.auditEvents),
    );
    expect(none).toHaveLength(0);
  });

  it("all tenant tables have forced RLS", async () => {
    const names = TENANT_TABLES.map((n) => `'${n}'`).join(",");
    const result = await handle.db.execute(
      sql.raw(`SELECT relname, relrowsecurity, relforcerowsecurity
        FROM pg_class WHERE relname IN (${names})`),
    );
    const rows = (result as { rows: { relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }[] }).rows;
    expect(rows).toHaveLength(14);
    for (const r of rows) {
      expect(r.relrowsecurity, r.relname).toBe(true);
      expect(r.relforcerowsecurity, r.relname).toBe(true);
    }
  });
});
