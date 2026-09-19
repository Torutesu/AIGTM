import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { schema, withOrg, audit, decryptField, type DbHandle, type OrgContext } from "@aigtm/db";
import type { AgentStep } from "@aigtm/specs";
import { routerForOrg, estimateCostCents, type ModelRouter } from "./model";

/**
 * Ask — grounded Q&A over the org's system of record. Retrieval gathers a
 * bounded snapshot of every record type, the reasoning model answers with
 * citation refs, and the UI maps refs back to real pages. Same provider
 * routing, budget gate and audit trail as agent runs — Ask is not a
 * side-channel that bypasses cost controls.
 */

export interface Citation {
  ref: string;
  label: string;
  href: string;
}

export interface AskResult {
  ok: boolean;
  answer?: string;
  citations?: Citation[];
  model?: string;
  costCents?: number;
  /** set when the org monthly AI budget is already spent */
  budgetExceeded?: boolean;
}

const ASK_STEP: AgentStep = {
  id: "ask",
  kind: "llm",
  model: "reasoning",
  input: {},
  prompt: [
    "You are the analyst inside a GTM operating system. Answer the user's",
    "question using ONLY the sources provided — never invent accounts,",
    "people, deals or numbers. If the sources can't answer, say so plainly.",
    "Answer in the same language as the question.",
    "Every claim must be backed by a source: finish with the list of ref ids",
    "you actually used.",
  ].join(" "),
  output: { answer: "string", citations: "array" },
};

interface SourceItem {
  ref: string;
  label: string;
  href: string;
  detail: string;
}

const CONTEXT_LIMIT = 45;

/**
 * Rank sources by term overlap with the question. A full-snapshot dump would
 * blow the context window once an org has real volume, so we send the top
 * slice — the model only ever sees what it can cite.
 */
export function rankSources(
  question: string,
  sources: SourceItem[],
  limit = CONTEXT_LIMIT,
): SourceItem[] {
  const terms = [
    ...new Set(
      question
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter((t) => t.length >= 2),
    ),
  ];
  if (sources.length <= limit) return sources;
  const scored = sources.map((s, i) => {
    const hay = `${s.label} ${s.detail}`.toLowerCase();
    let score = 0;
    for (const t of terms) if (hay.includes(t)) score += 1;
    return { s, score, i };
  });
  scored.sort((a, b) => b.score - a.score || a.i - b.i);
  return scored.slice(0, limit).map((x) => x.s);
}

export async function askOrg(
  handle: DbHandle,
  ctx: OrgContext,
  question: string,
  router?: ModelRouter,
): Promise<AskResult> {
  // Monthly budget gate — identical rule as agent runs.
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const gated = await withOrg(handle, ctx, async (tx) => {
    const [org] = await tx
      .select({ budget: schema.organizations.budgetMonthlyCents })
      .from(schema.organizations)
      .where(eq(schema.organizations.id, ctx.orgId))
      .limit(1);
    const budget = org?.budget ?? null;
    if (budget == null || budget <= 0) return false;
    const [s] = await tx
      .select({ total: sql<string>`coalesce(sum(${schema.runs.costCents}), 0)` })
      .from(schema.runs)
      .where(
        and(
          eq(schema.runs.orgId, ctx.orgId),
          gte(schema.runs.startedAt, monthStart),
        ),
      );
    return Number(s?.total ?? 0) > budget;
  });
  if (gated) return { ok: false, budgetExceeded: true };

  // Retrieval — bounded snapshot of the SoR. Each item carries a ref the
  // model cites back and an href the UI can link.
  const sources = await withOrg(handle, ctx, async (tx) => {
    const items: SourceItem[] = [];
    const accounts = (await tx
      .select()
      .from(schema.accounts)
      .orderBy(desc(schema.accounts.icpFitScore))
      .limit(60)) as {
      id: string; name: string; domain: string | null; industry: string | null;
      stage: string; icpFitScore: string | null; employeeCount: number | null;
    }[];
    for (const a of accounts) {
      items.push({
        ref: `account:${a.id}`,
        label: a.name,
        href: `/accounts/${a.id}`,
        detail: `account ${a.name} — stage ${a.stage}, industry ${a.industry ?? "?"}, ` +
          `icp_fit ${a.icpFitScore ?? "?"}, domain ${a.domain ?? "?"}, employees ${a.employeeCount ?? "?"}`,
      });
    }
    const accountName = new Map(accounts.map((a) => [a.id, a.name]));

    const people = (await tx
      .select()
      .from(schema.people)
      .limit(120)) as {
      id: string; name: string; role: string | null; email: string | null;
      accountId: string | null;
    }[];
    for (const p of people) {
      items.push({
        ref: `person:${p.id}`,
        label: p.name,
        href: p.accountId ? `/accounts/${p.accountId}` : "/contacts",
        detail: `person ${p.name} — ${p.role ?? "?"} at ${accountName.get(p.accountId ?? "") ?? "?"} <${p.email ?? "?"}>`,
      });
    }

    const deals = (await tx
      .select()
      .from(schema.deals)
      .orderBy(desc(schema.deals.amount))
      .limit(60)) as {
      id: string; name: string; stage: string; amount: string | null;
      lastActivityAt: Date | null; accountId: string | null;
    }[];
    for (const d of deals) {
      items.push({
        ref: `deal:${d.id}`,
        label: d.name,
        href: d.accountId ? `/accounts/${d.accountId}` : "/deals",
        detail: `deal ${d.name} — stage ${d.stage}, amount ${d.amount ?? "?"}, ` +
          `last activity ${d.lastActivityAt?.toISOString().slice(0, 10) ?? "?"}, ` +
          `account ${accountName.get(d.accountId ?? "") ?? "?"}`,
      });
    }

    const events = (await tx
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
      .limit(40)) as {
      id: string; score: string | null; detectedAt: Date | null;
      evidence: { excerpt?: string } | null;
      signalName: string | null; accountName: string | null; accountId: string | null;
    }[];
    for (const e of events) {
      items.push({
        ref: `signal:${e.id}`,
        label: e.signalName ?? "signal",
        href: e.accountId ? `/accounts/${e.accountId}` : "/signals",
        detail: `signal "${e.signalName}" on ${e.accountName ?? "?"} — score ${e.score ?? "?"}, ` +
          `${e.detectedAt?.toISOString().slice(0, 10) ?? "?"}: ${(e.evidence?.excerpt ?? "").slice(0, 300)}`,
      });
    }

    const convs = (await tx
      .select()
      .from(schema.conversations)
      .orderBy(desc(schema.conversations.occurredAt))
      .limit(40)) as {
      id: string; channel: string; subject: string | null; summary: string | null;
      participants: unknown; occurredAt: Date | null; accountId: string | null;
    }[];
    for (const c of convs) {
      items.push({
        ref: `convo:${c.id}`,
        label: c.subject ?? c.channel,
        href: c.accountId ? `/accounts/${c.accountId}` : "/inbox",
        detail: `${c.channel} "${c.subject ?? "(no subject)"}" with ${accountName.get(c.accountId ?? "") ?? "?"} ` +
          `on ${c.occurredAt?.toISOString().slice(0, 10) ?? "?"}: ${(decryptField(c.summary) ?? "").slice(0, 300)}`,
      });
    }

    const claims = (await tx
      .select()
      .from(schema.knowledge)
      .where(isNull(schema.knowledge.validTo))
      .orderBy(desc(schema.knowledge.validFrom))
      .limit(60)) as {
      id: string; subjectType: string; subjectId: string; claim: string;
      confidence: string;
    }[];
    for (const k of claims) {
      items.push({
        ref: `claim:${k.id}`,
        label: k.claim.slice(0, 60),
        href: k.subjectType === "account" ? `/accounts/${k.subjectId}` : "/inbox",
        detail: `learned fact about ${k.subjectType} ${accountName.get(k.subjectId) ?? k.subjectId}: ` +
          `${k.claim} (confidence ${k.confidence})`,
      });
    }
    return items;
  });

  const model = router ?? (await routerForOrg(handle, ctx.orgId));
  const selected = rankSources(question, sources);
  // Only refs actually shown to the model may be cited — anything else is
  // dropped, so a hallucinated ref can never reach the UI.
  const byRef = new Map(selected.map((s) => [s.ref, s]));
  const res = await model.complete(
    { ...ASK_STEP, prompt: `${ASK_STEP.prompt}\n\nQuestion: ${question}` },
    {
      sources: selected.map((s) => ({ ref: s.ref, detail: s.detail })),
    },
  );

  const rawCites = Array.isArray(res.output.citations) ? res.output.citations : [];
  const citations: Citation[] = [];
  for (const c of rawCites) {
    const ref = typeof c === "string" ? c : (c as { ref?: string })?.ref;
    const hit = ref ? byRef.get(ref) : undefined;
    if (hit) citations.push({ ref: hit.ref, label: hit.label, href: hit.href });
  }

  const costCents = estimateCostCents(res.model, res.tokensIn, res.tokensOut);
  await withOrg(handle, ctx, (tx) =>
    audit(tx, ctx, {
      action: "ask.answered",
      entityType: "organization",
      entityId: ctx.orgId,
      detail: {
        question: question.slice(0, 500),
        model: res.model,
        tokensIn: res.tokensIn,
        tokensOut: res.tokensOut,
        costCents,
        sourcesConsidered: sources.length,
        sourcesSent: selected.length,
      },
    }),
  );

  return {
    ok: true,
    answer: typeof res.output.answer === "string" ? res.output.answer : "",
    citations,
    model: res.model,
    costCents,
  };
}
