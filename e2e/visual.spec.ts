import { test, expect, type Page } from "@playwright/test";

/**
 * Whole-app visual smoke: every screen, both locales, plus overlays and
 * mobile viewport. Asserts structural invariants that "display breakage"
 * always violates — error boundary, horizontal overflow, console errors —
 * and saves screenshots for review.
 */

const APP_PAGES = [
  "inbox",
  "ask",
  "approvals",
  "agents",
  "accounts",
  "deals",
  "contacts",
  "segments",
  "signals",
  "audit",
  "settings",
];

const ERROR_MARKERS = [
  "Internal Server Error",
  "Something went wrong",
  "Application error",
  "This page could not be found",
];

function watch(page: Page) {
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    // React dev build injects caret-color styles on hidden inputs inside
    // server-action forms — a dev-only hydration warning that cannot ship.
    if (m.text().includes("tree hydrated but some attributes")) return;
    problems.push(`console: ${m.text()}`);
  });
  return problems;
}

async function checkPage(
  page: Page,
  url: string,
  name: string,
  problems: string[],
) {
  const res = await page.goto(url, { waitUntil: "networkidle" });
  expect(res?.status(), `${name} status`).toBeLessThan(400);
  await expect(page.locator("main")).toBeVisible();

  const body = await page.locator("body").innerText();
  for (const marker of ERROR_MARKERS) {
    expect(body, `${name} shows "${marker}"`).not.toContain(marker);
  }
  // Next.js dev error overlay must not be showing (the portal host itself
  // is always mounted in dev; the dialog only appears on real errors)
  await expect(
    page.locator("nextjs-portal [data-nextjs-dialog], nextjs-portal nextjs-toast"),
  ).toHaveCount(0);

  // no horizontal overflow — the classic "display broken" symptom
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow, `${name} horizontal overflow`).toBeLessThanOrEqual(1);

  await page.screenshot({ path: `test-results/visual/${name}.png`, fullPage: true });
}

test.beforeEach(async ({ page }) => {
  await page.goto("/en/login");
  const signIn = page.locator("form").filter({ hasText: "Sign in" });
  await signIn.getByPlaceholder("Email").fill("admin@aigtm.local");
  await signIn.getByPlaceholder("Password").fill("admin-password");
  await signIn.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/en/inbox");
});

for (const locale of ["en", "ja"] as const) {
  test.describe(`visual: ${locale}`, () => {
    for (const p of APP_PAGES) {
      test(`/${locale}/${p} renders clean`, async ({ page }) => {
        const problems = watch(page);
        await checkPage(page, `/${locale}/${p}`, `${locale}-${p}`, problems);
        expect(problems, `${p} console/page errors`).toEqual([]);
      });
    }
  });
}

test("detail pages render clean (account, agent, run)", async ({ page }) => {
  const problems = watch(page);

  await checkPage(page, "/en/accounts", "accounts-list", problems);
  await page.locator('main a[href*="/accounts/"]').first().click();
  await page.waitForURL(/\/en\/accounts\/.+/);
  await checkPage(page, page.url().replace(/^https?:\/\/[^/]+/, ""), "account-detail", problems);

  await checkPage(page, "/en/agents", "agents-list", problems);
  await page.locator('main a[href*="/agents/"]').first().click();
  await page.waitForURL(/\/en\/agents\/.+/);
  await checkPage(page, page.url().replace(/^https?:\/\/[^/]+/, ""), "agent-detail", problems);

  const runLink = page.getByRole("link", { name: /fulfilled|running|rejected|View/i }).first();
  if (await runLink.count()) {
    await runLink.click();
    await page.waitForURL(/\/en\/runs\/.+/);
    await checkPage(page, page.url().replace(/^https?:\/\/[^/]+/, ""), "run-detail", problems);
  }
  expect(problems).toEqual([]);
});

test("command palette overlay renders clean", async ({ page }) => {
  const problems = watch(page);
  await page.goto("/en/inbox");
  await page.keyboard.press("Meta+k");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByPlaceholder("Search or go to a page…")).toBeFocused();
  await page.screenshot({ path: "test-results/visual/palette-open.png" });
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  expect(problems).toEqual([]);
});

test("mobile drawer overlay renders clean", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const problems = watch(page);
  await page.goto("/en/login");
  const signIn = page.locator("form").filter({ hasText: "Sign in" });
  await signIn.getByPlaceholder("Email").fill("admin@aigtm.local");
  await signIn.getByPlaceholder("Password").fill("admin-password");
  await signIn.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/en/inbox");

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "mobile inbox overflow").toBeLessThanOrEqual(1);

  await page.getByRole("button", { name: /menu|open/i }).first().click();
  await page.screenshot({ path: "test-results/visual/mobile-drawer.png" });
  await ctx.close();
  expect(problems).toEqual([]);
});

test("login and 404 pages render clean", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const problems = watch(page);

  const res = await page.goto("/en/login");
  expect(res?.status()).toBe(200);
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  await page.screenshot({ path: "test-results/visual/login.png" });

  // login page must not overflow either
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);

  await page.goto("/en/login");
  const signIn = page.locator("form").filter({ hasText: "Sign in" });
  await signIn.getByPlaceholder("Email").fill("admin@aigtm.local");
  await signIn.getByPlaceholder("Password").fill("admin-password");
  await signIn.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/en/inbox");
  // dev-mode streaming commits a 200 before notFound() resolves, so assert
  // the rendered not-found UI rather than the HTTP status
  await page.goto("/en/accounts/00000000-0000-0000-0000-000000000000");
  await expect(page.getByText("Page not found")).toBeVisible();
  await page.screenshot({ path: "test-results/visual/not-found.png" });
  await ctx.close();
  expect(problems.filter((p) => !p.includes("favicon"))).toEqual([]);
});
