export const dynamic = "force-dynamic";
import { useTranslations } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { desc, eq, and } from "drizzle-orm";
import { notFound } from "next/navigation";
import { schema, withOrg } from "@aigtm/db";
import { ensureDb } from "../../../../../lib/db";
import { requireSession } from "../../../../../lib/session";
import {
  Chip,
  Card,
  EmptyState,
  ScoreBar,
  stamp,
  type ChipTone,
} from "../../_components/ui";

interface AccountRow {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  employeeCount: number | null;
  icpFitScore: string | null;
  stage: string;
}
interface PersonRow {
  id: string;
  name: string;
  email: string | null;
  role: string | null;
}
interface DealRow {
  id: string;
  name: string;
  stage: string;
  amount: string | null;
  lastActivityAt: Date | string | null;
}
interface SignalRow {
  id: string;
  signalName: string | null;
  score: string | null;
  detectedAt: Date | string;
  evidence: { excerpt?: string } | null;
}
interface ConvoRow {
  id: string;
  channel: string;
  subject: string | null;
  summary: string | null;
  occurredAt: Date | string | null;
}
interface KnowledgeRow {
  id: string;
  claim: string;
  confidence: string;
  validFrom: Date | string;
}

export default async function AccountDetailPage({
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
      const [account] = (await tx
        .select()
        .from(schema.accounts)
        .where(eq(schema.accounts.id, id))
        .limit(1)) as AccountRow[];
      if (!account) return null;
      const people = (await tx
        .select()
        .from(schema.people)
        .where(eq(schema.people.accountId, id))) as PersonRow[];
      const dealRows = (await tx
        .select()
        .from(schema.deals)
        .where(eq(schema.deals.accountId, id))) as DealRow[];
      const signalRows = (await tx
        .select({
          id: schema.signalEvents.id,
          signalName: schema.signals.name,
          score: schema.signalEvents.score,
          detectedAt: schema.signalEvents.detectedAt,
          evidence: schema.signalEvents.evidence,
        })
        .from(schema.signalEvents)
        .leftJoin(schema.signals, eq(schema.signalEvents.signalId, schema.signals.id))
        .where(eq(schema.signalEvents.accountId, id))
        .orderBy(desc(schema.signalEvents.detectedAt))) as SignalRow[];
      const convoRows = (await tx
        .select()
        .from(schema.conversations)
        .where(eq(schema.conversations.accountId, id))
        .orderBy(desc(schema.conversations.occurredAt))) as ConvoRow[];
      const knowledgeRows = (await tx
        .select()
        .from(schema.knowledge)
        .where(
          and(
            eq(schema.knowledge.subjectType, "account"),
            eq(schema.knowledge.subjectId, id),
          ),
        )
        .orderBy(desc(schema.knowledge.validFrom))) as KnowledgeRow[];
      return { account, people, dealRows, signalRows, convoRows, knowledgeRows };
    },
  );

  if (!data) notFound();
  return <AccountView locale={locale} {...data} />;
}

function dealStageTone(stage: string): ChipTone {
  if (stage === "won" || stage === "closed_won") return "good";
  if (stage === "lost" || stage === "closed_lost") return "bad";
  if (stage === "negotiation" || stage === "open") return "pending";
  return "neutral";
}

function AccountView({
  locale,
  account,
  people,
  dealRows,
  signalRows,
  convoRows,
  knowledgeRows,
}: {
  locale: string;
  account: AccountRow;
  people: PersonRow[];
  dealRows: DealRow[];
  signalRows: SignalRow[];
  convoRows: ConvoRow[];
  knowledgeRows: KnowledgeRow[];
}) {
  const t = useTranslations("account");
  return (
    <div>
      <header className="mb-8">
        <p className="font-mono text-[11px] tracking-label text-ink-faint uppercase">
          {t("eyebrow")}
        </p>
        <div className="mt-2 flex items-center gap-4">
          <span className="flex size-11 items-center justify-center rounded-lg bg-forest font-mono text-[16px] text-white">
            {account.name.slice(0, 1)}
          </span>
          <div>
            <h1 className="text-[26px] leading-tight font-semibold tracking-tight text-forest-deep">
              {account.name}
            </h1>
            <p className="font-mono text-[12px] text-ink-faint">
              {[account.domain, account.industry, account.employeeCount ? `${account.employeeCount} ppl` : null]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
          <div className="ml-auto flex items-center gap-4">
            <ScoreBar score={account.icpFitScore} />
            <Chip tone={account.stage === "customer" ? "good" : account.stage === "opportunity" ? "pending" : "info"}>
              {account.stage}
            </Chip>
          </div>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex flex-col gap-8">
          <section>
            <h2 className="mb-3 font-mono text-[11px] tracking-label text-ink-soft uppercase">
              {t("signals")}
            </h2>
            {signalRows.length === 0 ? (
              <EmptyState label={t("noSignals")} />
            ) : (
              <ul className="flex flex-col gap-3">
                {signalRows.map((s) => (
                  <li key={s.id}>
                    <Card className="px-5 py-4">
                      <div className="flex items-center justify-between gap-4">
                        <span className="text-[14px] font-semibold text-ink">{s.signalName}</span>
                        <div className="flex items-center gap-3">
                          <ScoreBar score={s.score} />
                          <span className="font-mono text-[11px] text-ink-faint">
                            {stamp(s.detectedAt, locale)}
                          </span>
                        </div>
                      </div>
                      {s.evidence?.excerpt ? (
                        <p className="mt-1.5 text-[13px] text-ink-soft">{s.evidence.excerpt}</p>
                      ) : null}
                    </Card>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h2 className="mb-3 font-mono text-[11px] tracking-label text-ink-soft uppercase">
              {t("timeline")}
            </h2>
            {convoRows.length === 0 ? (
              <EmptyState label={t("noTimeline")} />
            ) : (
              <Card className="divide-y divide-line-soft px-5">
                {convoRows.map((c) => (
                  <div key={c.id} className="flex gap-4 py-3.5">
                    <span className="mt-0.5 w-16 shrink-0 font-mono text-[10.5px] tracking-[0.06em] text-ink-faint uppercase">
                      {c.channel}
                    </span>
                    <div className="min-w-0">
                      <p className="text-[13.5px] font-medium text-ink">{c.subject}</p>
                      {c.summary ? (
                        <p className="mt-0.5 text-[13px] text-ink-soft">{c.summary}</p>
                      ) : null}
                    </div>
                    <span className="ml-auto shrink-0 font-mono text-[11px] text-ink-faint">
                      {c.occurredAt ? stamp(c.occurredAt, locale) : ""}
                    </span>
                  </div>
                ))}
              </Card>
            )}
          </section>

          <section>
            <h2 className="mb-3 font-mono text-[11px] tracking-label text-ink-soft uppercase">
              {t("knowledge")}
            </h2>
            {knowledgeRows.length === 0 ? (
              <EmptyState label={t("noKnowledge")} />
            ) : (
              <Card className="divide-y divide-line-soft px-5">
                {knowledgeRows.map((k) => (
                  <div key={k.id} className="py-3">
                    <p className="line-clamp-2 text-[13px] text-ink-soft">{k.claim}</p>
                    <p className="mt-1 font-mono text-[10.5px] text-ink-faint">
                      {t("confidence")} {k.confidence} · {stamp(k.validFrom, locale)}
                    </p>
                  </div>
                ))}
              </Card>
            )}
          </section>
        </div>

        <div className="flex flex-col gap-8">
          <section>
            <h2 className="mb-3 font-mono text-[11px] tracking-label text-ink-soft uppercase">
              {t("contacts")}
            </h2>
            <Card className="divide-y divide-line-soft px-4">
              {people.length === 0 ? (
                <p className="py-6 text-center font-mono text-[11px] text-ink-faint">—</p>
              ) : (
                people.map((p) => (
                  <div key={p.id} className="flex items-center gap-3 py-3">
                    <span className="flex size-8 items-center justify-center rounded-full bg-paper-deep font-mono text-[11px] text-ink-soft">
                      {p.name.slice(0, 1)}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-medium text-ink">{p.name}</p>
                      <p className="truncate font-mono text-[10.5px] text-ink-faint">
                        {[p.role, p.email].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </Card>
          </section>

          <section>
            <h2 className="mb-3 font-mono text-[11px] tracking-label text-ink-soft uppercase">
              {t("deals")}
            </h2>
            <Card className="divide-y divide-line-soft px-4">
              {dealRows.length === 0 ? (
                <p className="py-6 text-center font-mono text-[11px] text-ink-faint">—</p>
              ) : (
                dealRows.map((d) => (
                  <div key={d.id} className="py-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-[13px] font-medium text-ink">{d.name}</p>
                      <Chip tone={dealStageTone(d.stage)}>{d.stage}</Chip>
                    </div>
                    <p className="mt-1 font-mono text-[11px] text-ink-faint">
                      {d.amount ? `$${Number(d.amount).toLocaleString()}` : "—"}
                      {d.lastActivityAt ? ` · ${stamp(d.lastActivityAt, locale)}` : ""}
                    </p>
                  </div>
                ))
              )}
            </Card>
          </section>
        </div>
      </div>
    </div>
  );
}
