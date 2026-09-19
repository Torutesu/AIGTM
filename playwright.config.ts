import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  timeout: 90_000,
  // dev-server first-compile stalls occasionally push sign-in past the
  // timeout; one retry keeps the suite honest without hiding real failures
  retries: 1,
  use: {
    baseURL: "http://localhost:3939",
  },
  webServer: {
    command: "pnpm --filter @aigtm/web dev -p 3939",
    url: "http://localhost:3939/en/login",
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
    env: {
      DATABASE_URL: "pglite://./.pglite-e2e",
      AIGTM_E2E: "1",
    },
  },
});
