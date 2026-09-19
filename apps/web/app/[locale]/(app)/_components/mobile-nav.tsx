"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "../../../../i18n/routing";
import { MenuIcon, XIcon, GlobeIcon, LogOutIcon, Logo } from "./icons";
import { SideNav } from "./nav";

export function MobileNav({
  email,
  locale,
  role,
  signOut,
  switcher,
}: {
  email: string;
  locale: string;
  role: string;
  signOut: () => Promise<void>;
  switcher?: React.ReactNode;
}) {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const other = locale === "en" ? "ja" : "en";

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        aria-label={t("menu")}
        onClick={() => setOpen(true)}
        className="flex size-9 items-center justify-center rounded-lg border border-line bg-card text-ink-soft"
      >
        <MenuIcon size={16} strokeWidth={1.8} />
      </button>
      {open
        ? createPortal(
            <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-ink/30"
            onClick={() => setOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 flex w-64 flex-col border-r border-line bg-paper">
            <div className="flex h-14 items-center justify-between border-b border-line-soft px-4">
              <Logo size={22} textClassName="text-[19px]" />
              <button
                type="button"
                aria-label={t("close")}
                onClick={() => setOpen(false)}
                className="flex size-8 items-center justify-center rounded-md text-ink-faint hover:text-ink"
              >
                <XIcon size={16} strokeWidth={1.8} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-3 py-4">
              <SideNav role={role} />
            </div>
            <div className="border-t border-line-soft px-3 py-4">
              {switcher}
              <div className="flex items-center gap-2.5 px-3 py-1.5">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-forest font-mono text-[11px] text-white">
                  {email.slice(0, 1).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1 truncate text-[13px] text-ink-soft">
                  {email}
                </span>
              </div>
              <div className="mt-1 flex items-center gap-1 px-3">
                <Link
                  href={pathname}
                  locale={other}
                  className="flex items-center gap-1.5 rounded-md px-2 py-1 font-mono text-[11px] text-ink-faint"
                >
                  <GlobeIcon size={12} strokeWidth={1.8} />
                  {other === "ja" ? "日本語" : "EN"}
                </Link>
                <form action={signOut}>
                  <button
                    type="submit"
                    className="flex items-center gap-1.5 rounded-md px-2 py-1 font-mono text-[11px] text-ink-faint"
                  >
                    <LogOutIcon size={12} strokeWidth={1.8} />
                    {t("signOut")}
                  </button>
                </form>
              </div>
            </div>
          </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
