export const dynamic = "force-dynamic";
import { useTranslations } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { desc, eq } from "drizzle-orm";
import { schema, withOrg } from "@aigtm/db";
import { Link } from "../../../../i18n/routing";
import { ReviewPanel } from "../_components/review-panel";
import { ensureDb } from "../../../../lib/db";
import { requireSession } from "../../../../lib/session";
import { decideApprovalAction } from "../../../../lib/actions";
import {
  PageHeader,
  Chip,
  Card,
  EmptyState,
  statusTone,
  timeAgo,
} from "../_components/ui";

interface ApprovalRow {
  id: string;
  status: string;
  reason: string | null;
  createdAt: Date | string;
  decidedAt: Date | string | null;
  payload: {
    agent?: string;
    action?: string;
    preview?: Record<string, unknown>;
  } | null;
  outboxPayload: {
    from?: string;
    to?: string;
    subject?: string;
    body?: string;
    title?: string;
    context?: Record<string, unknown>;
  } | null;
}

export default async function ApprovalsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ selected?: string }>;
}) {
  const { locale } = await params;
  const { selected } = await searchParams;
  setRequestLocale(locale);
  const session = await requireSession(locale);
  const handle = await ensureDb();

  const rows = (await withOrg(
    handle,
    { orgId: session.orgId, userId: session.userId },
    (tx) =>
      tx
        .select({
          id: schema.approvals.id,
          status: schema.approvals.status,
          reason: schema.approvals.reason,
          createdAt: schema.approvals.createdAt,
          decidedAt: schema.approvals.decidedAt,
          payload: schema.approvals.payload,
          outboxPayload: schema.outbox.payload,
        })
        .from(schema.approvals)
        .leftJoin(schema.outbox, eq(schema.approvals.outboxId, schema.outbox.id))
        .orderBy(desc(schema.approvals.createdAt))
        .limit(100),
  )) as ApprovalRow[];

  const current =
    rows.find((r) => r.id === selected) ??
    rows.find((r) => r.status === "pending") ??
    rows[0] ??
    null;

  return <ReviewView locale={locale} rows={rows} current={current} />;
}

function ReviewView({
  locale,
  rows,
  current,
}: {
  locale: string;
  rows: ApprovalRow[];
  current: ApprovalRow | null;
}) {
  const t = useTranslations("approvals");

  const byAgent = new Map<string, ApprovalRow[]>();
  for (const r of rows) {
    const k = r.payload?.agent ?? t("other");
    byAgent.set(k, [...(byAgent.get(k) ?? []), r]);
  }

  return (
    <div>
      <PageHeader
        eyebrow={t("eyebrow")}
        title={t("title")}
        meta={t("totalCount", { count: rows.filter((r) => r.status === "pending").length })}
      />

      {rows.length === 0 ? (
        <EmptyState label={t("empty")} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
          <div className="flex flex-col gap-5">
            {[...byAgent.entries()].map(([agent, items]) => (
              <div key={agent}>
                <p className="mb-2 px-1 font-mono text-[10px] tracking-label text-ink-faint uppercase">
                  {agent}
                </p>
                <ul className="flex flex-col gap-1.5">
                  {items.map((r) => {
                    const active = current?.id === r.id;
                    return (
                      <li key={r.id}>
                        <Link
                          href={`/approvals?selected=${r.id}`}
                          scroll={false}
                          className={`block rounded-lg border px-3.5 py-2.5 transition-colors ${
                            active
                              ? "border-line bg-card shadow-card"
                              : "border-transparent hover:border-line hover:bg-card/70"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate text-[13px] font-medium text-ink">
                              {r.payload?.action}
                            </span>
                            <Chip tone={statusTone(r.status)} dot>
                              {r.status}
                            </Chip>
                          </div>
                          <p className="mt-0.5 font-mono text-[10.5px] text-ink-faint">
                            {timeAgo(r.createdAt, locale)}
                          </p>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>

          <div>{current ? <Detail locale={locale} row={current} /> : null}</div>
        </div>
      )}
    </div>
  );
}

function Detail({ locale, row }: { locale: string; row: ApprovalRow }) {
  const t = useTranslations("approvals");
  const preview = row.payload?.preview ?? {};
  const draft = row.outboxPayload;
  const pending = row.status === "pending";
  return (
    <div className="flex flex-col gap-4">
      <Card className="px-5 py-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] tracking-label text-ink-faint uppercase">
              {row.payload?.agent}
            </p>
            <h2 className="mt-1 text-[17px] font-semibold text-forest-deep">
              {row.payload?.action}
            </h2>
          </div>
          <Chip tone={statusTone(row.status)} dot>
            {row.status}
          </Chip>
        </div>
        {Object.keys(preview).length > 0 ? (
          <div className="mt-4 border-t border-line-soft pt-3">
            <p className="mb-2 font-mono text-[10px] tracking-label text-ink-faint uppercase">
              {t("rationale")}
            </p>
            <dl className="flex flex-col gap-1.5">
              {Object.entries(preview).map(([k, v]) => (
                <div key={k} className="flex items-baseline gap-3">
                  <dt className="w-28 shrink-0 font-mono text-[11px] text-ink-soft">
                    {k}
                  </dt>
                  <dd className="min-w-0 truncate text-[12.5px] text-ink">
                    {summarize(v)}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        ) : null}
      </Card>

      {pending ? (
        <ReviewPanel
          approvalId={row.id}
          draft={draft}
          decideAction={decideApprovalAction.bind(null, locale)}
        />
      ) : (
        <div className="font-mono text-[11px] text-ink-faint">
          <p>
            {t("decidedAt")} {row.decidedAt ? timeAgo(row.decidedAt, locale) : "—"}
          </p>
          {row.reason ? (
            <p className="mt-1.5 text-ink-soft">
              {t("reasonLabel")} {row.reason}
            </p>
          ) : null}
        </div>
      )}

      {!pending && (draft?.subject || draft?.body || draft?.title) ? (
        <Card className="px-5 py-4">
          <p className="mb-3 font-mono text-[10px] tracking-label text-ink-faint uppercase">
            {t("draft")}
          </p>
          {draft.subject || draft.title ? (
            <p className="text-[13px] font-medium text-ink">
              {draft.subject ?? draft.title}
            </p>
          ) : null}
          {draft.body ? (
            <p className="mt-2 text-[13.5px] leading-relaxed whitespace-pre-wrap text-ink-soft">
              {draft.body}
            </p>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}

function summarize(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map(summarize).join(", ");
  if (typeof v === "object") {
    return Object.entries(v as Record<string, unknown>)
      .map(([k, val]) => `${k}: ${summarize(val)}`)
      .join(" · ");
  }
  return String(v);
}
