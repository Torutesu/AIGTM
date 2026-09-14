"use client";

import { useTranslations } from "next-intl";
import { Card } from "./_components/ui";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("error");
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <Card className="max-w-md px-8 py-8 text-center">
        <p className="font-mono text-[11px] tracking-label text-ink-faint uppercase">
          {t("eyebrow")}
        </p>
        <h1 className="mt-3 text-[20px] font-semibold text-forest-deep">
          {t("title")}
        </h1>
        <p className="mt-2 text-[13px] text-ink-soft">{t("body")}</p>
        {error.digest ? (
          <p className="mt-3 font-mono text-[10.5px] text-ink-faint">
            digest: {error.digest}
          </p>
        ) : null}
        <button
          type="button"
          onClick={reset}
          className="mt-5 rounded-lg bg-forest px-5 py-2.5 font-mono text-[11px] tracking-[0.06em] text-white uppercase hover:bg-forest-deep"
        >
          {t("retry")}
        </button>
      </Card>
    </div>
  );
}
