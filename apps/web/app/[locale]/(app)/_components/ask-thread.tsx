"use client";

import { useRef, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { askAction } from "../../../../lib/actions";
import { Link } from "../../../../i18n/routing";
import { ArrowUpIcon } from "./icons";

interface Turn {
  q: string;
  pending?: boolean;
  answer?: string;
  citations?: { ref: string; label: string; href: string }[];
  model?: string;
  error?: "budget" | "generic";
}

export function AskThread() {
  const t = useTranslations("ask");
  const locale = useLocale();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  async function submit(formData: FormData) {
    const q = String(formData.get("q") ?? "").trim();
    if (!q || busy) return;
    setBusy(true);
    setTurns((prev) => [...prev, { q, pending: true }]);
    if (inputRef.current) inputRef.current.value = "";
    try {
      const res = await askAction(locale, q);
      setTurns((prev) => {
        const next = [...prev];
        next[next.length - 1] = {
          q,
          answer: res.ok ? res.answer : undefined,
          citations: res.ok ? res.citations : undefined,
          model: res.ok ? res.model : undefined,
          error: res.ok ? undefined : res.budgetExceeded ? "budget" : "generic",
        };
        return next;
      });
    } catch {
      setTurns((prev) => {
        const next = [...prev];
        next[next.length - 1] = { q, error: "generic" };
        return next;
      });
    } finally {
      setBusy(false);
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-5">
        {turns.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-line px-6 py-14 text-center">
            <p className="text-sm text-ink-soft">{t("empty")}</p>
            <p className="mt-2 text-xs text-ink-faint">{t("emptyHint")}</p>
          </div>
        ) : null}
        {turns.map((turn, i) => (
          <div key={i} className="flex flex-col gap-3">
            <div className="self-end max-w-[80%] rounded-2xl rounded-br-sm bg-forest-deep px-4 py-2.5 text-sm text-white">
              {turn.q}
            </div>
            <div className="self-start w-full max-w-[92%] rounded-2xl rounded-tl-sm border border-line bg-surface px-5 py-4">
              {turn.pending ? (
                <p className="text-sm text-ink-faint animate-pulse">{t("thinking")}</p>
              ) : turn.error ? (
                <p className="text-sm text-red-700">
                  {turn.error === "budget" ? t("budgetExceeded") : t("error")}
                </p>
              ) : (
                <>
                  <p className="text-sm leading-relaxed text-ink whitespace-pre-wrap">
                    {turn.answer || t("noAnswer")}
                  </p>
                  {turn.citations && turn.citations.length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-1.5 border-t border-line pt-3">
                      <span className="font-mono text-[10px] uppercase tracking-label text-ink-faint self-center mr-1">
                        {t("sources")}
                      </span>
                      {turn.citations.map((c) => (
                        <Link
                          key={c.ref}
                          href={c.href}
                          className="rounded-full border border-line bg-canvas px-2.5 py-0.5 text-xs text-ink-soft hover:border-forest hover:text-forest-deep transition-colors"
                        >
                          {c.label}
                        </Link>
                      ))}
                    </div>
                  ) : null}
                  {turn.model?.startsWith("mock:") ? (
                    <p className="mt-2 font-mono text-[10px] text-ink-faint">{t("mockModel")}</p>
                  ) : null}
                </>
              )}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <form action={submit} className="sticky bottom-4">
        <div className="flex items-center gap-2 rounded-2xl border border-line bg-surface p-2 shadow-sm">
          <input
            ref={inputRef}
            name="q"
            required
            maxLength={2000}
            autoComplete="off"
            placeholder={t("placeholder")}
            className="flex-1 bg-transparent px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:outline-none"
          />
          <button
            type="submit"
            disabled={busy}
            aria-label={t("send")}
            className="rounded-xl bg-forest-deep p-2.5 text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            <ArrowUpIcon size={16} />
          </button>
        </div>
      </form>
    </div>
  );
}
