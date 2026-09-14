"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "../../../../i18n/routing";
import {
  InboxIcon,
  BotIcon,
  ShieldCheckIcon,
  FileTextIcon,
} from "./icons";

type IconComponent = (p: {
  size?: number;
  strokeWidth?: number;
  className?: string;
}) => ReactNode;

const items: { href: string; key: string; icon: IconComponent }[] = [
  { href: "/inbox", key: "inbox", icon: InboxIcon },
  { href: "/agents", key: "agents", icon: BotIcon },
  { href: "/approvals", key: "approvals", icon: ShieldCheckIcon },
  { href: "/audit", key: "audit", icon: FileTextIcon },
];

export function SideNav() {
  const t = useTranslations("nav");
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-0.5">
      {items.map(({ href, key, icon: Icon }) => {
        const active = pathname.startsWith(href);
        return (
          <Link
            key={key}
            href={href}
            className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px] transition-colors ${
              active
                ? "bg-paper-deep font-medium text-forest-deep"
                : "text-ink-soft hover:bg-paper-deep/60 hover:text-ink"
            }`}
          >
            <Icon
              size={15}
              strokeWidth={1.8}
              className={active ? "text-forest" : "text-ink-faint"}
            />
            {t(key)}
          </Link>
        );
      })}
    </nav>
  );
}
