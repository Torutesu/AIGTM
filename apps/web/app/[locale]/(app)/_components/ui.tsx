import type { ReactNode } from "react";

export function PageHeader({
  eyebrow,
  title,
  meta,
  children,
}: {
  eyebrow: string;
  title: string;
  meta?: string;
  children?: ReactNode;
}) {
  return (
    <header className="mb-8 flex items-end justify-between gap-6">
      <div>
        <p className="font-mono text-[11px] tracking-label text-ink-faint uppercase">
          {eyebrow}
          {meta ? <span className="ml-3 text-ink-soft normal-case tracking-normal">{meta}</span> : null}
        </p>
        <h1 className="mt-2 text-[28px] leading-tight font-semibold tracking-tight text-forest-deep">
          {title}
        </h1>
      </div>
      {children ? <div className="flex items-center gap-3">{children}</div> : null}
    </header>
  );
}

export type ChipTone = "live" | "neutral" | "pending" | "good" | "bad" | "info";

const chipTones: Record<ChipTone, string> = {
  live: "bg-mint text-mint-ink",
  good: "bg-mint text-mint-ink",
  neutral: "bg-paper-deep text-ink-soft",
  pending: "bg-amber-soft text-amber-ink",
  bad: "bg-red-soft text-red-ink",
  info: "bg-sky-soft text-sky-ink",
};

export function Chip({
  tone = "neutral",
  children,
  dot,
  pulse,
}: {
  tone?: ChipTone;
  children: ReactNode;
  dot?: boolean;
  pulse?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-mono text-[10px] tracking-[0.06em] uppercase ${chipTones[tone]}`}
    >
      {dot ? (
        <span
          className={`size-1.5 rounded-full bg-current ${pulse ? "animate-pulse-dot" : ""}`}
        />
      ) : null}
      {children}
    </span>
  );
}

export function statusTone(status: string): ChipTone {
  switch (status) {
    case "approved":
    case "fulfilled":
    case "live":
    case "dispatched":
      return "good";
    case "rejected":
    case "failed":
    case "cancelled":
      return "bad";
    case "pending":
    case "running":
      return "pending";
    default:
      return "neutral";
  }
}

export function Card({
  children,
  className = "",
  ...rest
}: {
  children: ReactNode;
  className?: string;
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`rounded-xl border border-line bg-card shadow-card ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}

export function EmptyState({ label, hint }: { label: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-dashed border-line bg-card/60 px-6 py-10 text-center">
      <p className="font-mono text-[11px] tracking-label text-ink-faint uppercase">
        {label}
      </p>
      {hint ? <p className="mt-2 text-sm text-ink-soft">{hint}</p> : null}
    </div>
  );
}

/** Segmented dash score — Lightfield-style glanceable meter. score: 0–1. */
export function ScoreBar({ score }: { score: number | string | null | undefined }) {
  const n = typeof score === "string" ? Number(score) : (score ?? 0);
  const pct = Math.max(0, Math.min(100, Math.round(n <= 1 ? n * 100 : n)));
  const filled = Math.round(pct / 100 * 6);
  const tone =
    pct >= 70 ? "bg-forest" : pct >= 40 ? "bg-amber-ink" : "bg-ink-faint";
  return (
    <span className="inline-flex items-center gap-2">
      <span className="flex items-center gap-[3px]">
        {Array.from({ length: 6 }, (_, i) => (
          <span
            key={i}
            className={`h-[3px] w-3.5 rounded-full ${i < filled ? tone : "bg-line"}`}
          />
        ))}
      </span>
      <span className="font-mono text-[11px] text-ink-soft tabular-nums">
        {pct}
      </span>
    </span>
  );
}

export function timeAgo(date: Date | string, locale: string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const diff = Date.now() - d.getTime();
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const mins = Math.round(diff / 60000);
  if (mins < 1) return rtf.format(0, "minute");
  if (mins < 60) return rtf.format(-mins, "minute");
  const hours = Math.round(mins / 60);
  if (hours < 24) return rtf.format(-hours, "hour");
  const days = Math.round(hours / 24);
  if (days < 30) return rtf.format(-days, "day");
  return d.toLocaleDateString(locale === "ja" ? "ja-JP" : "en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function stamp(date: Date | string, locale: string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleString(locale === "ja" ? "ja-JP" : "en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
