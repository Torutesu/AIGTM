export const dynamic = "force-dynamic";
import { useTranslations } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { eq } from "drizzle-orm";
import { schema, withOrg } from "@aigtm/db";
import { ensureDb } from "../../../../lib/db";
import { requireSession } from "../../../../lib/session";
import {
  updateMemberRoleAction,
  addMemberAction,
  removeMemberAction,
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

  return (
    <SettingsView
      locale={locale}
      members={members}
      selfId={session.userId}
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
}: {
  locale: string;
  members: MemberRow[];
  selfId: string;
}) {
  const t = useTranslations("settings");
  return (
    <div>
      <PageHeader
        eyebrow={t("eyebrow")}
        title={t("title")}
        meta={t("memberCount", { count: members.length })}
      />

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
