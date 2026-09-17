import type { ModelRole, AgentStep } from "@aigtm/specs";
import { eq } from "drizzle-orm";
import {
  schema,
  decryptSecret,
  type DbHandle,
  type OrgProviderConfig,
} from "@aigtm/db";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export interface ModelResult {
  output: Record<string, unknown>;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  model: string;
}

export interface ModelProvider {
  name: string;
  complete(
    step: AgentStep,
    context: Record<string, unknown>,
    modelOverride?: string,
  ): Promise<ModelResult>;
}

/**
 * Deterministic provider used in Phase 0. Never calls a network. Produces
 * schema-shaped stub output so the full run pipeline (steps → approval →
 * outbox → learn → audit) is exercisable end to end.
 */
export class MockProvider implements ModelProvider {
  name = "mock";
  calls: { step: string; role: string }[] = [];

  async complete(step: AgentStep, context: Record<string, unknown>): Promise<ModelResult> {
    const start = Date.now();
    this.calls.push({ step: step.id, role: step.model ?? "reasoning" });
    const output: Record<string, unknown> = {};
    for (const [field, type] of Object.entries(step.output)) {
      switch (type) {
        case "string":
          output[field] = `[mock] ${step.id}.${field}`;
          break;
        case "array":
          output[field] = [{ mock: true, step: step.id }];
          break;
        case "number":
          output[field] = 0;
          break;
        case "object":
          output[field] = { mock: true };
          break;
      }
    }
    void context;
    return {
      output,
      tokensIn: 0,
      tokensOut: 0,
      latencyMs: Date.now() - start,
      model: `mock:${step.model ?? "reasoning"}`,
    };
  }
}

/**
 * Maps abstract roles to concrete providers. Phase 0: everything routes to
 * the mock. Real providers (Anthropic/OpenAI/Gemini) register here later —
 * routing by cost / latency / eval history lives behind this interface.
 */
export class ModelRouter {
  private providers: ModelProvider[];
  private roleMap: Record<ModelRole, string>;

  constructor(
    providers: ModelProvider[] = [new MockProvider()],
    roleMap?: Partial<Record<ModelRole, string>>,
  ) {
    this.providers = providers;
    this.roleMap = {
      reasoning: "mock",
      fast: "mock",
      writing: "mock",
      japanese: "mock",
      ...roleMap,
    };
  }

  providerFor(role: ModelRole): ModelProvider {
    const name = this.roleMap[role].split(":")[0];
    const p = this.providers.find((p) => p.name === name);
    if (!p) throw new Error(`no provider registered for role ${role} (→ ${name})`);
    return p;
  }

  async complete(step: AgentStep, context: Record<string, unknown>): Promise<ModelResult> {
    const role = step.model ?? "reasoning";
    const target = this.roleMap[role];
    // role values are "provider" or "provider:model" (BYOK routing UI sets the latter)
    const modelOverride = target.includes(":") ? target.split(":").slice(1).join(":") : undefined;
    return this.providerFor(role).complete(step, context, modelOverride);
  }
}

/* ------------------------------------------------------------------ */
/* Real providers — activated only when the matching env key is set.   */
/* All traffic is plain HTTPS via fetch; no SDKs. Falls back to Mock   */
/* for any role not explicitly routed via AIGTM_MODEL_<ROLE>.          */
/* ------------------------------------------------------------------ */

function resolvePrompt(prompt: string | undefined): string {
  if (!prompt) return "";
  // prompt may be an inline string or a repo-relative path (prompts/*.md)
  for (const base of [process.cwd(), join(process.cwd(), "..", "..")]) {
    const p = join(base, prompt);
    if (existsSync(p)) return readFileSync(p, "utf8");
  }
  return prompt;
}

function buildUserPrompt(step: AgentStep, context: Record<string, unknown>): string {
  const schemaDesc = Object.entries(step.output)
    .map(([k, t]) => `"${k}": ${t}`)
    .join(", ");
  return [
    resolvePrompt(step.prompt),
    "",
    "## Context",
    "```json",
    JSON.stringify(context, null, 2).slice(0, 24_000),
    "```",
    "",
    `Respond with ONLY a JSON object of shape { ${schemaDesc} }. No prose, no markdown fences.`,
  ].join("\n");
}

function extractJson(text: string): Record<string, unknown> {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]) as Record<string, unknown>;
      } catch {
        /* fall through */
      }
    }
    return { text };
  }
}

abstract class HttpJsonProvider implements ModelProvider {
  abstract name: string;
  protected abstract call(prompt: string, model: string): Promise<{
    text: string;
    tokensIn: number;
    tokensOut: number;
    model: string;
  }>;
  protected abstract modelFor(role: ModelRole): string;

  async complete(
    step: AgentStep,
    context: Record<string, unknown>,
    modelOverride?: string,
  ): Promise<ModelResult> {
    const role = step.model ?? "reasoning";
    const start = Date.now();
    const res = await this.call(
      buildUserPrompt(step, context),
      modelOverride ?? this.modelFor(role),
    );
    return {
      output: extractJson(res.text),
      tokensIn: res.tokensIn,
      tokensOut: res.tokensOut,
      latencyMs: Date.now() - start,
      model: res.model,
    };
  }
}

export class AnthropicProvider extends HttpJsonProvider {
  name = "anthropic";
  private key: string;
  constructor(key = process.env.ANTHROPIC_API_KEY ?? "") {
    super();
    if (!key) throw new Error("ANTHROPIC_API_KEY is not set");
    this.key = key;
  }
  protected modelFor(role: ModelRole): string {
    const defaults: Record<ModelRole, string> = {
      reasoning: "claude-sonnet-4-5",
      writing: "claude-sonnet-4-5",
      fast: "claude-haiku-4-5",
      japanese: "claude-sonnet-4-5",
    };
    return process.env[`AIGTM_ANTHROPIC_MODEL_${role.toUpperCase()}`] ?? defaults[role];
  }
  protected async call(prompt: string, model: string) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": this.key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: 2048,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = (await res.json()) as {
      content: { type: string; text?: string }[];
      usage?: { input_tokens?: number; output_tokens?: number };
      model?: string;
    };
    return {
      text: data.content.find((c) => c.type === "text")?.text ?? "",
      tokensIn: data.usage?.input_tokens ?? 0,
      tokensOut: data.usage?.output_tokens ?? 0,
      model: `anthropic:${data.model ?? model}`,
    };
  }
}

export class OpenAIProvider extends HttpJsonProvider {
  name = "openai";
  private key: string;
  constructor(key = process.env.OPENAI_API_KEY ?? "") {
    super();
    if (!key) throw new Error("OPENAI_API_KEY is not set");
    this.key = key;
  }
  protected modelFor(role: ModelRole): string {
    const defaults: Record<ModelRole, string> = {
      reasoning: "gpt-4.1",
      writing: "gpt-4.1",
      fast: "gpt-4.1-mini",
      japanese: "gpt-4.1",
    };
    return process.env[`AIGTM_OPENAI_MODEL_${role.toUpperCase()}`] ?? defaults[role];
  }
  protected async call(prompt: string, model: string) {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        response_format: { type: "json_object" },
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) throw new Error(`openai ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = (await res.json()) as {
      choices: { message: { content: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
      model?: string;
    };
    return {
      text: data.choices[0]?.message.content ?? "",
      tokensIn: data.usage?.prompt_tokens ?? 0,
      tokensOut: data.usage?.completion_tokens ?? 0,
      model: `openai:${data.model ?? model}`,
    };
  }
}

/**
 * Router used by the app/worker. Registers real providers when their API
 * keys are present, then applies per-role routing from AIGTM_MODEL_<ROLE>
 * (= provider name: mock | anthropic | openai). Unset roles stay on mock —
 * deterministic, offline-safe default.
 */
export function defaultRouter(): ModelRouter {
  const providers: ModelProvider[] = [];
  try {
    providers.push(new AnthropicProvider());
  } catch { /* no key */ }
  try {
    providers.push(new OpenAIProvider());
  } catch { /* no key */ }
  providers.push(new MockProvider());
  const roleMap: Partial<Record<ModelRole, string>> = {};
  for (const role of ["reasoning", "fast", "writing", "japanese"] as ModelRole[]) {
    const pref = process.env[`AIGTM_MODEL_${role.toUpperCase()}`];
    if (pref && providers.some((p) => p.name === pref)) roleMap[role] = pref;
  }
  return new ModelRouter(providers, roleMap);
}

/* ------------------------------------------------------------------ */
/* Cost accounting — estimate USD from provider usage + price table.   */
/* Prefix-matched on the "<provider>:<model>" ids we record on steps.   */
/* ------------------------------------------------------------------ */

/**
 * Org-scoped router: BYOK keys saved in /settings (organizations.provider_
 * config, AES-GCM encrypted) take precedence over env keys; unset roles fall
 * back to env routing, then to mock. The worker resolves this per org, so a
 * single deployment serves tenants with different providers.
 */
export async function routerForOrg(
  handle: DbHandle,
  orgId: string,
): Promise<ModelRouter> {
  const [org] = (await handle.db
    .select({ providerConfig: schema.organizations.providerConfig })
    .from(schema.organizations)
    .where(eq(schema.organizations.id, orgId))
    .limit(1)) as { providerConfig: OrgProviderConfig | null }[];
  const cfg = org?.providerConfig;

  const openaiKey =
    decryptSecret(cfg?.keys?.openai) ?? process.env.OPENAI_API_KEY;
  const anthropicKey =
    decryptSecret(cfg?.keys?.anthropic) ?? process.env.ANTHROPIC_API_KEY;

  const providers: ModelProvider[] = [];
  if (openaiKey) providers.push(new OpenAIProvider(openaiKey));
  if (anthropicKey) providers.push(new AnthropicProvider(anthropicKey));
  providers.push(new MockProvider());

  const roleMap: Partial<Record<ModelRole, string>> = {};
  for (const role of ["reasoning", "fast", "writing", "japanese"] as ModelRole[]) {
    const orgPref = cfg?.roles?.[role];
    const envPref = process.env[`AIGTM_MODEL_${role.toUpperCase()}`];
    const pref = orgPref ?? envPref;
    // org prefs may be "provider:model"; validate the provider part is live
    const providerName = pref?.split(":")[0];
    if (providerName && providers.some((p) => p.name === providerName)) {
      roleMap[role] = pref;
    }
  }
  return new ModelRouter(providers, roleMap);
}

/** [model prefix, $/1M input tokens, $/1M output tokens] — most specific first. */
const MODEL_PRICES: [string, number, number][] = [
  ["openai:gpt-4.1-mini", 0.4, 1.6],
  ["anthropic:claude-opus", 15, 75],
  ["anthropic:claude-sonnet", 3, 15],
  ["anthropic:claude-haiku", 0.8, 4],
  ["openai:gpt-4.1", 2, 8],
];

/** Estimated cost in cents. Unknown models price at 0 (mock included). */
export function estimateCostCents(
  model: string | null,
  tokensIn: number,
  tokensOut: number,
): number {
  if (!model) return 0;
  const p = MODEL_PRICES.find(([prefix]) => model.startsWith(prefix));
  if (!p) return 0;
  return ((tokensIn * p[1] + tokensOut * p[2]) / 1_000_000) * 100;
}
