export const dynamic = "force-dynamic";
import { useTranslations } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { desc, eq, inArray } from "drizzle-orm";
import { schema, withOrg } from "@aigtm/db";
import { ensureDb } from "../../../../lib/db";
import { requireSession } from "../../../../lib/session";
import {
  PageHeader,
  Chip,
  Card,
  EmptyState,
  ScoreBar,
  type ChipTone,
} from "../_components/ui";

interface AccountRow {
  id: string;
  name: string;
  domain: string | null;
  icpFitScore: string | null;
  stage: string;
}

export default async function AccountsPage({
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
      const accountRows = (await tx
        .select()
        .from(schema.accounts)
        .orderBy(desc(schema.accounts.icpFitScore))
        .limit(100)) as AccountRow[];

      const ids = accountRows.map((a) => a.id);
      const contactRows = ids.length
        ? ((await tx
            .select({ accountId: schema.people.accountId, name: schema.people.name })
            .from(schema.people)
            .where(inArray(schema.people.accountId, ids))) as {
            accountId: string | null;
            name: string;
          }[])
        : [];
      const signalRows = ids.length
        ? ((await tx
            .select({
              accountId: schema.signalEvents.accountId,
              signalName: schema.signals.name,
              detectedAt: schema.signalEvents.detectedAt,
            })
            .from(schema.signalEvents)
            .innerJoin(schema.signals, eq(schema.signalEvents.signalId, schema.signals.id))
            .where(inArray(schema.signalEvents.accountId, ids))
            .orderBy(desc(schema.signalEvents.detectedAt))) as {
            accountId: string | null;
            signalName: string | null;
          }[])
        : [];

      const contactsByAccount = new Map<string, string[]>();
      for (const c of contactRows) {
        if (!c.accountId) continue;
        contactsByAccount.set(c.accountId, [...(contactsByAccount.get(c.accountId) ?? []), c.name]);
      }
      const signalsByAccount = new Map<string, string[]>();
      for (const s of signalRows) {
        if (!s.accountId || !s.signalName) continue;
        const list = signalsByAccount.get(s.accountId) ?? [];
        if (!list.includes(s.signalName) && list.length < 3) list.push(s.signalName);
        signalsByAccount.set(s.accountId, list);
      }
      return { accountRows, contactsByAccount, signalsByAccount };
    },
  );

  return (
    <AccountsView
      accounts={data.accountRows}
      contactsByAccount={Object.fromEntries(data.contactsByAccount)}
      signalsByAccount={Object.fromEntries(data.signalsByAccount)}
    />
  );
}

function stageChip(stage: string): { tone: ChipTone; key: string } {
  switch (stage) {
    case "customer":
      return { tone: "good", key: "stageCustomer" };
    case "opportunity":
      return { tone: "pending", key: "stageOpportunity" };
    default:
      return { tone: "info", key: "stageNew" };
  }
}

function AccountsView({
  accounts,
  contactsByAccount,
  signalsByAccount,
}: {
  accounts: AccountRow[];
  contactsByAccount: Record<string, string[]>;
  signalsByAccount: Record<string, string[]>;
}) {
  const t = useTranslations("accounts");
  return (
    <div>
      <PageHeader
        eyebrow={t("eyebrow")}
        title={t("title")}
        meta={t("totalCount", { count: accounts.length })}
      />

      {accounts.length === 0 ? (
        <EmptyState label={t("empty")} />
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left">
                <th className="px-5 py-3 font-mono text-[10.5px] font-medium tracking-label text-ink-faint uppercase">
                  {t("account")}
                </th>
                <th className="px-4 py-3 font-mono text-[10.5px] font-medium tracking-label text-ink-faint uppercase">
                  {t("score")}
                </th>
                <th className="px-4 py-3 font-mono text-[10.5px] font-medium tracking-label text-ink-faint uppercase">
                  {t("status")}
                </th>
                <th className="px-4 py-3 font-mono text-[10.5px] font-medium tracking-label text-ink-faint uppercase">
                  {t("contacts")}
                </th>
                <th className="px-5 py-3 font-mono text-[10.5px] font-medium tracking-label text-ink-faint uppercase">
                  {t("signals")}
                </th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => {
                const chip = stageChip(a.stage);
                const contacts = contactsByAccount[a.id] ?? [];
                const sigs = signalsByAccount[a.id] ?? [];
                return (
                  <tr
                    key={a.id}
                    data-testid="account-row"
                    className="border-b border-line-soft last:border-0 hover:bg-paper/60"
                  >
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-forest font-mono text-[11px] text-white">
                          {a.name.slice(0, 1)}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-[13.5px] font-medium text-ink">
                            {a.name}
                          </p>
                          <p className="truncate font-mono text-[11px] text-ink-faint">
                            {a.domain}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <ScoreBar score={a.icpFitScore} />
                    </td>
                    <td className="px-4 py-3">
                      <Chip tone={chip.tone}>{t(chip.key)}</Chip>
                    </td>
                    <td className="px-4 py-3">
                      <span className="flex -space-x-1.5">
                        {contacts.slice(0, 3).map((n) => (
                          <span
                            key={n}
                            title={n}
                            className="flex size-6 items-center justify-center rounded-full border border-card bg-paper-deep font-mono text-[9px] text-ink-soft"
                          >
                            {n.slice(0, 1)}
                          </span>
                        ))}
                        {contacts.length > 3 ? (
                          <span className="flex size-6 items-center justify-center rounded-full border border-card bg-paper-deep font-mono text-[9px] text-ink-faint">
                            +{contacts.length - 3}
                          </span>
                        ) : null}
                        {contacts.length === 0 ? (
                          <span className="font-mono text-[11px] text-ink-faint">—</span>
                        ) : null}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <span className="flex flex-wrap gap-1.5">
                        {sigs.map((s) => (
                          <span
                            key={s}
                            className="rounded-md border border-line bg-paper px-2 py-0.5 font-mono text-[10.5px] whitespace-nowrap text-ink-soft"
                          >
                            {s}
                          </span>
                        ))}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
