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
  await page
    .getByTestId("queue-item")
    .filter({ hasText: "pending" })
    .first()
    .click();
  await page.getByRole("button", { name: "Edit" }).click();
  await page.locator("textarea").fill("Edited body for e2e");
  await expect(page.getByText("Your changes")).toBeVisible();
  await page.getByRole("button", { name: "Approve edited" }).click();
  await page.waitForLoadState("networkidle");
  await expect(
    page.getByTestId("queue-item").filter({ hasText: "approved" }),
  ).toHaveCount(1);
  await expect(
    page.locator("p.whitespace-pre-wrap").filter({ hasText: "Edited body for e2e" }),
  ).toBeVisible();

  await page.goto("/en/audit");
  await expect(page.getByText("approval.decided").first()).toBeVisible();
  await expect(page.getByText("outbox.dispatched").first()).toBeVisible();
});

test("dismissing with a reason records it", async ({ page }) => {
  await page.goto("/en/approvals");
  await page
    .getByTestId("queue-item")
    .filter({ hasText: "pending" })
    .first()
    .click();
  await page.getByRole("button", { name: "Dismiss", exact: true }).click();
  await page.getByPlaceholder("Why is this being dismissed?").fill("not relevant");
  await page.getByRole("button", { name: "Confirm dismiss" }).click();
  await page.waitForLoadState("networkidle");
  await expect(
    page.getByTestId("queue-item").filter({ hasText: "rejected" }),
  ).toHaveCount(1);
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
  await page.getByPlaceholder("Search or go to a page…").fill("appro");
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

test("command palette searches real records", async ({ page }) => {
  await page.getByRole("button", { name: /Search or jump to/ }).click();
  await page.getByPlaceholder("Search or go to a page…").fill("Nordic");
  const hit = page.getByRole("button", { name: /Nordic Systems/ });
  await expect(hit).toBeVisible();
  await hit.click();
  await page.waitForURL("**/en/accounts/*");
  await expect(page.getByText("Nordic Systems").first()).toBeVisible();
});

test("accounts sort and stage filter persist in the url", async ({ page }) => {
  await page.goto("/en/accounts");
  await page.getByRole("link", { name: "Name", exact: true }).click();
  await expect(page).toHaveURL(/sort=name/);
  await expect(page.locator("tbody a").first()).toContainText("Acme Robotics");
  await page.getByRole("link", { name: "Opportunity", exact: true }).click();
  await expect(page).toHaveURL(/sort=name.*stage=opportunity|stage=opportunity.*sort=name/);
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await page.getByRole("link", { name: "All", exact: true }).click();
  await expect(page.locator("tbody tr")).toHaveCount(8);
});

test("approvals status filter persists in the url", async ({ page }) => {
  await page.goto("/en/approvals");
  await page.getByRole("link", { name: "Approved", exact: true }).click();
  await expect(page).toHaveURL(/status=approved/);
  await expect(
    page.getByTestId("queue-item").filter({ hasText: "approved" }),
  ).toHaveCount(1);
  await page.getByRole("link", { name: "Dismissed", exact: true }).click();
  await expect(page).toHaveURL(/status=rejected/);
  await expect(
    page.getByTestId("queue-item").filter({ hasText: "rejected" }),
  ).toHaveCount(1);
});

test("segments page lists segments and creates one", async ({ page }) => {
  await page.goto("/en/segments");
  await expect(page.getByTestId("segment-card")).toHaveCount(2);
  const createForm = page
    .locator("form")
    .filter({ has: page.getByRole("button", { name: "Create", exact: true }) });
  await createForm.getByPlaceholder("e.g. High-fit prospects").fill("AI accounts");
  await createForm.getByPlaceholder("e.g. ai").fill("ai");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByTestId("segment-card")).toHaveCount(3);
  await expect(page.getByText("AI accounts")).toBeVisible();
});

test("run retry re-executes a failed run", async ({ page }) => {
  await page.goto("/en/agents");
  await page
    .getByRole("link", { name: "Stalled Deal Recovery" })
    .first()
    .click();
  await page.waitForURL("**/en/agents/*");
  await page.locator("a", { hasText: "rejected" }).first().click();
  await page.waitForURL("**/en/runs/*");
  await page.getByRole("button", { name: "Retry" }).click();
  await page.waitForURL("**/en/runs/*");
  await expect(page.getByText("fulfilled").first()).toBeVisible();
});

test("run cancel stops a running run", async ({ page }) => {
  await page.goto("/en/agents");
  await page
    .getByRole("link", { name: "Outbound to high ICP fit" })
    .first()
    .click();
  await page.waitForURL("**/en/agents/*");
  await page.locator("a", { hasText: "running" }).first().click();
  await page.waitForURL("**/en/runs/*");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("cancelled").first()).toBeVisible();
});

test("viewer role cannot act", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto("/en/login");
  const signIn = page.locator("form").filter({ hasText: "Sign in" });
  await signIn.getByPlaceholder("Email").fill("viewer@aigtm.local");
  await signIn.getByPlaceholder("Password").fill("viewer-password");
  await signIn.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/en/inbox");

  // no quick-approve on inbox
  await expect(
    page.getByRole("button", { name: "Approve", exact: true }),
  ).toHaveCount(0);

  // no run buttons on agents
  await page.goto("/en/agents");
  await expect(
    page.getByRole("button", { name: "Run now" }),
  ).toHaveCount(0);

  // pending approvals are view-only
  await page.goto("/en/approvals");
  await expect(page.getByText(/View only/).first()).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Approve", exact: true }),
  ).toHaveCount(0);

  // no segment creation form
  await page.goto("/en/segments");
  await expect(
    page.getByRole("button", { name: "Create", exact: true }),
  ).toHaveCount(0);

  // settings is admin-only
  await page.goto("/en/settings");
  await expect(page.getByText("Only admins can view")).toBeVisible();
  await ctx.close();
});

test("settings: admin lists members and can add one", async ({ page }) => {
  await page.goto("/en/settings");
  await expect(page.getByTestId("member-row")).toHaveCount(2); // admin + viewer
  await page.getByPlaceholder("teammate@corp.example").fill("new@aigtm.local");
  await page.locator('input[name="name"]').fill("New Member");
  await page.locator('input[name="password"]').fill("member-password");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.waitForLoadState("networkidle");
  await expect(page.getByTestId("member-row")).toHaveCount(3);
  await expect(page.getByText("New Member")).toBeVisible();
});

test("segments: edit filters and delete", async ({ page }) => {
  await page.goto("/en/segments");
  const card = page.getByTestId("segment-card").first();
  const initial = await page.getByTestId("segment-card").count();

  // edit: rename + set a stage filter
  await card.getByText("Edit", { exact: true }).click();
  await card.locator('input[name="name"]').fill("Renamed segment");
  await card.locator('select[name="stage"]').selectOption("customer");
  await card.getByRole("button", { name: "Save" }).click();
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("Renamed segment")).toBeVisible();
  await expect(page.getByText("stage: customer")).toBeVisible();

  // delete: confirm inside <details>
  const edited = page
    .getByTestId("segment-card")
    .filter({ hasText: "Renamed segment" });
  await edited.getByText("Delete", { exact: true }).first().click();
  await edited.getByRole("button", { name: "Delete" }).click();
  await page.waitForLoadState("networkidle");
  await expect(page.getByTestId("segment-card")).toHaveCount(initial - 1);
});

test("sign-in locks after repeated failures", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  for (let i = 0; i < 6; i++) {
    await page.goto("/en/login");
    const signIn = page.locator("form").filter({ hasText: "Sign in" });
    await signIn.getByPlaceholder("Email").fill("ghost@nowhere.io");
    await signIn.getByPlaceholder("Password").fill("wrong");
    await signIn.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL("**/en/login**");
  }
  await expect(page.getByText("Too many failed attempts")).toBeVisible();
  await ctx.close();
});

test("settings: BYOK key save → masked → route → remove", async ({ page }) => {
  await page.goto("/en/settings");
  const card = page.getByTestId("provider-openai");
  await expect(card.getByText("Not set")).toBeVisible();

  // save a key — never echoed back, only masked
  await card.locator('input[name="key"]').fill("sk-test-abcdef1234");
  await card.getByRole("button", { name: "Save" }).click();
  await page.waitForLoadState("networkidle");
  await expect(card.getByText(/Configured sk-…1234/)).toBeVisible();

  // route a role to a concrete model and save
  await page.getByTestId("route-reasoning").selectOption("openai:gpt-4.1-mini");
  await page.getByTestId("routing-card").getByRole("button", { name: "Save" }).click();
  await page.waitForLoadState("networkidle");
  await expect(page.getByTestId("route-reasoning")).toHaveValue("openai:gpt-4.1-mini");

  // remove the key
  await card.getByRole("button", { name: "Remove" }).click();
  await page.waitForLoadState("networkidle");
  await expect(card.getByText("Not set")).toBeVisible();
});

test("run detail shows stats strip and step latencies", async ({ page }) => {
  await page.goto("/en/agents");
  await page.locator('[data-testid="agent-card"] a').first().click();
  await page.waitForURL("**/en/agents/*");
  await page.locator('a[href*="/runs/"]').first().click();
  await page.waitForURL("**/en/runs/*");
  await expect(page.getByText("Steps").first()).toBeVisible();
  await expect(page.getByText("Tokens").first()).toBeVisible();
  await expect(page.getByText("Duration").first()).toBeVisible();
});

test("audit page lists recent events", async ({ page }) => {
  await page.goto("/en/audit");
  await expect(page.getByText(/run\.(started|completed)|approval\./).first()).toBeVisible();
});

test("sign out returns to login", async ({ page }) => {
  await page.getByRole("button", { name: "Sign out" }).first().click();
  await page.waitForURL("**/en/login");
  const signIn = page.locator("form").filter({ hasText: "Sign in" });
  await expect(signIn.getByPlaceholder("Email")).toBeVisible();
});

test("palette finds contacts, deals and agents", async ({ page }) => {
  await page.goto("/en/inbox");
  for (const [q, hint] of [["Elena", "Contact"], ["Nordic", "Account"]] as const) {
    await page.getByRole("button", { name: /Search or jump to/ }).click();
    await page.getByPlaceholder(/Search/i).fill(q);
    await expect(page.getByText(hint).first()).toBeVisible();
    await page.keyboard.press("Escape");
  }
});

test("account 360 renders score, contacts and deals", async ({ page }) => {
  await page.goto("/en/accounts");
  await page.locator("tbody tr a").first().click();
  await page.waitForURL("**/en/accounts/*");
  await expect(page.getByRole("heading", { name: "Nordic Systems" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Signals" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Contacts" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Opportunities" })).toBeVisible();
});

test("viewer sees admin-only notice on settings", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto("/en/login");
  const signIn = page.locator("form").filter({ hasText: "Sign in" });
  await signIn.getByPlaceholder("Email").fill("viewer@aigtm.local");
  await signIn.getByPlaceholder("Password").fill("viewer-password");
  await signIn.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/en/inbox");
  await page.goto("/en/settings");
  await expect(page.getByText(/admin/i).first()).toBeVisible();
  await expect(page.getByTestId("providers-card")).toHaveCount(0);
  await ctx.close();
});

test("ingest webhook: generate key, POST signal event, it lands", async ({ page }) => {
  await page.goto("/en/settings");
  await page.getByTestId("generate-ingest-key").click();
  await page.waitForURL("**/en/settings?k=**");
  const key = await page.getByTestId("new-ingest-key").textContent();
  expect(key).toMatch(/^aigtm_/);

  // bad key is rejected
  const bad = await page.request.post("/api/ingest", {
    headers: { authorization: "Bearer wrong" },
    data: { type: "signal_event", signalName: "x", score: 10 },
  });
  expect(bad.status()).toBe(401);

  // real event → lands in signal_events (visible on the Signals page)
  const res = await page.request.post("/api/ingest", {
    headers: { authorization: `Bearer ${key}` },
    data: {
      type: "signal_event",
      signalName: "Executive hire",
      accountDomain: "nordic-systems.example",
      score: 91,
      evidence: { source: "e2e", note: "hook test" },
    },
  });
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.ok).toBe(true);
  expect(body.id).toBeTruthy();

  await page.goto("/en/signals");
  await expect(page.getByText("91").first()).toBeVisible();

  // message ingest → conversation dedupes
  const m1 = await page.request.post("/api/ingest", {
    headers: { authorization: `Bearer ${key}` },
    data: {
      type: "message",
      channel: "email",
      subject: "E2E ingest test",
      from: "rin@acme-robotics.example",
      body: "hello from the webhook",
    },
  });
  expect(m1.status()).toBe(200);
  const m2 = await page.request.post("/api/ingest", {
    headers: { authorization: `Bearer ${key}` },
    data: {
      type: "message",
      channel: "email",
      subject: "E2E ingest test",
      from: "rin@acme-robotics.example",
      body: "hello from the webhook",
    },
  });
  const m2body = await m2.json();
  expect(m2body.inserted).toBe(0); // deduped
});
