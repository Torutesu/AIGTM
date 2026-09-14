import { describe, it, expect, vi, afterEach } from "vitest";
import {
  AnthropicProvider,
  OpenAIProvider,
  MockProvider,
  defaultRouter,
} from "./model";
import type { AgentStep } from "@aigtm/specs";

const step: AgentStep = {
  id: "s1",
  kind: "llm",
  model: "reasoning",
  prompt: "Say hi",
  input: {},
  output: { summary: "string" },
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("defaultRouter", () => {
  it("falls back to mock when no API keys are configured", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", "");
    const router = defaultRouter();
    expect(router.providerFor("reasoning").name).toBe("mock");
  });

  it("routes a role to anthropic when key + pref are set", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
    vi.stubEnv("AIGTM_MODEL_REASONING", "anthropic");
    const router = defaultRouter();
    expect(router.providerFor("reasoning").name).toBe("anthropic");
    // unset roles stay on mock
    expect(router.providerFor("fast").name).toBe("mock");
  });

  it("ignores routing prefs for providers without keys", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("AIGTM_MODEL_REASONING", "openai");
    expect(defaultRouter().providerFor("reasoning").name).toBe("mock");
  });
});

describe("AnthropicProvider", () => {
  it("requires an API key", () => {
    expect(() => new AnthropicProvider("")).toThrow();
  });

  it("posts to /v1/messages and normalizes the result", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          model: "claude-sonnet-4-5",
          content: [{ type: "text", text: '{"summary":"ok"}' }],
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const p = new AnthropicProvider("sk-ant-test");
    const res = await p.complete(step, { account: "Acme" });
    expect(res.output).toEqual({ summary: "ok" });
    expect(res.tokensIn).toBe(10);
    expect(res.tokensOut).toBe(5);
    expect(res.model).toContain("anthropic:");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("sk-ant-test");
    expect(String(init.body)).toContain("Acme");
  });

  it("extracts JSON embedded in prose", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            content: [{ type: "text", text: 'Here is the result: {"summary":"x"} done' }],
          }),
          { status: 200 },
        ),
      ),
    );
    const res = await new AnthropicProvider("k").complete(step, {});
    expect(res.output).toEqual({ summary: "x" });
  });

  it("throws on HTTP errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("bad key", { status: 401 })),
    );
    await expect(new AnthropicProvider("k").complete(step, {})).rejects.toThrow(
      "anthropic 401",
    );
  });
});

describe("OpenAIProvider", () => {
  it("posts to chat completions with json_object format", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          model: "gpt-4.1",
          choices: [{ message: { content: '{"summary":"hi"}' } }],
          usage: { prompt_tokens: 7, completion_tokens: 3 },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const res = await new OpenAIProvider("sk-test").complete(step, {});
    expect(res.output).toEqual({ summary: "hi" });
    expect(res.model).toContain("openai:");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect(String(init.body)).toContain("json_object");
  });
});

describe("MockProvider", () => {
  it("is deterministic and offline", async () => {
    const p = new MockProvider();
    const a = await p.complete(step, { x: 1 });
    const b = await p.complete(step, { x: 1 });
    expect(a.output).toEqual(b.output);
  });
});
