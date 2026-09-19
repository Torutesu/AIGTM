import { createDb, migrate } from "@aigtm/db";
import { schema } from "@aigtm/db";
import { syncGoogleWorkspace } from "./google";

/**
 * `pnpm --filter @aigtm/connectors sync` — sync every org's configured
 * connectors (Google Workspace today) into conversations. Run manually or
 * on a cron; the worker also calls this on its tick when the per-org
 * interval has elapsed.
 */
const handle = await createDb();
await migrate(handle);
const orgs = (await handle.db
  .select({ id: schema.organizations.id })
  .from(schema.organizations)) as { id: string }[];

for (const org of orgs) {
  try {
    const res = await syncGoogleWorkspace(handle, org.id);
    if (res) {
      console.log(
        JSON.stringify({ event: "connectors.synced", orgId: org.id, ...res }),
      );
    }
  } catch (e) {
    console.warn(
      JSON.stringify({
        event: "connectors.sync_failed",
        orgId: org.id,
        error: e instanceof Error ? e.message : String(e),
      }),
    );
  }
}
await handle.close();
