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

test("editing a draft then approving dispatches (mock) and writes audit", async ({ page }) => {
  await page.goto("/en/approvals");
  await page.getByText("pending").first().click();
  await page.getByRole("button", { name: "Edit" }).click();
  await page.locator("textarea").fill("Edited body for e2e");
  await expect(page.getByText("Your changes")).toBeVisible();
  await page.getByRole("button", { name: "Approve edited" }).click();
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("approved").first()).toBeVisible();
  await expect(page.getByText("Edited body for e2e")).toBeVisible();

  await page.goto("/en/audit");
  await expect(page.getByText("approval.decided").first()).toBeVisible();
  await expect(page.getByText("outbox.dispatched").first()).toBeVisible();
});

test("dismissing with a reason records it", async ({ page }) => {
  await page.goto("/en/approvals");
  await page.getByText("pending").first().click();
  await page.getByRole("button", { name: "Dismiss", exact: true }).click();
  await page.getByPlaceholder("Why is this being dismissed?").fill("not relevant");
  await page.getByRole("button", { name: "Confirm dismiss" }).click();
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("rejected").first()).toBeVisible();
  await expect(page.getByText("not relevant")).toBeVisible();
});

test("running an agent creates a fulfilled run", async ({ page }) => {
  await page.goto("/en/agents");
  const card = page.getByTestId("agent-card").first();
  await card.getByRole("button", { name: "Run now" }).click();
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("fulfilled").first()).toBeVisible();
});

test("accounts list navigates to account 360", async ({ page }) => {
  await page.goto("/en/accounts");
  await page.locator("tbody a").first().click();
  await page.waitForURL("**/en/accounts/*");
  await expect(page.getByText("Timeline")).toBeVisible();
  await expect(page.getByText("Knowledge")).toBeVisible();
});

test("agent card navigates to agent detail with runs", async ({ page }) => {
  await page.goto("/en/agents");
  await page.getByTestId("agent-card").first().getByRole("link").first().click();
  await page.waitForURL("**/en/agents/*");
  await expect(page.getByText("Pipeline")).toBeVisible();
  await expect(page.getByText("Runs")).toBeVisible();
});

test("deals, contacts and signals pages render", async ({ page }) => {
  await page.goto("/en/deals");
  await expect(page.getByRole("heading", { name: "Opportunities" })).toBeVisible();
  await page.goto("/en/contacts");
  await expect(page.getByRole("heading", { name: "Contacts" })).toBeVisible();
  await page.goto("/en/signals");
  await expect(page.getByTestId("signal-def").first()).toBeVisible();
});

test("command palette opens and navigates", async ({ page }) => {
  await page.getByRole("button", { name: /Search or jump to/ }).click();
  await page.getByPlaceholder("Go to a page…").fill("appro");
  await page.keyboard.press("Enter");
  await page.waitForURL("**/en/approvals");
});

test("inbox shows stats dashboard", async ({ page }) => {
  await expect(
    page.getByRole("link", { name: "Awaiting review" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Signals · 7d" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Agents live" })).toBeVisible();
});

test("unknown record shows 404 page", async ({ page }) => {
  await page.goto("/en/accounts/00000000-0000-0000-0000-000000000000");
  await expect(page.getByText("Page not found")).toBeVisible();
});

test("mobile viewport shows drawer nav", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto("/en/login");
  const signIn = page.locator("form").filter({ hasText: "Sign in" });
  await signIn.getByPlaceholder("Email").fill("admin@aigtm.local");
  await signIn.getByPlaceholder("Password").fill("admin-password");
  await signIn.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/en/inbox");
  await page.getByRole("button", { name: "Menu" }).click();
  await expect(page.getByRole("link", { name: "Approvals" })).toBeVisible();
  await ctx.close();
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
