export const dynamic = "force-dynamic";
import { useTranslations } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { eq } from "drizzle-orm";
import {
  schema,
  withOrg,
  decryptSecret,
  maskSecret,
  type OrgProviderConfig,
} from "@aigtm/db";
import { ensureDb } from "../../../../lib/db";
import { requireSession } from "../../../../lib/session";
import {
  updateMemberRoleAction,
  addMemberAction,
  removeMemberAction,
  saveProviderKeyAction,
  removeProviderKeyAction,
  saveRoutingAction,
} from "../../../../lib/actions";
import { PageHeader, Card, Chip, EmptyState } from "../_components/ui";
import { SubmitButton } from "../_components/submit-button";

interface MemberRow {
  userId: string;
  role: string;
  name: string;
  email: string;
}

const ROLES = ["viewer", "editor", "admin"] as const;

const MODEL_ROLES = ["reasoning", "fast", "writing", "japanese"] as const;

/** Route options shown in the role selects; validated server-side. */
const ROUTE_OPTIONS: { value: string; label: string }[] = [
  { value: "mock", label: "Mock (deterministic)" },
  { value: "openai", label: "OpenAI (role default)" },
  { value: "openai:gpt-4.1", label: "OpenAI · gpt-4.1" },
  { value: "openai:gpt-4.1-mini", label: "OpenAI · gpt-4.1-mini" },
  { value: "anthropic", label: "Anthropic (role default)" },
  { value: "anthropic:claude-sonnet-4-5", label: "Anthropic · claude-sonnet-4-5" },
  { value: "anthropic:claude-haiku-4-5", label: "Anthropic · claude-haiku-4-5" },
  { value: "anthropic:claude-opus-4-5", label: "Anthropic · claude-opus-4-5" },
];

const PROVIDER_LABELS: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
};

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await requireSession(locale);

  if (session.role !== "admin") {
    return <Restricted locale={locale} />;
  }

  const handle = await ensureDb();
  // memberships/users are not RLS tenant tables — filter org explicitly.
  const members = (await withOrg(
    handle,
    { orgId: session.orgId, userId: session.userId },
    (tx) =>
      tx
        .select({
          userId: schema.memberships.userId,
          role: schema.memberships.role,
          name: schema.users.name,
          email: schema.users.email,
        })
        .from(schema.memberships)
        .innerJoin(schema.users, eq(schema.memberships.userId, schema.users.id))
        .where(eq(schema.memberships.orgId, session.orgId)),
  )) as MemberRow[];

  // BYOK state: org key (masked) or env fallback or unset — never plaintext.
  const [org] = (await handle.db
    .select({ providerConfig: schema.organizations.providerConfig })
    .from(schema.organizations)
    .where(eq(schema.organizations.id, session.orgId))
    .limit(1)) as { providerConfig: OrgProviderConfig | null }[];
  const cfg = org?.providerConfig ?? {};
  const providerState = (["openai", "anthropic"] as const).map((id) => {
    const stored = cfg.keys?.[id];
    const plain = stored ? decryptSecret(stored) : null;
    return {
      id,
      masked: plain ? maskSecret(plain) : null,
      viaEnv:
        !plain && !!process.env[`${id === "openai" ? "OPENAI" : "ANTHROPIC"}_API_KEY`],
    };
  });
  const roles = cfg.roles ?? {};

  return (
    <SettingsView
      locale={locale}
      members={members}
      selfId={session.userId}
      providers={providerState}
      roles={roles}
    />
  );
}

function Restricted({ locale }: { locale: string }) {
  const t = useTranslations("settings");
  void locale;
  return (
    <div>
      <PageHeader eyebrow={t("eyebrow")} title={t("title")} />
      <Card className="px-5 py-8 text-center">
        <p className="font-mono text-[12px] text-ink-faint">{t("adminOnly")}</p>
      </Card>
    </div>
  );
}

function SettingsView({
  locale,
  members,
  selfId,
  providers,
  roles,
}: {
  locale: string;
  members: MemberRow[];
  selfId: string;
  providers: { id: string; masked: string | null; viaEnv: boolean }[];
  roles: Partial<Record<string, string>>;
}) {
  const t = useTranslations("settings");
  return (
    <div>
      <PageHeader
        eyebrow={t("eyebrow")}
        title={t("title")}
        meta={t("memberCount", { count: members.length })}
      />

      {/* BYOK: org-level provider keys */}
      <Card className="mb-8 px-5 py-4" data-testid="providers-card">
        <p className="mb-1 font-mono text-[10px] tracking-label text-ink-faint uppercase">
          {t("providers")}
        </p>
        <p className="mb-4 font-mono text-[11px] leading-relaxed text-ink-faint">
          {t("providersNote")}
        </p>
        <div className="space-y-3">
          {providers.map((p) => (
            <div
              key={p.id}
              data-testid={`provider-${p.id}`}
              className="flex flex-wrap items-center gap-3"
            >
              <span className="w-24 font-mono text-[12px] text-ink">
                {PROVIDER_LABELS[p.id]}
              </span>
              {p.masked ? (
                <Chip tone="good">{`${t("configured")} ${p.masked}`}</Chip>
              ) : p.viaEnv ? (
                <Chip tone="info">{t("fromEnv")}</Chip>
              ) : (
                <Chip tone="neutral">{t("notSet")}</Chip>
              )}
              <form
                action={saveProviderKeyAction.bind(null, locale)}
                className="flex items-center gap-2"
              >
                <input type="hidden" name="provider" value={p.id} />
                <input
                  name="key"
                  type="password"
                  required
                  autoComplete="off"
                  placeholder={t("keyPlaceholder")}
                  className="w-64 rounded-lg border border-line bg-paper px-3 py-1.5 font-mono text-[12px] text-ink outline-none placeholder:text-ink-faint focus:border-forest"
                />
                <SubmitButton className="rounded-md border border-line px-2.5 py-1.5 font-mono text-[10.5px] tracking-[0.04em] text-ink-soft uppercase hover:border-ink-faint">
                  {t("save")}
                </SubmitButton>
              </form>
              {p.masked ? (
                <form action={removeProviderKeyAction.bind(null, locale)}>
                  <input type="hidden" name="provider" value={p.id} />
                  <SubmitButton className="rounded-md px-2 py-1.5 font-mono text-[10.5px] tracking-[0.04em] text-red-ink uppercase hover:bg-red-ink/10">
                    {t("removeKey")}
                  </SubmitButton>
                </form>
              ) : null}
            </div>
          ))}
        </div>
      </Card>

      {/* Per-role model routing */}
      <Card className="mb-8 px-5 py-4" data-testid="routing-card">
        <p className="mb-1 font-mono text-[10px] tracking-label text-ink-faint uppercase">
          {t("routing")}
        </p>
        <p className="mb-4 font-mono text-[11px] leading-relaxed text-ink-faint">
          {t("routingNote")}
        </p>
        <form
          action={saveRoutingAction.bind(null, locale)}
          className="flex flex-wrap items-end gap-4"
        >
          {MODEL_ROLES.map((role) => (
            <label key={role} className="flex flex-col gap-1">
              <span className="font-mono text-[10px] text-ink-faint">
                {t(`role${role[0].toUpperCase()}${role.slice(1)}`)}
              </span>
              <select
                name={`role_${role}`}
                defaultValue={roles[role] ?? ""}
                data-testid={`route-${role}`}
                className="w-56 rounded-lg border border-line bg-paper px-2.5 py-2 text-[12px] text-ink outline-none focus:border-forest"
              >
                <option value="">{t("routeDefault")}</option>
                {ROUTE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <SubmitButton className="rounded-lg bg-forest px-4 py-2 font-mono text-[11px] tracking-[0.06em] text-white uppercase hover:bg-forest-deep">
            {t("save")}
          </SubmitButton>
        </form>
      </Card>

      <Card className="mb-8 px-5 py-4">
        <p className="mb-3 font-mono text-[10px] tracking-label text-ink-faint uppercase">
          {t("addMember")}
        </p>
        <form
          action={addMemberAction.bind(null, locale)}
          className="flex flex-wrap items-end gap-3"
        >
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] text-ink-faint">
              {t("email")}
            </span>
            <input
              name="email"
              type="email"
              required
              placeholder="teammate@corp.example"
              className="w-56 rounded-lg border border-line bg-paper px-3 py-2 text-[13px] text-ink outline-none placeholder:text-ink-faint focus:border-forest"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] text-ink-faint">
              {t("name")}
            </span>
            <input
              name="name"
              placeholder={t("namePlaceholder")}
              className="w-40 rounded-lg border border-line bg-paper px-3 py-2 text-[13px] text-ink outline-none placeholder:text-ink-faint focus:border-forest"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] text-ink-faint">
              {t("password")}
            </span>
            <input
              name="password"
              type="password"
              required
              minLength={8}
              className="w-40 rounded-lg border border-line bg-paper px-3 py-2 text-[13px] text-ink outline-none focus:border-forest"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] text-ink-faint">
              {t("role")}
            </span>
            <select
              name="role"
              defaultValue="viewer"
              className="w-28 rounded-lg border border-line bg-paper px-2.5 py-2 text-[13px] text-ink outline-none focus:border-forest"
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <SubmitButton className="rounded-lg bg-forest px-4 py-2 font-mono text-[11px] tracking-[0.06em] text-white uppercase hover:bg-forest-deep">
            {t("add")}
          </SubmitButton>
        </form>
      </Card>

      {members.length === 0 ? (
        <EmptyState label={t("empty")} />
      ) : (
        <Card className="divide-y divide-line-soft">
          {members.map((m) => (
            <div
              key={m.userId}
              data-testid="member-row"
              className="flex flex-wrap items-center gap-4 px-5 py-3.5"
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-forest font-mono text-[12px] text-white">
                {m.name.slice(0, 1).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13.5px] font-medium text-ink">
                  {m.name}
                  {m.userId === selfId ? (
                    <span className="ml-2 font-mono text-[10px] text-ink-faint">
                      ({t("you")})
                    </span>
                  ) : null}
                </p>
                <p className="truncate font-mono text-[11px] text-ink-faint">
                  {m.email}
                </p>
              </div>
              {m.userId === selfId ? (
                <Chip tone="info">{m.role}</Chip>
              ) : (
                <>
                  <form
                    action={updateMemberRoleAction.bind(null, locale)}
                    className="flex items-center gap-2"
                  >
                    <input type="hidden" name="userId" value={m.userId} />
                    <select
                      name="role"
                      defaultValue={m.role}
                      data-testid={`role-${m.userId}`}
                      className="rounded-md border border-line bg-paper px-2 py-1.5 font-mono text-[11.5px] text-ink outline-none focus:border-forest"
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                    <SubmitButton className="rounded-md border border-line px-2.5 py-1.5 font-mono text-[10.5px] tracking-[0.04em] text-ink-soft uppercase hover:border-ink-faint">
                      {t("save")}
                    </SubmitButton>
                  </form>
                  <details>
                    <summary className="cursor-pointer list-none rounded-md border border-line px-2.5 py-1.5 font-mono text-[10.5px] tracking-[0.04em] text-red-ink uppercase hover:border-red-ink/40">
                      {t("remove")}
                    </summary>
                    <form
                      action={removeMemberAction.bind(null, locale)}
                      className="mt-2 flex items-center gap-2"
                    >
                      <input type="hidden" name="userId" value={m.userId} />
                      <span className="font-mono text-[10.5px] text-ink-faint">
                        {t("removeConfirm")}
                      </span>
                      <SubmitButton className="rounded-md bg-red-ink px-2.5 py-1 font-mono text-[10.5px] tracking-[0.04em] text-white uppercase">
                        {t("remove")}
                      </SubmitButton>
                    </form>
                  </details>
                </>
              )}
            </div>
          ))}
        </Card>
      )}
      <p className="mt-4 font-mono text-[11px] leading-relaxed text-ink-faint">
        {t("rolesNote")}
      </p>
    </div>
  );
}
