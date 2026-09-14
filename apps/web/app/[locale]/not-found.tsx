import { useTranslations } from "next-intl";
import { Link } from "../../i18n/routing";

export default function LocaleNotFound() {
  const t = useTranslations("notFound");
  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-6">
      <div className="max-w-md text-center">
        <p className="font-mono text-[11px] tracking-label text-ink-faint uppercase">
          404
        </p>
        <h1 className="mt-3 text-[22px] font-semibold tracking-tight text-forest-deep">
          {t("title")}
        </h1>
        <p className="mt-2 text-[13.5px] text-ink-soft">{t("body")}</p>
        <Link
          href="/inbox"
          className="mt-6 inline-block rounded-lg bg-forest px-5 py-2.5 font-mono text-[11px] tracking-[0.06em] text-white uppercase hover:bg-forest-deep"
        >
          {t("back")}
        </Link>
      </div>
    </div>
  );
}
