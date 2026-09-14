export const dynamic = "force-dynamic";
import { useTranslations } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { asc, eq } from "drizzle-orm";
import { schema, withOrg } from "@aigtm/db";
import { Link } from "../../../../i18n/routing";
import { ensureDb } from "../../../../lib/db";
import { requireSession } from "../../../../lib/session";
import { PageHeader, Card, EmptyState } from "../_components/ui";

interface PersonRow {
  id: string;
  name: string;
  email: string | null;
  role: string | null;
  accountName: string | null;
  accountId: string | null;
}

export default async function ContactsPage({
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
          id: schema.people.id,
          name: schema.people.name,
          email: schema.people.email,
          role: schema.people.role,
          accountName: schema.accounts.name,
          accountId: schema.people.accountId,
        })
        .from(schema.people)
        .leftJoin(schema.accounts, eq(schema.people.accountId, schema.accounts.id))
        .orderBy(asc(schema.people.name))
        .limit(200),
  )) as PersonRow[];

  return <ContactsView rows={rows} />;
}

function ContactsView({ rows }: { rows: PersonRow[] }) {
  const t = useTranslations("contacts");
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
                  {t("contact")}
                </th>
                <th className="px-4 py-3 font-mono text-[10.5px] font-medium tracking-label text-ink-faint uppercase">
                  {t("role")}
                </th>
                <th className="px-4 py-3 font-mono text-[10.5px] font-medium tracking-label text-ink-faint uppercase">
                  {t("account")}
                </th>
                <th className="px-5 py-3 font-mono text-[10.5px] font-medium tracking-label text-ink-faint uppercase">
                  {t("email")}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="border-b border-line-soft last:border-0 hover:bg-paper/60">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-3">
                      <span className="flex size-7 items-center justify-center rounded-full bg-paper-deep font-mono text-[10.5px] text-ink-soft">
                        {p.name.slice(0, 1)}
                      </span>
                      <span className="text-[13.5px] font-medium text-ink">{p.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-[13px] text-ink-soft">{p.role ?? "—"}</td>
                  <td className="px-4 py-3">
                    {p.accountId ? (
                      <Link
                        href={`/accounts/${p.accountId}`}
                        className="text-[13px] text-ink-soft hover:text-forest-deep"
                      >
                        {p.accountName}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-5 py-3 font-mono text-[12px] text-ink-soft">
                    {p.email ?? "—"}
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
