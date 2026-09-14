"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "../../../../i18n/routing";
import { SearchIcon } from "./icons";

interface ResultItem {
  key: string;
  label: string;
  hint?: string;
  href: string;
}

interface SearchResponse {
  accounts: { id: string; name: string }[];
  people: { id: string; name: string; accountId: string | null }[];
  deals: { id: string; name: string; accountId: string | null }[];
  agents: { id: string; name: string }[];
}

export function CommandPalette() {
  const t = useTranslations("palette");
  const nav = useTranslations("nav");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const [remote, setRemote] = useState<ResultItem[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pages = useMemo(
    () =>
      [
        { key: "inbox", href: "/inbox" },
        { key: "approvals", href: "/approvals" },
        { key: "agents", href: "/agents" },
        { key: "accounts", href: "/accounts" },
        { key: "deals", href: "/deals" },
        { key: "contacts", href: "/contacts" },
        { key: "segments", href: "/segments" },
        { key: "signals", href: "/signals" },
        { key: "audit", href: "/audit" },
      ].map((i) => ({ ...i, label: nav(i.key) })),
    [nav],
  );

  const q = query.trim().toLowerCase();
  const pageItems = useMemo<ResultItem[]>(() => {
    if (!q) return pages;
    return pages.filter(
      (i) => i.label.toLowerCase().includes(q) || i.key.includes(q),
    );
  }, [pages, q]);

  const items = useMemo(() => [...pageItems, ...remote], [pageItems, remote]);

  useEffect(() => {
    if (!q) {
      setRemote([]);
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        if (!res.ok) return;
        const data = (await res.json()) as SearchResponse;
        const out: ResultItem[] = [
          ...data.accounts.map((a) => ({
            key: `a-${a.id}`,
            label: a.name,
            hint: t("accounts"),
            href: `/accounts/${a.id}`,
          })),
          ...data.people.map((p) => ({
            key: `p-${p.id}`,
            label: p.name,
            hint: t("contacts"),
            href: p.accountId ? `/accounts/${p.accountId}` : "/contacts",
          })),
          ...data.deals.map((d) => ({
            key: `d-${d.id}`,
            label: d.name,
            hint: t("deals"),
            href: d.accountId ? `/accounts/${d.accountId}` : "/deals",
          })),
          ...data.agents.map((a) => ({
            key: `g-${a.id}`,
            label: a.name,
            hint: t("agents"),
            href: `/agents/${a.id}`,
          })),
        ];
        setRemote(out);
      } catch {
        // network hiccup — keep page results only
      }
    }, 180);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [q, t]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) {
      setQuery("");
      setIndex(0);
      setRemote([]);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-2 rounded-lg border border-line bg-card px-3 py-2 text-left text-[12.5px] text-ink-faint hover:border-ink-faint/40"
      >
        <SearchIcon size={13} strokeWidth={1.8} />
        <span className="flex-1">{nav("search")}</span>
        <kbd className="rounded border border-line px-1 font-mono text-[9.5px] text-ink-faint">
          ⌘K
        </kbd>
      </button>
      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-ink/20 px-4 pt-[18vh] backdrop-blur-[2px]"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-md overflow-hidden rounded-xl border border-line bg-card shadow-raised"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 border-b border-line px-4">
              <SearchIcon size={13} strokeWidth={1.8} className="text-ink-faint" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setIndex(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setIndex((i) => Math.min(i + 1, items.length - 1));
                  }
                  if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setIndex((i) => Math.max(i - 1, 0));
                  }
                  if (e.key === "Enter" && items[index]) {
                    go(items[index].href);
                  }
                }}
                placeholder={t("placeholder")}
                className="w-full bg-transparent py-3.5 text-[14px] text-ink outline-none placeholder:text-ink-faint"
              />
            </div>
            <ul className="max-h-72 overflow-y-auto p-2">
              {items.map((item, i) => (
                <li key={item.key}>
                  <button
                    type="button"
                    onClick={() => go(item.href)}
                    onMouseEnter={() => setIndex(i)}
                    className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left text-[13.5px] ${
                      i === index ? "bg-paper-deep text-forest-deep" : "text-ink-soft"
                    }`}
                  >
                    <span className="truncate">{item.label}</span>
                    <span className="shrink-0 font-mono text-[10px] text-ink-faint">
                      {item.hint ?? item.href}
                    </span>
                  </button>
                </li>
              ))}
              {items.length === 0 ? (
                <li className="px-3 py-6 text-center font-mono text-[11px] text-ink-faint">
                  {t("empty")}
                </li>
              ) : null}
            </ul>
          </div>
        </div>
      ) : null}
    </>
  );
}
