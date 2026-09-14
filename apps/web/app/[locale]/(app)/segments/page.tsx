export const dynamic = "force-dynamic";
import { useTranslations } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { desc } from "drizzle-orm";
import { schema, withOrg } from "@aigtm/db";
import { Link } from "../../../../i18n/routing";
import { ensureDb } from "../../../../lib/db";
import { requireSession } from "../../../../lib/session";
import {
  createSegmentAction,
  updateSegmentAction,
  deleteSegmentAction,
} from "../../../../lib/actions";
import {
  PageHeader,
  Chip,
  Card,
  EmptyState,
} from "../_components/ui";

interface SegmentRow {
  id: string;
  name: string;
  filter: { minScore?: number; stage?: string; industry?: string };
  createdAt: Date | string;
}
interface AccountLite {
  id: string;
  name: string;
  icpFitScore: string | null;
  stage: string;
  industry: string | null;
}

function matches(f: SegmentRow["filter"], a: AccountLite): boolean {
  if (f.minScore != null && Number(a.icpFitScore ?? 0) < f.minScore) return false;
  if (f.stage && a.stage !== f.stage) return false;
  if (
    f.industry &&
    !(a.industry ?? "").toLowerCase().includes(f.industry.toLowerCase())
  )
    return false;
  return true;
}

const STAGES = ["prospect", "opportunity", "customer"];

export default async function SegmentsPage({
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
      const segs = (await tx
        .select()
        .from(schema.segments)
        .orderBy(desc(schema.segments.createdAt))) as SegmentRow[];
      const accounts = (await tx
        .select({
          id: schema.accounts.id,
          name: schema.accounts.name,
          icpFitScore: schema.accounts.icpFitScore,
          stage: schema.accounts.stage,
          industry: schema.accounts.industry,
        })
        .from(schema.accounts)) as AccountLite[];
      return { segs, accounts };
    },
  );

  return (
    <SegmentsView
      locale={locale}
      segments={data.segs}
      accounts={data.accounts}
      canAct={session.role !== "viewer"}
    />
  );
}

function FilterFields({
  t,
  seg,
}: {
  t: ReturnType<typeof useTranslations>;
  seg?: SegmentRow;
}) {
  return (
    <>
      <label className="flex flex-col gap-1">
        <span className="font-mono text-[10px] text-ink-faint">{t("name")}</span>
        <input
          name="name"
          required
          defaultValue={seg?.name}
          placeholder={t("namePlaceholder")}
          className="w-48 rounded-lg border border-line bg-paper px-3 py-2 text-[13px] text-ink outline-none placeholder:text-ink-faint focus:border-forest"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="font-mono text-[10px] text-ink-faint">{t("minScore")}</span>
        <input
          name="minScore"
          type="number"
          min={0}
          max={100}
          defaultValue={seg?.filter.minScore ?? ""}
          placeholder="0–100"
          className="w-24 rounded-lg border border-line bg-paper px-3 py-2 text-[13px] text-ink outline-none placeholder:text-ink-faint focus:border-forest"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="font-mono text-[10px] text-ink-faint">{t("stage")}</span>
        <select
          name="stage"
          defaultValue={seg?.filter.stage ?? ""}
          className="w-32 rounded-lg border border-line bg-paper px-2.5 py-2 text-[13px] text-ink outline-none focus:border-forest"
        >
          <option value="">{t("any")}</option>
          {STAGES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="font-mono text-[10px] text-ink-faint">{t("industry")}</span>
        <input
          name="industry"
          defaultValue={seg?.filter.industry ?? ""}
          placeholder={t("industryPlaceholder")}
          className="w-36 rounded-lg border border-line bg-paper px-3 py-2 text-[13px] text-ink outline-none placeholder:text-ink-faint focus:border-forest"
        />
      </label>
    </>
  );
}

function SegmentsView({
  locale,
  segments,
  accounts,
  canAct,
}: {
  locale: string;
  segments: SegmentRow[];
  accounts: AccountLite[];
  canAct: boolean;
}) {
  const t = useTranslations("segments");
  return (
    <div>
      <PageHeader
        eyebrow={t("eyebrow")}
        title={t("title")}
        meta={t("totalCount", { count: segments.length })}
      />

      {canAct ? (
        <Card className="mb-8 px-5 py-4">
          <p className="mb-3 font-mono text-[10px] tracking-label text-ink-faint uppercase">
            {t("new")}
          </p>
          <form
            action={createSegmentAction.bind(null, locale)}
            className="flex flex-wrap items-end gap-3"
          >
            <FilterFields t={t} />
            <button
              type="submit"
              className="rounded-lg bg-forest px-4 py-2 font-mono text-[11px] tracking-[0.06em] text-white uppercase hover:bg-forest-deep"
            >
              {t("create")}
            </button>
          </form>
        </Card>
      ) : null}

      {segments.length === 0 ? (
        <EmptyState label={t("empty")} hint={t("emptyHint")} />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {segments.map((s) => {
            const members = accounts.filter((a) => matches(s.filter, a));
            return (
              <li key={s.id} data-testid="segment-card">
                <Card className="p-5">
                  <div className="flex items-center justify-between gap-3">
                    <p className="truncate text-[14.5px] font-semibold text-ink">
                      {s.name}
                    </p>
                    <Chip tone="info">{t("members", { count: members.length })}</Chip>
                  </div>
                  <p className="mt-2 font-mono text-[11px] text-ink-faint">
                    {[
                      s.filter.minScore != null ? `score ≥ ${s.filter.minScore}` : null,
                      s.filter.stage ? `stage: ${s.filter.stage}` : null,
                      s.filter.industry ? `industry ~ ${s.filter.industry}` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ") || t("noFilter")}
                  </p>
                  {members.length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-1.5 border-t border-line-soft pt-3">
                      {members.slice(0, 6).map((m) => (
                        <Link
                          key={m.id}
                          href={`/accounts/${m.id}`}
                          className="rounded-md border border-line bg-paper px-2 py-0.5 font-mono text-[10.5px] text-ink-soft hover:text-forest-deep"
                        >
                          {m.name}
                        </Link>
                      ))}
                      {members.length > 6 ? (
                        <span className="px-1 font-mono text-[10.5px] text-ink-faint">
                          +{members.length - 6}
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                  {canAct ? (
                    <div className="mt-3 flex gap-2 border-t border-line-soft pt-3">
                      <details className="group flex-1">
                        <summary className="w-fit cursor-pointer list-none rounded-md border border-line px-2.5 py-1 font-mono text-[10.5px] tracking-[0.04em] text-ink-soft uppercase hover:border-ink-faint">
                          {t("edit")}
                        </summary>
                        <form
                          action={updateSegmentAction.bind(null, locale)}
                          className="mt-3 flex flex-wrap items-end gap-3"
                        >
                          <input type="hidden" name="segmentId" value={s.id} />
                          <FilterFields t={t} seg={s} />
                          <button
                            type="submit"
                            className="rounded-lg bg-forest px-3.5 py-2 font-mono text-[11px] tracking-[0.06em] text-white uppercase hover:bg-forest-deep"
                          >
                            {t("save")}
                          </button>
                        </form>
                      </details>
                      <details className="group ml-auto">
                        <summary className="cursor-pointer list-none rounded-md border border-line px-2.5 py-1 font-mono text-[10.5px] tracking-[0.04em] text-red-ink uppercase hover:border-red-ink/40">
                          {t("delete")}
                        </summary>
                        <form
                          action={deleteSegmentAction.bind(null, locale)}
                          className="mt-2 flex items-center gap-2"
                        >
                          <input type="hidden" name="segmentId" value={s.id} />
                          <span className="font-mono text-[10.5px] text-ink-faint">
                            {t("deleteConfirm")}
                          </span>
                          <button
                            type="submit"
                            className="rounded-md bg-red-ink px-2.5 py-1 font-mono text-[10.5px] tracking-[0.04em] text-white uppercase"
                          >
                            {t("delete")}
                          </button>
                        </form>
                      </details>
                    </div>
                  ) : null}
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
