"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "../../../../i18n/routing";
import {
  InboxIcon,
  BotIcon,
  ShieldCheckIcon,
  FileTextIcon,
  BuildingIcon,
  ZapIcon,
  UsersIcon,
  BriefcaseIcon,
  LayersIcon,
  SettingsIcon,
} from "./icons";

type IconComponent = (p: {
  size?: number;
  strokeWidth?: number;
  className?: string;
}) => ReactNode;

const groups: {
  key: string;
  items: { href: string; key: string; icon: IconComponent; adminOnly?: boolean }[];
}[] = [
  {
    key: "workspace",
    items: [
      { href: "/inbox", key: "inbox", icon: InboxIcon },
      { href: "/approvals", key: "approvals", icon: ShieldCheckIcon },
      { href: "/agents", key: "agents", icon: BotIcon },
    ],
  },
  {
    key: "records",
    items: [
      { href: "/accounts", key: "accounts", icon: BuildingIcon },
      { href: "/deals", key: "deals", icon: BriefcaseIcon },
      { href: "/contacts", key: "contacts", icon: UsersIcon },
      { href: "/segments", key: "segments", icon: LayersIcon },
    ],
  },
  {
    key: "configure",
    items: [
      { href: "/signals", key: "signals", icon: ZapIcon },
      { href: "/audit", key: "audit", icon: FileTextIcon },
      {
        href: "/settings",
        key: "settings",
        icon: SettingsIcon,
        adminOnly: true,
      },
    ],
  },
];

export function SideNav({ role }: { role?: string }) {
  const t = useTranslations("nav");
  const pathname = usePathname();
  return (
    <div className="flex flex-col gap-6">
      {groups.map((group) => (
        <div key={group.key}>
          <p className="mb-2 px-3 font-mono text-[10px] tracking-label text-ink-faint uppercase">
            {t(group.key)}
          </p>
          <nav className="flex flex-col gap-0.5">
            {group.items
              .filter((i) => !i.adminOnly || role === "admin")
              .map(({ href, key, icon: Icon }) => {
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
        </div>
      ))}
    </div>
  );
}
