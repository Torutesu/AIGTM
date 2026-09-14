export const dynamic = "force-dynamic";
import { useTranslations } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { desc, eq } from "drizzle-orm";
import { schema, withOrg } from "@aigtm/db";
import { CheckIcon, XIcon } from "../_components/icons";
import { ensureDb } from "../../../../lib/db";
import { requireSession } from "../../../../lib/session";
import { decideApprovalAction } from "../../../../lib/actions";
import { PageHeader, Chip, Card, EmptyState, ScoreBar, timeAgo } from "../_components/ui";

interface ApprovalRow {
  id: string;
  kind: string;
  status: string;
  createdAt: Date | string;
  payload: { agent?: string; action?: string; preview?: Record<string, unknown> } | null;
}

interface SignalEventRow {
  id: string;
  score: number | null;
  detectedAt: Date | string;
  evidence: { excerpt?: string } | null;
  signalName: string | null;
  accountName: string | null;
}

export default async function InboxPage({
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
      const pending = (await tx
        .select()
        .from(schema.approvals)
        .where(eq(schema.approvals.status, "pending"))
        .orderBy(desc(schema.approvals.createdAt))
        .limit(50)) as ApprovalRow[];
      const events = (await tx
        .select({
          id: schema.signalEvents.id,
          score: schema.signalEvents.score,
          detectedAt: schema.signalEvents.detectedAt,
          evidence: schema.signalEvents.evidence,
          signalName: schema.signals.name,
          accountName: schema.accounts.name,
        })
        .from(schema.signalEvents)
        .leftJoin(schema.signals, eq(schema.signalEvents.signalId, schema.signals.id))
        .leftJoin(schema.accounts, eq(schema.signalEvents.accountId, schema.accounts.id))
        .orderBy(desc(schema.signalEvents.detectedAt))
        .limit(20)) as SignalEventRow[];
      return { pending, events };
    },
  );

  return <InboxView locale={locale} pending={data.pending} events={data.events} />;
}

function InboxView({
  locale,
  pending,
  events,
}: {
  locale: string;
  pending: ApprovalRow[];
  events: SignalEventRow[];
}) {
  const t = useTranslations("inbox");
  return (
    <div>
      <PageHeader
        eyebrow={t("eyebrow")}
        title={t("title")}
        meta={t("pendingCount", { count: pending.length })}
      />

      <section className="mb-10">
        <h2 className="mb-3 font-mono text-[11px] tracking-label text-ink-soft uppercase">
          {t("pendingApprovals")}
        </h2>
        {pending.length === 0 ? (
          <EmptyState label={t("empty")} />
        ) : (
          <ul className="flex flex-col gap-3">
            {pending.map((ap) => {
              const steps = ap.payload?.preview ? Object.keys(ap.payload.preview) : [];
              return (
                <li key={ap.id} data-testid="approval-item">
                  <Card className="px-5 py-4">
                    <div className="flex items-start justify-between gap-6">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2.5">
                          <span className="truncate text-[15px] font-semibold text-ink">
                            {ap.payload?.agent ?? "agent"}
                          </span>
                          <Chip tone="pending" dot>
                            {t("review")}
                          </Chip>
                        </div>
                        <p className="mt-1 font-mono text-[12px] text-ink-soft">
                          {ap.payload?.action}
                          <span className="mx-2 text-line">·</span>
                          {timeAgo(ap.createdAt, locale)}
                        </p>
                        {steps.length > 0 ? (
                          <div className="mt-3 flex flex-wrap gap-1.5">
                            {steps.map((s) => (
                              <span
                                key={s}
                                className="rounded-md border border-line bg-paper px-2 py-0.5 font-mono text-[10.5px] text-ink-soft"
                              >
                                {s}
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </div>
                      <div className="flex shrink-0 gap-2">
                        <form action={decideApprovalAction.bind(null, locale)}>
                          <input type="hidden" name="approvalId" value={ap.id} />
                          <input type="hidden" name="decision" value="approved" />
                          <button
                            type="submit"
                            data-testid="approve-button"
                            className="flex items-center gap-1.5 rounded-lg bg-forest px-4 py-2 font-mono text-[11px] tracking-[0.06em] text-white uppercase transition-colors hover:bg-forest-deep"
                          >
                            <CheckIcon size={13} strokeWidth={2.2} />
                            {t("approve")}
                          </button>
                        </form>
                        <form action={decideApprovalAction.bind(null, locale)}>
                          <input type="hidden" name="approvalId" value={ap.id} />
                          <input type="hidden" name="decision" value="rejected" />
                          <button
                            type="submit"
                            className="flex items-center gap-1.5 rounded-lg border border-line bg-card px-4 py-2 font-mono text-[11px] tracking-[0.06em] text-ink-soft uppercase transition-colors hover:border-ink-faint hover:text-ink"
                          >
                            <XIcon size={13} strokeWidth={2.2} />
                            {t("reject")}
                          </button>
                        </form>
                      </div>
                    </div>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 font-mono text-[11px] tracking-label text-ink-soft uppercase">
          {t("recentSignals")}
        </h2>
        {events.length === 0 ? (
          <EmptyState label={t("noSignals")} />
        ) : (
          <ul className="flex flex-col gap-3">
            {events.map((ev) => (
              <li key={ev.id} data-testid="signal-event">
                <Card className="px-5 py-4">
                  <div className="flex items-center justify-between gap-4">
                    <span className="truncate text-[14.5px] font-semibold text-ink">
                      {ev.signalName}
                    </span>
                    <div className="flex shrink-0 items-center gap-3">
                      <ScoreBar score={ev.score} />
                      <span className="font-mono text-[11px] text-ink-faint">
                        {ev.accountName}
                        <span className="mx-2 text-line">·</span>
                        {timeAgo(ev.detectedAt, locale)}
                      </span>
                    </div>
                  </div>
                  {ev.evidence?.excerpt ? (
                    <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-soft">
                      {ev.evidence.excerpt}
                    </p>
                  ) : null}
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
