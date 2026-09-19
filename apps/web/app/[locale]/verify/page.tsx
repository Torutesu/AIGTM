import { useTranslations } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { ArrowUpIcon, HorseMark } from "../(app)/_components/icons";
import {
  verifyEmailAction,
  resendVerificationAction,
} from "../../../lib/actions";
import { SubmitButton } from "../(app)/_components/submit-button";

const inputCls =
  "rounded-lg border border-line bg-card px-3.5 py-2.5 text-sm text-ink placeholder:text-ink-faint focus:border-forest focus:outline-none focus:ring-2 focus:ring-mint";

export default async function VerifyPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ email?: string; error?: string; sent?: string }>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);
  return <VerifyForm locale={locale} email={sp.email ?? ""} error={sp.error} sent={sp.sent === "1"} />;
}

const ERROR_KEYS: Record<string, string> = {
  invalid: "errorInvalid",
  expired: "errorExpired",
  locked: "errorLocked",
  password: "errorPassword",
  mail: "errorMail",
};

function VerifyForm({
  locale,
  email,
  error,
  sent,
}: {
  locale: string;
  email: string;
  error?: string;
  sent: boolean;
}) {
  const t = useTranslations("verify");
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
            {t("title")}
          </h2>
          {error ? (
            <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">
              {t(ERROR_KEYS[error] ?? "errorInvalid")}
            </p>
          ) : sent ? (
            <p className="mb-3 rounded-lg border border-mint bg-mint/40 px-3 py-2 text-[13px] text-forest-deep">
              {t("sent")}
            </p>
          ) : null}
          <p className="mb-4 text-[13px] text-ink-soft">{t("body")}</p>
          <form action={verifyEmailAction.bind(null, locale)} className="flex flex-col gap-3">
            <input
              name="email"
              type="email"
              required
              defaultValue={email}
              placeholder={t("email")}
              className={inputCls}
            />
            <input
              name="code"
              required
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder={t("code")}
              className={`${inputCls} font-mono tracking-[0.3em]`}
            />
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
                {t("verify")}
                <ArrowUpIcon size={13} strokeWidth={2.2} />
              </SubmitButton>
            </div>
          </form>
          <form action={resendVerificationAction.bind(null, locale)} className="mt-3">
            <input type="hidden" name="email" value={email} />
            <SubmitButton className="w-full rounded-lg px-4 py-2 font-mono text-[11px] tracking-[0.08em] text-ink-faint uppercase transition-colors hover:text-ink">
              {t("resend")}
            </SubmitButton>
          </form>
        </section>
      </div>
    </main>
  );
}
