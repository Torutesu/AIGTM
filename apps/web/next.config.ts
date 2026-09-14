import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const config: NextConfig = {
  outputFileTracingRoot: join(dirname(fileURLToPath(import.meta.url)), "../.."),
  transpilePackages: [
    "@aigtm/db",
    "@aigtm/specs",
    "@aigtm/agent-runtime",
    "@aigtm/connectors",
    "@aigtm/auth",
  ],
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
};

export default withNextIntl(config);
