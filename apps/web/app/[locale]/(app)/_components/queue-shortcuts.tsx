"use client";

import { useEffect } from "react";

/**
 * Linear-style j/k navigation for the approval queue. Moves selection by
 * clicking the next/prev queue-item link (keeps Next Link client nav).
 * Ignores keystrokes while typing in a field or when a modifier is held.
 */
export function QueueShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement;
      if (
        el.tagName === "INPUT" ||
        el.tagName === "TEXTAREA" ||
        el.tagName === "SELECT" ||
        el.isContentEditable
      ) {
        return;
      }
      if (e.key !== "j" && e.key !== "k") return;
      const links = Array.from(
        document.querySelectorAll<HTMLAnchorElement>(
          'li[data-testid="queue-item"] a',
        ),
      );
      if (!links.length) return;
      const cur = links.findIndex((a) => a.getAttribute("aria-current") === "true");
      const next =
        e.key === "j"
          ? Math.min((cur < 0 ? -1 : cur) + 1, links.length - 1)
          : Math.max((cur < 0 ? links.length : cur) - 1, 0);
      links[next]?.click();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return null;
}
