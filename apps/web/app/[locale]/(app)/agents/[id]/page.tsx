export const dynamic = "force-dynamic";
import { useTranslations } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { desc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { schema, withOrg } from "@aigtm/db";
import { PlayIcon } from "../../_components/icons";
import { SubmitButton } from "../../_components/submit-button";
import { ensureDb } from "../../../../../lib/db";
import { requireSession } from "../../../../../lib/session";
import { runAgentAction } from "../../../../../lib/actions";
import {
  Chip,
  Card,
  EmptyState,
  statusTone,
  stamp,
} from "../../_components/ui";
import { Link } from "../../../../../i18n/routing";

interface AgentRow {
  id: string;
  name: string;
  enabled: boolean;
  spec: {
    description?: string;
    trigger?: { type?: string; schedule?: string };
    approval?: { before_act?: string };
    steps?: { id?: string; kind?: string; tool?: string; model?: string; prompt?: string }[];
    act?: { type?: string; assignee?: string }[];
  } | null;
}
interface RunRow {
  id: string;
  status: string;
  triggerKind: string;
  startedAt: Date | string;
  finishedAt: Date | string | null;
  tokensIn: number;
  tokensOut: number;
  evalScore: string | null;
}

export default async function AgentDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const session = await requireSession(locale);
  const handle = await ensureDb();

  const data = await withOrg(
    handle,
    { orgId: session.orgId, userId: session.userId },
    async (tx) => {
      const [agent] = (await tx
        .select()
        .from(schema.agents)
        .where(eq(schema.agents.id, id))
        .limit(1)) as AgentRow[];
      if (!agent) return null;
      const runs = (await tx
        .select()
        .from(schema.runs)
        .where(eq(schema.runs.agentId, id))
        .orderBy(desc(schema.runs.startedAt))
        .limit(50)) as RunRow[];
      return { agent, runs };
    },
  );

  if (!data) notFound();
  return (
    <AgentView locale={locale} canAct={session.role !== "viewer"} {...data} />
  );
}

function AgentView({
  locale,
  agent,
  runs,
  canAct,
}: {
  locale: string;
  agent: AgentRow;
  runs: RunRow[];
  canAct: boolean;
}) {
  const t = useTranslations("agent");
  const spec = agent.spec ?? {};
  return (
    <div>
      <header className="mb-8 flex items-start justify-between gap-6">
        <div>
          <p className="font-mono text-[11px] tracking-label text-ink-faint uppercase">
            {t("eyebrow")}
          </p>
          <div className="mt-2 flex items-center gap-3">
            <h1 className="text-[26px] leading-tight font-semibold tracking-tight text-forest-deep">
              {agent.name}
            </h1>
            <Chip tone="live" dot>
              {t("live")}
            </Chip>
          </div>
          {spec.description ? (
            <p className="mt-1.5 max-w-xl text-[13.5px] leading-relaxed text-ink-soft">
              {spec.description}
            </p>
          ) : null}
        </div>
        {canAct ? (
          <form action={runAgentAction.bind(null, locale)}>
            <input type="hidden" name="agentId" value={agent.id} />
            <SubmitButton className="flex shrink-0 items-center gap-1.5 rounded-lg bg-forest px-4 py-2.5 font-mono text-[11px] tracking-[0.06em] text-white uppercase transition-colors hover:bg-forest-deep">
              <PlayIcon size={11} strokeWidth={2.4} />
              {t("run")}
            </SubmitButton>
          </form>
        ) : null}
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section>
          <h2 className="mb-3 font-mono text-[11px] tracking-label text-ink-soft uppercase">
            {t("runs")}
          </h2>
          {runs.length === 0 ? (
            <EmptyState label={t("noRuns")} />
          ) : (
            <Card className="divide-y divide-line-soft">
              {runs.map((r) => (
                <Link
                  key={r.id}
                  href={`/runs/${r.id}`}
                  className="flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-paper/60"
                >
                  <Chip tone={statusTone(r.status)}>{r.status}</Chip>
                  <span className="font-mono text-[11px] text-ink-soft">
                    {r.triggerKind}
                  </span>
                  <span className="ml-auto font-mono text-[11px] text-ink-faint">
                    {r.tokensIn + r.tokensOut > 0
                      ? `${r.tokensIn + r.tokensOut} tok · `
                      : ""}
                    {stamp(r.startedAt, locale)}
                  </span>
                </Link>
              ))}
            </Card>
          )}
        </section>

        <div className="flex flex-col gap-6">
          <Card className="px-5 py-4">
            <p className="mb-3 font-mono text-[10px] tracking-label text-ink-faint uppercase">
              {t("spec")}
            </p>
            <dl className="flex flex-col gap-2 text-[12.5px]">
              <div className="flex justify-between gap-3">
                <dt className="font-mono text-[11px] text-ink-faint">{t("trigger")}</dt>
                <dd className="font-mono text-ink">
                  {spec.trigger?.type ?? "manual"}
                  {spec.trigger?.schedule ? ` · ${spec.trigger.schedule}` : ""}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="font-mono text-[11px] text-ink-faint">{t("approval")}</dt>
                <dd className="font-mono text-ink">
                  {spec.approval?.before_act ?? "none"}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="font-mono text-[11px] text-ink-faint">{t("actions")}</dt>
                <dd className="font-mono text-ink">
                  {(spec.act ?? []).map((a) => a.type).join(", ") || "—"}
                </dd>
              </div>
            </dl>
          </Card>

          <Card className="px-5 py-4">
            <p className="mb-3 font-mono text-[10px] tracking-label text-ink-faint uppercase">
              {t("pipeline")}
            </p>
            <ol className="flex flex-col">
              {(spec.steps ?? []).map((s, i) => (
                <li key={s.id ?? i} className="flex items-center gap-3 py-2">
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full border border-line font-mono text-[9.5px] text-ink-faint">
                    {i + 1}
                  </span>
                  <span className="font-mono text-[12px] font-medium text-ink">
                    {s.id}
                  </span>
                  <span className="ml-auto font-mono text-[10.5px] text-ink-faint">
                    {s.kind}
                    {s.tool ? ` · ${s.tool}` : ""}
                    {s.model ? ` · ${s.model}` : ""}
                  </span>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>
    </div>
  );
}
