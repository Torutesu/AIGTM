"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { CheckIcon, XIcon } from "./icons";

const TOAST_COOKIE = "aigtm_toast";

/**
 * Flash toast. The server action sets a short-lived cookie; on the next
 * render the layout mounts this with the message key. It deletes the
 * cookie on mount and auto-dismisses.
 */
export function ToastHub({ messageKey }: { messageKey: string | null }) {
  const t = useTranslations("toast");
  const [visible, setVisible] = useState<string | null>(null);

  useEffect(() => {
    if (!messageKey) return;
    // consume the flash cookie so it doesn't reappear on refresh
    document.cookie = `${TOAST_COOKIE}=; path=/; max-age=0`;
    setVisible(messageKey);
    const timer = setTimeout(() => setVisible(null), 4000);
    return () => clearTimeout(timer);
  }, [messageKey]);

  if (!visible) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="animate-toast-in fixed right-5 bottom-5 z-[60] flex items-center gap-2.5 rounded-lg border border-line bg-card py-2.5 pr-3 pl-4 shadow-raised"
    >
      <span className="flex size-5 items-center justify-center rounded-full bg-mint text-mint-ink">
        <CheckIcon size={11} strokeWidth={2.6} />
      </span>
      <span className="text-[13px] font-medium text-ink">
        {t(visible as Parameters<typeof t>[0])}
      </span>
      <button
        type="button"
        aria-label={t("dismiss")}
        onClick={() => setVisible(null)}
        className="ml-1 rounded p-0.5 text-ink-faint hover:text-ink"
      >
        <XIcon size={12} strokeWidth={2.2} />
      </button>
    </div>
  );
}
