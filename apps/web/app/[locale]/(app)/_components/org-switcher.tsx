import { getTranslations } from "next-intl/server";
import { switchOrgAction } from "../../../../lib/actions";
import { BuildingIcon } from "./icons";

export interface OrgOption {
  orgId: string;
  name: string;
  role: string;
}

/**
 * Server-rendered org picker — native <details>, zero client JS. Rendered
 * only when the user belongs to more than one org. Org choice lives in
 * server-side session state, never in a cookie.
 */
export async function OrgSwitcher({
  locale,
  orgs,
  currentOrgId,
}: {
  locale: string;
  orgs: OrgOption[];
  currentOrgId: string;
}) {
  if (orgs.length < 2) return null;
  const t = await getTranslations("nav");
  const current = orgs.find((o) => o.orgId === currentOrgId) ?? orgs[0];
  return (
    <details className="group relative mb-2">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg border border-line bg-card px-3 py-2 text-[13px] text-ink transition-colors hover:border-ink-faint [&::-webkit-details-marker]:hidden">
        <BuildingIcon size={13} strokeWidth={1.8} className="shrink-0 text-ink-faint" />
        <span className="min-w-0 flex-1 truncate font-medium">{current.name}</span>
        <span className="font-mono text-[10px] text-ink-faint transition-transform group-open:rotate-180">
          ▾
        </span>
      </summary>
      <div className="absolute bottom-full left-0 z-30 mb-1 w-full overflow-hidden rounded-lg border border-line bg-card shadow-card">
        <p className="border-b border-line-soft px-3 py-1.5 font-mono text-[10px] tracking-label text-ink-faint uppercase">
          {t("switchOrg")}
        </p>
        {orgs.map((o) => (
          <form key={o.orgId} action={switchOrgAction.bind(null, locale)}>
            <input type="hidden" name="orgId" value={o.orgId} />
            <button
              type="submit"
              disabled={o.orgId === currentOrgId}
              className={`flex w-full items-center justify-between px-3 py-2 text-left text-[13px] transition-colors ${
                o.orgId === currentOrgId
                  ? "bg-mint/40 font-medium text-forest-deep"
                  : "text-ink-soft hover:bg-paper-deep"
              }`}
            >
              <span className="truncate">{o.name}</span>
              <span className="ml-2 font-mono text-[10px] text-ink-faint">{o.role}</span>
            </button>
          </form>
        ))}
      </div>
    </details>
  );
}
