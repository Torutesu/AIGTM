# 09 — GA readiness: design + implementation record

External-sale blockers tracked to closure. Billing is deliberately out of
scope. Verdict at the bottom is updated as items land.

## Blocker 1 — multi-org users (org switcher)

**Problem.** `addMemberAction` can attach one user to several orgs, but
`signIn`/`getSession` take the *first* membership row — the user is pinned
to an arbitrary org with no way to reach the others.

**Design.**

- `sessions.org_id` (nullable): the org the session currently acts as.
  `signIn`/`ssoSignIn` write it; `getSession` resolves the membership for
  `session.orgId` first, falling back to the first membership for sessions
  minted before the column existed.
- `switchOrg(handle, {userId, token, orgId})`: verifies a membership row
  exists for the target org (no membership → error, no silent cross-tenant
  hop), updates `sessions.org_id`, returns the fresh `SessionInfo`.
- UI: org chip in the sidebar footer. Rendered only when the user has ≥2
  memberships — zero noise for the common single-org case. Each entry is a
  form posting `switchOrgAction`; the session cookie is unchanged (org is
  server-side state).

**Security note.** Org choice is *server-side session state*, never a
client cookie — a forged request cannot select an org the user is not a
member of, and RLS still applies on every query.

## Blocker 2 — sign-up email verification

**Problem.** Any address can register an org; there is no proof of mailbox
ownership. For external sale that invites throwaway/spoofed tenants.

**Design.**

- Gate: `AIGTM_EMAIL_VERIFICATION=1` requires verification. Off by default
  so internal/dev flows (and every existing test) are untouched. When on,
  `AIGTM_RESEND_API_KEY` + `AIGTM_EMAIL_FROM` must be set — fail closed,
  because silently skipping verification is worse than an honest error.
- `users` gains `email_verified_at`, `verify_code_hash`,
  `verify_code_expires_at`, `verify_attempts`. The code is a 6-digit OTP,
  stored only as sha256, 15-minute TTL, 5 attempts max.
- Flows:
  - `signUp` → user created unverified → code issued + Resend send →
    `/verify`. No session until verified.
  - `signIn` on an unverified account → fresh code + `/verify` (can't
    bypass by signing in instead).
  - `ssoSignIn` (Google) → `email_verified_at` stamped immediately — the
    IdP already proved the mailbox.
  - `addMemberAction`-created users → verified at creation (admin
    provisioned; the member still owns the password).
- `/[locale]/verify` — standalone page (sibling of `/login`), en/ja.

## Blocker 3 — real Google API verification

**Problem.** OAuth connect + token refresh + Gmail/Calendar sync are coded
and mock-tested, but never run against real Google endpoints.

**Design.** The remaining work is credential creation (Google Console),
which only the owner can do — the code side gets a verifier so the moment
credentials exist the whole path is checked in one command:

- `pnpm --filter @aigtm/agent-runtime google-check <orgId>` — reads the
  org's stored connector config, performs a real refresh-token exchange,
  then calls Gmail (`users.getProfile`) and Calendar (`calendarList.list`)
  and prints account + mailbox total + calendar count. Exercises the same
  code the worker uses, not a parallel path.
- `docs/07` gains the exact Google Console steps (OAuth client type,
  scopes, redirect URI) so the manual part is a 5-minute checklist.

## Implementation record

| Item | Files | Tests |
|---|---|---|
| sessions.org_id + users verify columns | `packages/db/src/schema.ts`, `migrations/0006_left_vanisher.sql` | applied on real pg16 |
| auth: org-pinned sessions, switchOrg, OTP issue/verify, verified stamps | `packages/auth/src/index.ts` | `index.test.ts` +3 (9 total) |
| org switcher UI | `_components/org-switcher.tsx`, `layout.tsx`, `mobile-nav.tsx`, `actions.ts` | e2e "multi-org user can switch workspaces" |
| email verification | `lib/mail.ts`, `verify/page.tsx`, `actions.ts`, login flow | auth unit (OTP path); page smoke via e2e |
| google-check | `packages/agent-runtime/src/google-check.ts` | manual (needs real creds) |
| docs | `docs/07` (env table, Google steps, verification section, checklist), `docs/09` | — |

### Verdict after this pass

- **Internal release: ready.**
- **External sale: all code blockers closed except billing (out of
  scope).** The only remaining item is the *manual* Google Console step —
  credentials, scope approval, one real `google-check` run. Multi-org
  isolation, sign-up verification, and tenant switching are implemented
  and tested.
