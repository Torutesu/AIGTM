import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  // seeded admin credentials (see packages/db/src/seed.ts)
  await page.goto("/en/login");
  const signIn = page.locator("form").filter({ hasText: "Sign in" });
  await signIn.getByPlaceholder("Email").fill("admin@aigtm.local");
  await signIn.getByPlaceholder("Password").fill("admin-password");
  await signIn.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/en/inbox");
});

test("inbox shows pending approvals and signals", async ({ page }) => {
  await expect(page.getByTestId("approval-item").first()).toBeVisible();
  await expect(page.getByTestId("signal-event").first()).toBeVisible();
});

test("approving a pending item dispatches (mock) and writes audit", async ({ page }) => {
  await page.goto("/en/inbox");
  const first = page.getByTestId("approval-item").first();
  await expect(first).toBeVisible();
  await first.getByTestId("approve-button").click();
  await page.waitForLoadState("networkidle");

  await page.goto("/en/approvals");
  await expect(page.getByText("approved").first()).toBeVisible();

  await page.goto("/en/audit");
  await expect(page.getByText("approval.decided").first()).toBeVisible();
  await expect(page.getByText("outbox.dispatched").first()).toBeVisible();
});

test("running an agent creates a fulfilled run", async ({ page }) => {
  await page.goto("/en/agents");
  const card = page.getByTestId("agent-card").first();
  await card.getByRole("button", { name: "Run now" }).click();
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("fulfilled").first()).toBeVisible();
});

test("ja locale renders Japanese UI", async ({ page }) => {
  await page.goto("/ja/inbox");
  await expect(
    page.getByRole("heading", { name: "今対応が必要なもの" }),
  ).toBeVisible();
});

test("unauthenticated user is redirected to login", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto("/en/inbox");
  await page.waitForURL("**/en/login");
  await ctx.close();
});
