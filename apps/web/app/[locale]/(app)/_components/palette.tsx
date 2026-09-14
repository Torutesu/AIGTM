"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "../../../../i18n/routing";
import { SearchIcon } from "./icons";

export function CommandPalette() {
  const t = useTranslations("palette");
  const nav = useTranslations("nav");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const items = useMemo(
    () =>
      [
        { key: "inbox", href: "/inbox" },
        { key: "approvals", href: "/approvals" },
        { key: "agents", href: "/agents" },
        { key: "accounts", href: "/accounts" },
        { key: "deals", href: "/deals" },
        { key: "contacts", href: "/contacts" },
        { key: "signals", href: "/signals" },
        { key: "audit", href: "/audit" },
      ].map((i) => ({ ...i, label: nav(i.key) })),
    [nav],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((i) => i.label.toLowerCase().includes(q) || i.key.includes(q));
  }, [items, query]);

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
          className="fixed inset-0 z-50 flex items-start justify-center bg-ink/20 pt-[18vh] backdrop-blur-[2px]"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-md overflow-hidden rounded-xl border border-line bg-card shadow-raised"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 border-b border-line px-4">
              <span className="font-mono text-[11px] text-ink-faint">⌘K</span>
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
                    setIndex((i) => Math.min(i + 1, filtered.length - 1));
                  }
                  if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setIndex((i) => Math.max(i - 1, 0));
                  }
                  if (e.key === "Enter" && filtered[index]) {
                    go(filtered[index].href);
                  }
                }}
                placeholder={t("placeholder")}
                className="w-full bg-transparent py-3.5 text-[14px] text-ink outline-none placeholder:text-ink-faint"
              />
            </div>
            <ul className="max-h-72 overflow-y-auto p-2">
              {filtered.map((item, i) => (
                <li key={item.key}>
                  <button
                    type="button"
                    onClick={() => go(item.href)}
                    onMouseEnter={() => setIndex(i)}
                    className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-[13.5px] ${
                      i === index ? "bg-paper-deep text-forest-deep" : "text-ink-soft"
                    }`}
                  >
                    {item.label}
                    <span className="font-mono text-[10px] text-ink-faint">{item.href}</span>
                  </button>
                </li>
              ))}
              {filtered.length === 0 ? (
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
