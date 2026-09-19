import { useTranslations } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { ArrowUpIcon } from "../(app)/_components/icons";
import { signInAction, signUpAction } from "../../../lib/actions";
import { SubmitButton } from "../(app)/_components/submit-button";
import { HorseMark } from "../(app)/_components/icons";

export default async function LoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { locale } = await params;
  const { error } = await searchParams;
  setRequestLocale(locale);
  return <LoginForm locale={locale} error={error} />;
}

const inputCls =
  "rounded-lg border border-line bg-card px-3.5 py-2.5 text-sm text-ink placeholder:text-ink-faint focus:border-forest focus:outline-none focus:ring-2 focus:ring-mint";

function LoginForm({ locale, error }: { locale: string; error?: string }) {
  const t = useTranslations("auth");
  const app = useTranslations("app");
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <div className="mb-10 text-center">
          <p className="font-mono text-[11px] tracking-label text-ink-faint uppercase">
            {app("tagline")}
          </p>
          <h1 className="mt-4 flex items-center justify-center gap-3 text-forest-deep">
            <HorseMark size={52} />
            <span className="text-[44px] leading-none font-bold tracking-[0.01em]">
              {app("title")}
            </span>
          </h1>
        </div>

        <section className="rounded-xl border border-line bg-card p-6 shadow-card">
          <h2 className="mb-4 font-mono text-[11px] tracking-label text-ink-soft uppercase">
            {t("signIn")}
          </h2>
          {error && (
            <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">
              {error === "locked"
                ? t("errorLocked")
                : error?.startsWith("sso_")
                  ? t("errorSso")
                  : t("errorInvalid")}
            </p>
          )}
          <form action={signInAction.bind(null, locale)} className="flex flex-col gap-3">
            <input name="email" type="email" required placeholder={t("email")} className={inputCls} />
            <input
              name="password"
              type="password"
              required
              placeholder={t("password")}
              className={inputCls}
            />
            <div className="crop-marks mt-1">
              <span className="cm" aria-hidden />
              <SubmitButton className="flex w-full items-center justify-center gap-2 rounded-lg bg-forest px-4 py-2.5 font-mono text-[12px] tracking-[0.08em] text-white uppercase transition-colors hover:bg-forest-deep">
                {t("signIn")}
                <ArrowUpIcon size={13} strokeWidth={2.2} />
              </SubmitButton>
            </div>
          </form>
          {process.env.GOOGLE_OAUTH_CLIENT_ID ? (
            <a
              href="/api/auth/google"
              data-testid="sso-google"
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-line px-4 py-2.5 font-mono text-[12px] tracking-[0.08em] text-ink-soft uppercase transition-colors hover:border-ink-faint"
            >
              {t("signInGoogle")}
            </a>
          ) : null}
        </section>

        <section className="mt-4 rounded-xl border border-dashed border-line bg-card/60 p-6">
          <h2 className="mb-4 font-mono text-[11px] tracking-label text-ink-faint uppercase">
            {t("signUp")}
          </h2>
          <form action={signUpAction.bind(null, locale)} className="flex flex-col gap-3">
            <input name="orgName" required placeholder={t("orgName")} className={inputCls} />
            <input name="name" required placeholder={t("name")} className={inputCls} />
            <input name="email" type="email" required placeholder={t("email")} className={inputCls} />
            <input
              name="password"
              type="password"
              required
              placeholder={t("password")}
              className={inputCls}
            />
            <SubmitButton className="mt-1 flex items-center justify-center gap-2 rounded-lg border border-forest px-4 py-2.5 font-mono text-[12px] tracking-[0.08em] text-forest uppercase transition-colors hover:bg-mint">
              {t("signUp")}
            </SubmitButton>
          </form>
        </section>
      </div>
    </main>
  );
}
