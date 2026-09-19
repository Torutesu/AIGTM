export const dynamic = "force-dynamic";
import { getTranslations } from "next-intl/server";
import { setRequestLocale } from "next-intl/server";
import { requireSession } from "../../../../lib/session";
import { ensureDb } from "../../../../lib/db";
import { PageHeader } from "../_components/ui";
import { AskThread } from "../_components/ask-thread";

export default async function AskPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await ensureDb();
  await requireSession(locale);
  const t = await getTranslations("ask");
  return (
    <div>
      <PageHeader eyebrow={t("eyebrow")} title={t("title")} meta={t("meta")} />
      <AskThread />
    </div>
  );
}
