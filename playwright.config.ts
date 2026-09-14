import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  timeout: 60_000,
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
    },
  },
});
