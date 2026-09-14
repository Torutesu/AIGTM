import { type NextRequest } from "next/server";
import { ilike, or } from "drizzle-orm";
import { schema, withOrg } from "@aigtm/db";
import { ensureDb } from "../../../lib/db";
import { currentSession } from "../../../lib/session";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await currentSession();
  if (!session) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 1) return Response.json({ accounts: [], people: [], deals: [], agents: [] });

  const handle = await ensureDb();
  const like = `%${q}%`;
  const data = await withOrg(
    handle,
    { orgId: session.orgId, userId: session.userId },
    async (tx) => {
      const [accounts, people, deals, agents] = await Promise.all([
        tx
          .select({ id: schema.accounts.id, name: schema.accounts.name })
          .from(schema.accounts)
          .where(ilike(schema.accounts.name, like))
          .limit(5),
        tx
          .select({ id: schema.people.id, name: schema.people.name, accountId: schema.people.accountId })
          .from(schema.people)
          .where(or(ilike(schema.people.name, like), ilike(schema.people.email, like)))
          .limit(5),
        tx
          .select({ id: schema.deals.id, name: schema.deals.name, accountId: schema.deals.accountId })
          .from(schema.deals)
          .where(ilike(schema.deals.name, like))
          .limit(5),
        tx
          .select({ id: schema.agents.id, name: schema.agents.name })
          .from(schema.agents)
          .where(ilike(schema.agents.name, like))
          .limit(5),
      ]);
      return { accounts, people, deals, agents };
    },
  );
  return Response.json(data);
}
