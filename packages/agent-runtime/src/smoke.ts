import { createDb } from "@aigtm/db";
import { ModelRouter, routerForOrg } from "./model";

/**
 * `pnpm --filter @aigtm/agent-runtime smoke [orgId]` — one minimal real
 * completion through the resolved router (org BYOK if orgId given, else
 * env keys). Verifies credentials, request shape, and model id end to end.
 * Costs a few tokens on the cheapest configured role.
 */
const orgId = process.argv[2];

const handle = await createDb();
const router = orgId ? await routerForOrg(handle, orgId) : new ModelRouter();
try {
  const res = await router.complete(
    {
      id: "smoke",
      kind: "llm",
      model: "fast",
      prompt: 'Reply with exactly: {"ok":true}',
      input: {},
      output: { ok: "string" },
    },
    {},
  );
  console.log(
    JSON.stringify(
      {
        model: res.model,
        latencyMs: res.latencyMs,
        tokensIn: res.tokensIn,
        tokensOut: res.tokensOut,
        output: res.output,
      },
      null,
      2,
    ),
  );
} finally {
  await handle.close();
}
