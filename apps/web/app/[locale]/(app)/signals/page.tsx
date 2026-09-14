export const dynamic = "force-dynamic";
import { useTranslations } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { desc, eq, sql } from "drizzle-orm";
import { schema, withOrg } from "@aigtm/db";
import { ensureDb } from "../../../../lib/db";
import { requireSession } from "../../../../lib/session";
import {
  PageHeader,
  Chip,
  Card,
  EmptyState,
  ScoreBar,
  timeAgo,
} from "../_components/ui";
import { Link } from "../../../../i18n/routing";

interface SignalRow {
  id: string;
  name: string;
  enabled: boolean;
  spec: { description?: string; sources?: { type?: string }[] } | null;
}
interface EventRow {
  id: string;
  score: string | null;
  detectedAt: Date | string;
  evidence: { excerpt?: string } | null;
  signalName: string | null;
  accountName: string | null;
  accountId: string | null;
}

export default async function SignalsPage({
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
      const signalRows = (await tx
        .select()
        .from(schema.signals)
        .where(eq(schema.signals.enabled, true))) as SignalRow[];
      const counts = (await tx
        .select({
          signalId: schema.signalEvents.signalId,
          count: sql<number>`count(*)::int`,
        })
        .from(schema.signalEvents)
        .groupBy(schema.signalEvents.signalId)) as { signalId: string | null; count: number }[];
      const eventRows = (await tx
        .select({
          id: schema.signalEvents.id,
          score: schema.signalEvents.score,
          detectedAt: schema.signalEvents.detectedAt,
          evidence: schema.signalEvents.evidence,
          signalName: schema.signals.name,
          accountName: schema.accounts.name,
          accountId: schema.signalEvents.accountId,
        })
        .from(schema.signalEvents)
        .leftJoin(schema.signals, eq(schema.signalEvents.signalId, schema.signals.id))
        .leftJoin(schema.accounts, eq(schema.signalEvents.accountId, schema.accounts.id))
        .orderBy(desc(schema.signalEvents.detectedAt))
        .limit(30)) as EventRow[];
      const countBySignal = new Map(counts.map((c) => [c.signalId, c.count]));
      return { signalRows, eventRows, countBySignal };
    },
  );

  return (
    <SignalsView
      locale={locale}
      signals={data.signalRows}
      events={data.eventRows}
      countBySignal={Object.fromEntries(data.countBySignal)}
    />
  );
}

function SignalsView({
  locale,
  signals,
  events,
  countBySignal,
}: {
  locale: string;
  signals: SignalRow[];
  events: EventRow[];
  countBySignal: Record<string, number>;
}) {
  const t = useTranslations("signals");
  return (
    <div>
      <PageHeader
        eyebrow={t("eyebrow")}
        title={t("title")}
        meta={t("totalCount", { count: signals.length })}
      />

      <section className="mb-10">
        <h2 className="mb-3 font-mono text-[11px] tracking-label text-ink-soft uppercase">
          {t("definitions")}
        </h2>
        {signals.length === 0 ? (
          <EmptyState label={t("empty")} />
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2">
            {signals.map((s) => (
              <li key={s.id} data-testid="signal-def">
                <Card className="p-5">
                  <div className="flex items-center justify-between gap-3">
                    <p className="truncate text-[14.5px] font-semibold text-ink">{s.name}</p>
                    <Chip tone="live" dot>
                      {t("watching")}
                    </Chip>
                  </div>
                  <p className="mt-1.5 line-clamp-2 text-[13px] leading-relaxed text-ink-soft">
                    {s.spec?.description}
                  </p>
                  <p className="mt-3 border-t border-line-soft pt-3 font-mono text-[11px] text-ink-faint">
                    {(s.spec?.sources ?? []).map((src) => src.type).join(", ") || "—"}
                    <span className="mx-2 text-line">·</span>
                    {countBySignal[s.id] ?? 0} {t("hits")}
                  </p>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 font-mono text-[11px] tracking-label text-ink-soft uppercase">
          {t("feed")}
        </h2>
        {events.length === 0 ? (
          <EmptyState label={t("noEvents")} />
        ) : (
          <Card className="divide-y divide-line-soft">
            {events.map((ev) => (
              <div key={ev.id} className="flex items-center gap-4 px-5 py-3.5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2.5">
                    <span className="text-[13.5px] font-medium text-ink">{ev.signalName}</span>
                    {ev.accountId ? (
                      <Link
                        href={`/accounts/${ev.accountId}`}
                        className="font-mono text-[11px] text-ink-soft hover:text-forest-deep"
                      >
                        {ev.accountName}
                      </Link>
                    ) : null}
                  </div>
                  {ev.evidence?.excerpt ? (
                    <p className="mt-0.5 truncate text-[12.5px] text-ink-soft">
                      {ev.evidence.excerpt}
                    </p>
                  ) : null}
                </div>
                <ScoreBar score={ev.score} />
                <span className="w-20 shrink-0 text-right font-mono text-[11px] text-ink-faint">
                  {timeAgo(ev.detectedAt, locale)}
                </span>
              </div>
            ))}
          </Card>
        )}
      </section>
    </div>
  );
}
