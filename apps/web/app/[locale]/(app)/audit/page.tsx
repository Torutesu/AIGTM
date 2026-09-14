export const dynamic = "force-dynamic";
import { useTranslations } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { desc } from "drizzle-orm";
import { schema, withOrg } from "@aigtm/db";
import { ensureDb } from "../../../../lib/db";
import { requireSession } from "../../../../lib/session";
import { PageHeader, Card, EmptyState, stamp } from "../_components/ui";

interface AuditRow {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  actorType: string;
  actorId: string;
  createdAt: Date | string;
}

export default async function AuditPage({
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
        .from(schema.auditEvents)
        .orderBy(desc(schema.auditEvents.createdAt))
        .limit(200),
  )) as AuditRow[];

  return <AuditView locale={locale} rows={rows} />;
}

function AuditView({ locale, rows }: { locale: string; rows: AuditRow[] }) {
  const t = useTranslations("audit");
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
                  {t("entity")}
                </th>
                <th className="px-5 py-3 font-mono text-[10.5px] font-medium tracking-label text-ink-faint uppercase">
                  {t("actor")}
                </th>
                <th className="px-5 py-3 font-mono text-[10.5px] font-medium tracking-label text-ink-faint uppercase">
                  {t("time")}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  data-testid="audit-row"
                  className="border-b border-line-soft last:border-0"
                >
                  <td className="px-5 py-2.5 font-mono text-[12px] font-medium text-forest-deep">
                    {row.action}
                  </td>
                  <td className="px-5 py-2.5 font-mono text-[12px] text-ink-soft">
                    {row.entityType}:{String(row.entityId).slice(0, 8)}
                  </td>
                  <td className="px-5 py-2.5 font-mono text-[12px] text-ink-soft">
                    {row.actorType}:{String(row.actorId).slice(0, 8)}
                  </td>
                  <td className="px-5 py-2.5 font-mono text-[12px] text-ink-faint">
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
