import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { GlobeIcon, LogOutIcon } from "./_components/icons";
import { requireSession } from "../../../lib/session";
import { signOutAction } from "../../../lib/actions";
import { Link } from "../../../i18n/routing";
import { SideNav } from "./_components/nav";
import { CommandPalette } from "./_components/palette";
import { MobileNav } from "./_components/mobile-nav";
import { ToastHub } from "./_components/toast";
import { readToast } from "../../../lib/toast";

export const dynamic = "force-dynamic";

export default async function AppLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await requireSession(locale);
  const toast = await readToast();
  return (
    <Shell
      locale={locale}
      email={session.email}
      role={session.role}
      toast={toast}
    >
      {children}
    </Shell>
  );
}

function Shell({
  children,
  locale,
  email,
  role,
  toast,
}: {
  children: ReactNode;
  locale: string;
  email: string;
  role: string;
  toast: string | null;
}) {
  const t = useTranslations("nav");
  const other = locale === "en" ? "ja" : "en";
  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-line bg-paper lg:flex">
        <div className="flex h-16 items-center border-b border-line-soft px-5">
          <Link href="/inbox" className="flex items-baseline gap-2">
            <span className="wordmark text-[22px] font-bold">AIGTM</span>
          </Link>
        </div>

        <div className="px-3 pt-4">
          <CommandPalette role={role} />
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-4">
          <SideNav role={role} />
        </div>

        <div className="border-t border-line-soft px-3 py-4">
          <div className="flex items-center gap-2.5 rounded-lg px-3 py-1.5">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-forest font-mono text-[11px] text-white">
              {email.slice(0, 1).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1 truncate text-[13px] text-ink-soft">
              {email}
            </span>
          </div>
          <div className="mt-1 flex items-center gap-1 px-3">
            <Link
              href="/inbox"
              locale={other}
              className="flex items-center gap-1.5 rounded-md px-2 py-1 font-mono text-[11px] text-ink-faint hover:bg-paper-deep hover:text-ink"
            >
              <GlobeIcon size={12} strokeWidth={1.8} />
              {other === "ja" ? "日本語" : "EN"}
            </Link>
            <form action={signOutAction.bind(null, locale)}>
              <button
                type="submit"
                className="flex items-center gap-1.5 rounded-md px-2 py-1 font-mono text-[11px] text-ink-faint hover:bg-paper-deep hover:text-ink"
              >
                <LogOutIcon size={12} strokeWidth={1.8} />
                {t("signOut")}
              </button>
            </form>
          </div>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-40 flex h-14 items-center gap-3 border-b border-line bg-paper px-4 lg:hidden">
          <MobileNav
            email={email}
            locale={locale}
            role={role}
            signOut={signOutAction.bind(null, locale)}
          />
          <span className="wordmark text-[18px] font-bold">AIGTM</span>
        </header>
        <main>
          <div
            data-page
            className="mx-auto max-w-5xl px-4 py-6 sm:px-8 sm:py-8"
          >
            {children}
          </div>
        </main>
      </div>
      <ToastHub messageKey={toast} />
    </div>
  );
}
