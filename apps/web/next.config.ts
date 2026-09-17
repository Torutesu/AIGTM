import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const config: NextConfig = {
  // E2E runs a second dev server on :3939; sharing .next with a live dev
  // server corrupts both manifests, so give it a private build dir.
  distDir: process.env.AIGTM_E2E === "1" ? ".next-e2e" : ".next",
  outputFileTracingRoot: join(dirname(fileURLToPath(import.meta.url)), "../.."),
  transpilePackages: [
    "@aigtm/db",
    "@aigtm/specs",
    "@aigtm/agent-runtime",
    "@aigtm/connectors",
    "@aigtm/auth",
  ],
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
  experimental: {
    serverActions: {
      // Dev preview proxies forward x-forwarded-host but keep their own
      // origin — without this, Server Action POSTs are rejected.
      allowedOrigins: ["127.0.0.1:52940", "localhost:52940"],
    },
  },
};

export default withNextIntl(config);
