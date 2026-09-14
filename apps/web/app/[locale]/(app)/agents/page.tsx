export const dynamic = "force-dynamic";
import { useTranslations } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { desc, eq } from "drizzle-orm";
import { schema, withOrg } from "@aigtm/db";
import { PlayIcon } from "../_components/icons";
import { Link } from "../../../../i18n/routing";
import { ensureDb } from "../../../../lib/db";
import { requireSession } from "../../../../lib/session";
import { runAgentAction } from "../../../../lib/actions";
import { PageHeader, Chip, Card, EmptyState, statusTone, stamp } from "../_components/ui";

interface AgentRow {
  id: string;
  name: string;
  enabled: boolean;
  spec: {
    description?: string;
    trigger?: { type?: string; schedule?: string };
    steps?: unknown[];
  } | null;
}

interface RunRow {
  id: string;
  status: string;
  startedAt: Date | string | null;
  agentName: string | null;
}

export default async function AgentsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await requireSession(locale);
  const handle = await ensureDb();

  const data = await withOrg(
    handle,
    { orgId: session.orgId, userId: session.userId },
    async (tx) => {
      const agentRows = (await tx
        .select()
        .from(schema.agents)
        .where(eq(schema.agents.enabled, true))) as AgentRow[];
      const runRows = (await tx
        .select({
          id: schema.runs.id,
          status: schema.runs.status,
          startedAt: schema.runs.startedAt,
          agentName: schema.agents.name,
        })
        .from(schema.runs)
        .leftJoin(schema.agents, eq(schema.runs.agentId, schema.agents.id))
        .orderBy(desc(schema.runs.startedAt))
        .limit(20)) as RunRow[];
      return { agentRows, runRows };
    },
  );

  return (
    <AgentsView
      locale={locale}
      agents={data.agentRows}
      runs={data.runRows}
      canAct={session.role !== "viewer"}
    />
  );
}

function AgentsView({
  locale,
  agents,
  runs,
  canAct,
}: {
  locale: string;
  agents: AgentRow[];
  runs: RunRow[];
  canAct: boolean;
}) {
  const t = useTranslations("agents");
  return (
    <div>
      <PageHeader
        eyebrow={t("eyebrow")}
        title={t("title")}
        meta={t("liveCount", { count: agents.length })}
      />

      {agents.length === 0 ? (
        <EmptyState label={t("empty")} />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {agents.map((agent) => (
            <li key={agent.id} data-testid="agent-card">
              <Card className="flex h-full flex-col gap-4 p-5">
                <div>
                  <div className="flex items-center justify-between gap-3">
                    <Link
                      href={`/agents/${agent.id}`}
                      className="truncate text-[15px] font-semibold text-ink hover:text-forest-deep"
                    >
                      {agent.name}
                    </Link>
                    <Chip tone="live" dot>
                      {t("live")}
                    </Chip>
                  </div>
                  <p className="mt-1.5 line-clamp-2 text-[13.5px] leading-relaxed text-ink-soft">
                    {agent.spec?.description}
                  </p>
                </div>
                <div className="mt-auto flex items-center justify-between border-t border-line-soft pt-3">
                  <span className="font-mono text-[11px] text-ink-faint">
                    {agent.spec?.trigger?.type ?? "manual"}
                    <span className="mx-1.5 text-line">·</span>
                    {agent.spec?.steps?.length ?? 0} {t("steps")}
                  </span>
                  {canAct ? (
                    <form action={runAgentAction.bind(null, locale)}>
                      <input type="hidden" name="agentId" value={agent.id} />
                      <button
                        type="submit"
                        data-testid={`run-${agent.id}`}
                        className="flex items-center gap-1.5 rounded-lg bg-forest px-3.5 py-1.5 font-mono text-[11px] tracking-[0.06em] text-white uppercase transition-colors hover:bg-forest-deep"
                      >
                        <PlayIcon size={11} strokeWidth={2.4} />
                        {t("run")}
                      </button>
                    </form>
                  ) : null}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <section className="mt-10">
        <h2 className="mb-3 font-mono text-[11px] tracking-label text-ink-soft uppercase">
          {t("runs")}
        </h2>
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left">
                <th className="px-5 py-3 font-mono text-[10.5px] font-medium tracking-label text-ink-faint uppercase">
                  Agent
                </th>
                <th className="px-5 py-3 font-mono text-[10.5px] font-medium tracking-label text-ink-faint uppercase">
                  {t("status")}
                </th>
                <th className="px-5 py-3 font-mono text-[10.5px] font-medium tracking-label text-ink-faint uppercase">
                  {t("started")}
                </th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr
                  key={run.id}
                  data-testid="run-row"
                  className="border-b border-line-soft last:border-0"
                >
                  <td className="px-5 py-3 text-[13.5px] font-medium text-ink">
                    <Link href={`/runs/${run.id}`} className="hover:text-forest-deep">
                      {run.agentName}
                    </Link>
                  </td>
                  <td className="px-5 py-3">
                    <Chip tone={statusTone(run.status)}>{run.status}</Chip>
                  </td>
                  <td className="px-5 py-3 font-mono text-[12px] text-ink-soft">
                    {run.startedAt ? stamp(run.startedAt, locale) : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {runs.length === 0 ? (
            <p className="px-5 py-8 text-center font-mono text-[11px] tracking-label text-ink-faint uppercase">
              {t("noRuns")}
            </p>
          ) : null}
        </Card>
      </section>
    </div>
  );
}
