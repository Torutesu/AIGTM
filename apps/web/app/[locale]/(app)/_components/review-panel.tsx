"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { CheckIcon, XIcon, PencilIcon } from "./icons";
import { Card } from "./ui";

type Draft = {
  from?: string;
  to?: string;
  subject?: string;
  title?: string;
  body?: string;
};

type DiffLine = { type: "same" | "del" | "add"; text: string };

function diffLines(a: string, b: string): DiffLine[] {
  const A = a.split("\n");
  const B = b.split("\n");
  const m = A.length;
  const n = B.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0),
  );
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] =
        A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (A[i] === B[j]) {
      out.push({ type: "same", text: A[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ type: "del", text: A[i] });
      i++;
    } else {
      out.push({ type: "add", text: B[j] });
      j++;
    }
  }
  while (i < m) out.push({ type: "del", text: A[i++] });
  while (j < n) out.push({ type: "add", text: B[j++] });
  return out;
}

export function ReviewPanel({
  approvalId,
  draft,
  decideAction,
}: {
  approvalId: string;
  draft: Draft | null;
  decideAction: (formData: FormData) => Promise<void>;
}) {
  const t = useTranslations("approvals");
  const original = draft?.body ?? "";
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(original);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");

  const changed = editing && body !== original;
  const diff = useMemo(
    () => (changed ? diffLines(original, body) : []),
    [changed, original, body],
  );

  return (
    <div className="flex flex-col gap-4">
      {draft && (draft.subject || draft.body || draft.title) ? (
        <Card className="px-5 py-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="font-mono text-[10px] tracking-label text-ink-faint uppercase">
              {t("draft")}
            </p>
            {draft.body ? (
              <button
                type="button"
                onClick={() => {
                  setEditing((v) => !v);
                  if (editing) setBody(original);
                }}
                className="flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1 font-mono text-[10.5px] text-ink-soft hover:border-ink-faint hover:text-ink"
              >
                <PencilIcon size={11} strokeWidth={1.8} />
                {editing ? t("cancelEdit") : t("edit")}
              </button>
            ) : null}
          </div>
          <dl className="flex flex-col gap-1.5 border-b border-line-soft pb-3 text-[13px]">
            {draft.from ? (
              <div className="flex gap-3">
                <dt className="w-14 font-mono text-[11px] text-ink-faint">From</dt>
                <dd className="text-ink">{draft.from}</dd>
              </div>
            ) : null}
            {draft.to ? (
              <div className="flex gap-3">
                <dt className="w-14 font-mono text-[11px] text-ink-faint">To</dt>
                <dd className="text-ink">{draft.to}</dd>
              </div>
            ) : null}
            {draft.subject || draft.title ? (
              <div className="flex gap-3">
                <dt className="w-14 font-mono text-[11px] text-ink-faint">Subject</dt>
                <dd className="font-medium text-ink">{draft.subject ?? draft.title}</dd>
              </div>
            ) : null}
          </dl>
          {draft.body != null ? (
            editing ? (
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={Math.max(6, body.split("\n").length + 1)}
                className="mt-3 w-full rounded-lg border border-line bg-paper px-3 py-2.5 text-[13.5px] leading-relaxed text-ink outline-none focus:border-forest"
              />
            ) : (
              <p className="pt-3 text-[13.5px] leading-relaxed whitespace-pre-wrap text-ink">
                {draft.body}
              </p>
            )
          ) : null}
          {changed ? (
            <div className="mt-3">
              <p className="mb-2 font-mono text-[10px] tracking-label text-ink-faint uppercase">
                {t("diff")}
              </p>
              <div className="overflow-hidden rounded-lg border border-line font-mono text-[12px] leading-relaxed">
                {diff.map((l, i) => (
                  <div
                    key={i}
                    className={
                      l.type === "add"
                        ? "bg-mint/60 px-3 py-0.5 text-mint-ink"
                        : l.type === "del"
                          ? "bg-red-soft/60 px-3 py-0.5 text-red-ink line-through"
                          : "px-3 py-0.5 text-ink-soft"
                    }
                  >
                    <span className="mr-2 inline-block w-3 text-ink-faint select-none">
                      {l.type === "add" ? "+" : l.type === "del" ? "−" : " "}
                    </span>
                    {l.text || " "}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </Card>
      ) : null}

      {rejecting ? (
        <Card className="px-5 py-4">
          <p className="mb-2 font-mono text-[10px] tracking-label text-ink-faint uppercase">
            {t("rejectReason")}
          </p>
          <form action={decideAction} className="flex flex-col gap-3">
            <input type="hidden" name="approvalId" value={approvalId} />
            <input type="hidden" name="decision" value="rejected" />
            <input
              name="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t("reasonPlaceholder")}
              className="w-full rounded-lg border border-line bg-paper px-3 py-2.5 text-[13px] text-ink outline-none placeholder:text-ink-faint focus:border-forest"
            />
            <div className="flex gap-2">
              <button
                type="submit"
                className="flex items-center gap-1.5 rounded-lg bg-red-ink px-4 py-2 font-mono text-[11px] tracking-[0.06em] text-white uppercase"
              >
                <XIcon size={13} strokeWidth={2.2} />
                {t("confirmReject")}
              </button>
              <button
                type="button"
                onClick={() => setRejecting(false)}
                className="rounded-lg border border-line px-4 py-2 font-mono text-[11px] tracking-[0.06em] text-ink-soft uppercase"
              >
                {t("back")}
              </button>
            </div>
          </form>
        </Card>
      ) : (
        <div className="flex gap-2">
          <form action={decideAction}>
            <input type="hidden" name="approvalId" value={approvalId} />
            <input type="hidden" name="decision" value="approved" />
            {changed ? <input type="hidden" name="editedBody" value={body} /> : null}
            <button
              type="submit"
              className="flex items-center gap-1.5 rounded-lg bg-forest px-5 py-2.5 font-mono text-[11px] tracking-[0.06em] text-white uppercase transition-colors hover:bg-forest-deep"
            >
              <CheckIcon size={13} strokeWidth={2.2} />
              {changed ? t("approveEdited") : t("approve")}
            </button>
          </form>
          <button
            type="button"
            onClick={() => setRejecting(true)}
            className="flex items-center gap-1.5 rounded-lg border border-line bg-card px-5 py-2.5 font-mono text-[11px] tracking-[0.06em] text-ink-soft uppercase transition-colors hover:border-ink-faint hover:text-ink"
          >
            <XIcon size={13} strokeWidth={2.2} />
            {t("reject")}
          </button>
        </div>
      )}
    </div>
  );
}
