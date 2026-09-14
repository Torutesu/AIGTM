import type { ModelRole, AgentStep } from "@aigtm/specs";

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
    const name = this.roleMap[role];
    const p = this.providers.find((p) => p.name === name);
    if (!p) throw new Error(`no provider registered for role ${role} (→ ${name})`);
    return p;
  }

  async complete(step: AgentStep, context: Record<string, unknown>): Promise<ModelResult> {
    const role = step.model ?? "reasoning";
    return this.providerFor(role).complete(step, context);
  }
}
