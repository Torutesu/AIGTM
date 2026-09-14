export const dynamic = "force-dynamic";
import { useTranslations } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { eq, asc } from "drizzle-orm";
import { notFound } from "next/navigation";
import { schema, withOrg } from "@aigtm/db";
import { ensureDb } from "../../../../../lib/db";
import { requireSession } from "../../../../../lib/session";
import { Chip, Card, statusTone, stamp } from "../../_components/ui";
import { Link } from "../../../../../i18n/routing";
import { retryRunAction, cancelRunAction } from "../../../../../lib/actions";
import { PlayIcon, XIcon } from "../../_components/icons";

interface RunRow {
  id: string;
  status: string;
  triggerKind: string;
  startedAt: Date | string;
  finishedAt: Date | string | null;
  tokensIn: number;
  tokensOut: number;
  error: string | null;
  agentName: string | null;
  agentId: string;
}
interface StepRow {
  id: string;
  stepId: string;
  kind: string;
  model: string | null;
  tool: string | null;
  output: unknown;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  status: string;
  error: string | null;
}

export default async function RunDetailPage({
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
      const [run] = (await tx
        .select({
          id: schema.runs.id,
          status: schema.runs.status,
          triggerKind: schema.runs.triggerKind,
          startedAt: schema.runs.startedAt,
          finishedAt: schema.runs.finishedAt,
          tokensIn: schema.runs.tokensIn,
          tokensOut: schema.runs.tokensOut,
          error: schema.runs.error,
          agentName: schema.agents.name,
          agentId: schema.runs.agentId,
        })
        .from(schema.runs)
        .leftJoin(schema.agents, eq(schema.runs.agentId, schema.agents.id))
        .where(eq(schema.runs.id, id))
        .limit(1)) as RunRow[];
      if (!run) return null;
      const steps = (await tx
        .select()
        .from(schema.runSteps)
        .where(eq(schema.runSteps.runId, id))
        .orderBy(asc(schema.runSteps.createdAt))) as StepRow[];
      return { run, steps };
    },
  );

  if (!data) notFound();
  return (
    <RunView
      locale={locale}
      canAct={session.role !== "viewer"}
      {...data}
    />
  );
}

function summarizeOutput(output: unknown): string {
  if (output == null) return "";
  if (typeof output === "string") return output;
  try {
    const s = JSON.stringify(output);
    return s.length > 220 ? `${s.slice(0, 220)}…` : s;
  } catch {
    return String(output);
  }
}

function RunView({
  locale,
  run,
  steps,
  canAct,
}: {
  locale: string;
  run: RunRow;
  steps: StepRow[];
  canAct: boolean;
}) {
  const t = useTranslations("run");
  return (
    <div>
      <header className="mb-8">
        <p className="font-mono text-[11px] tracking-label text-ink-faint uppercase">
          {t("eyebrow")}
        </p>
        <div className="mt-2 flex items-center gap-3">
          <h1 className="text-[26px] leading-tight font-semibold tracking-tight text-forest-deep">
            <Link
              href={`/agents/${run.agentId}`}
              className="hover:text-forest"
            >
              {run.agentName}
            </Link>
          </h1>
          <Chip tone={statusTone(run.status)} dot>
            {run.status}
          </Chip>
          {canAct && run.status === "rejected" ? (
            <form action={retryRunAction.bind(null, locale)} className="ml-auto">
              <input type="hidden" name="runId" value={run.id} />
              <button
                type="submit"
                className="flex items-center gap-1.5 rounded-lg bg-forest px-4 py-2 font-mono text-[11px] tracking-[0.06em] text-white uppercase hover:bg-forest-deep"
              >
                <PlayIcon size={11} strokeWidth={2.4} />
                {t("retry")}
              </button>
            </form>
          ) : null}
          {canAct && run.status === "running" ? (
            <form action={cancelRunAction.bind(null, locale)} className="ml-auto">
              <input type="hidden" name="runId" value={run.id} />
              <button
                type="submit"
                className="flex items-center gap-1.5 rounded-lg border border-line bg-card px-4 py-2 font-mono text-[11px] tracking-[0.06em] text-ink-soft uppercase hover:border-ink-faint"
              >
                <XIcon size={11} strokeWidth={2.2} />
                {t("cancel")}
              </button>
            </form>
          ) : null}
        </div>
        <p className="mt-1.5 font-mono text-[12px] text-ink-faint">
          {run.triggerKind} · {stamp(run.startedAt, locale)}
          {run.tokensIn + run.tokensOut > 0
            ? ` · ${run.tokensIn + run.tokensOut} tok`
            : ""}
        </p>
        {run.error ? (
          <p className="mt-2 rounded-lg border border-red-soft bg-red-soft/40 px-3 py-2 font-mono text-[12px] text-red-ink">
            {run.error}
          </p>
        ) : null}
      </header>

      <section>
        <h2 className="mb-3 font-mono text-[11px] tracking-label text-ink-soft uppercase">
          {t("steps")}
        </h2>
        <Card className="px-5 py-2">
          <ol className="flex flex-col">
            {steps.map((s, i) => (
              <li
                key={s.id}
                data-testid="run-step"
                className="relative flex gap-4 border-l border-line py-4 pl-6 first:pt-5 last:pb-5"
              >
                <span
                  className={`absolute top-5 -left-[5px] size-2.5 rounded-full border-2 border-card ${
                    s.status === "fulfilled" ? "bg-forest" : "bg-red-ink"
                  }`}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2.5">
                    <span className="font-mono text-[12.5px] font-semibold text-ink">
                      {i + 1}. {s.stepId}
                    </span>
                    <Chip tone="neutral">{s.kind}</Chip>
                    {s.tool ? <Chip tone="info">{s.tool}</Chip> : null}
                    {s.model ? <Chip tone="neutral">{s.model}</Chip> : null}
                    <span className="ml-auto font-mono text-[10.5px] text-ink-faint">
                      {s.latencyMs}ms
                      {s.tokensIn + s.tokensOut > 0
                        ? ` · ${s.tokensIn + s.tokensOut} tok`
                        : ""}
                    </span>
                  </div>
                  {s.output != null ? (
                    <p className="mt-1.5 rounded-md bg-paper px-3 py-2 font-mono text-[11.5px] leading-relaxed break-all text-ink-soft">
                      {summarizeOutput(s.output)}
                    </p>
                  ) : null}
                  {s.error ? (
                    <p className="mt-1.5 font-mono text-[11.5px] text-red-ink">
                      {s.error}
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
            {steps.length === 0 ? (
              <li className="py-8 text-center font-mono text-[11px] text-ink-faint">
                —
              </li>
            ) : null}
          </ol>
        </Card>
      </section>
    </div>
  );
}
