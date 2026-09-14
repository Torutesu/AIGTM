export const dynamic = "force-dynamic";
import { useTranslations } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { desc } from "drizzle-orm";
import { schema, withOrg } from "@aigtm/db";
import { ensureDb } from "../../../../lib/db";
import { requireSession } from "../../../../lib/session";
import { PageHeader, Chip, Card, EmptyState, statusTone, stamp } from "../_components/ui";

interface ApprovalRow {
  id: string;
  status: string;
  createdAt: Date | string;
  payload: { agent?: string; action?: string } | null;
}

export default async function ApprovalsPage({
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
        .select()
        .from(schema.approvals)
        .orderBy(desc(schema.approvals.createdAt))
        .limit(100),
  )) as ApprovalRow[];

  return <ApprovalsView locale={locale} rows={rows} />;
}

function ApprovalsView({ locale, rows }: { locale: string; rows: ApprovalRow[] }) {
  const t = useTranslations("approvals");
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
                  {t("action")}
                </th>
                <th className="px-5 py-3 font-mono text-[10.5px] font-medium tracking-label text-ink-faint uppercase">
                  {t("decision")}
                </th>
                <th className="px-5 py-3 font-mono text-[10.5px] font-medium tracking-label text-ink-faint uppercase">
                  {t("time")}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-line-soft last:border-0">
                  <td className="px-5 py-3">
                    <span className="text-[13.5px] font-medium text-ink">
                      {row.payload?.agent}
                    </span>
                    <span className="mx-2 text-line">·</span>
                    <span className="font-mono text-[12px] text-ink-soft">
                      {row.payload?.action}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    <Chip tone={statusTone(row.status)} dot>
                      {row.status}
                    </Chip>
                  </td>
                  <td className="px-5 py-3 font-mono text-[12px] text-ink-soft">
                    {stamp(row.createdAt, locale)}
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
