export const dynamic = "force-dynamic";
import { useTranslations } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { asc, eq } from "drizzle-orm";
import { schema, withOrg } from "@aigtm/db";
import { Link } from "../../../../i18n/routing";
import { ensureDb } from "../../../../lib/db";
import { requireSession } from "../../../../lib/session";
import {
  PageHeader,
  Chip,
  Card,
  EmptyState,
  stamp,
  type ChipTone,
} from "../_components/ui";

interface DealRow {
  id: string;
  name: string;
  stage: string;
  amount: string | null;
  lastActivityAt: Date | string | null;
  accountName: string | null;
  accountId: string | null;
}

export default async function DealsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await requireSession(locale);
  const handle = await ensureDb();

  const rows = (await withOrg(
    handle,
    { orgId: session.orgId, userId: session.userId },
    (tx) =>
      tx
        .select({
          id: schema.deals.id,
          name: schema.deals.name,
          stage: schema.deals.stage,
          amount: schema.deals.amount,
          lastActivityAt: schema.deals.lastActivityAt,
          accountName: schema.accounts.name,
          accountId: schema.deals.accountId,
        })
        .from(schema.deals)
        .leftJoin(schema.accounts, eq(schema.deals.accountId, schema.accounts.id))
        .orderBy(asc(schema.deals.stage))
        .limit(100),
  )) as DealRow[];

  return <DealsView locale={locale} rows={rows} />;
}

function stageTone(stage: string): ChipTone {
  if (stage === "won" || stage === "closed_won") return "good";
  if (stage === "lost" || stage === "closed_lost") return "bad";
  if (stage === "negotiation") return "pending";
  return "info";
}

function DealsView({ locale, rows }: { locale: string; rows: DealRow[] }) {
  const t = useTranslations("deals");
  return (
    <div>
      <PageHeader
        eyebrow={t("eyebrow")}
        title={t("title")}
        meta={t("totalCount", { count: rows.length })}
      />
      {rows.length === 0 ? (
        <EmptyState label={t("empty")} />
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left">
                <th className="px-5 py-3 font-mono text-[10.5px] font-medium tracking-label text-ink-faint uppercase">
                  {t("deal")}
                </th>
                <th className="px-4 py-3 font-mono text-[10.5px] font-medium tracking-label text-ink-faint uppercase">
                  {t("account")}
                </th>
                <th className="px-4 py-3 font-mono text-[10.5px] font-medium tracking-label text-ink-faint uppercase">
                  {t("stage")}
                </th>
                <th className="px-4 py-3 text-right font-mono text-[10.5px] font-medium tracking-label text-ink-faint uppercase">
                  {t("amount")}
                </th>
                <th className="px-5 py-3 font-mono text-[10.5px] font-medium tracking-label text-ink-faint uppercase">
                  {t("lastActivity")}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.id} className="border-b border-line-soft last:border-0 hover:bg-paper/60">
                  <td className="px-5 py-3 text-[13.5px] font-medium text-ink">{d.name}</td>
                  <td className="px-4 py-3">
                    {d.accountId ? (
                      <Link
                        href={`/accounts/${d.accountId}`}
                        className="text-[13px] text-ink-soft hover:text-forest-deep"
                      >
                        {d.accountName}
                      </Link>
                    ) : (
                      d.accountName
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Chip tone={stageTone(d.stage)}>{d.stage}</Chip>
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-[12px] text-ink tabular-nums">
                    {d.amount ? `$${Number(d.amount).toLocaleString()}` : "—"}
                  </td>
                  <td className="px-5 py-3 font-mono text-[12px] text-ink-soft">
                    {d.lastActivityAt ? stamp(d.lastActivityAt, locale) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
