import { z } from "zod";
import { parse as parseYaml } from "yaml";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// ---------- Signal spec ----------

export const signalSourceSchema = z.object({
  type: z.string(), // job_boards | filings | press | web_visitors | replies | ...
  watch: z.record(z.unknown()).optional(),
});

export const signalSpecSchema = z.object({
  name: z.string().min(1),
  description: z.string().default(""),
  sources: z.array(signalSourceSchema).min(1),
  resolve: z
    .object({
      entity: z.enum(["account", "person"]),
      constraints: z.array(z.string()).default([]),
    })
    .optional(),
  score: z.object({ icp_filter: z.string().default("default") }).optional(),
  actions: z
    .array(
      z.object({
        emit: z.literal("signal_event").optional(),
        enqueue_agent: z.string().optional(),
      }),
    )
    .default([]),
});

export type SignalSpec = z.infer<typeof signalSpecSchema>;

// ---------- Agent spec ----------

export const modelRoleSchema = z.enum(["reasoning", "fast", "writing", "japanese"]);
export type ModelRole = z.infer<typeof modelRoleSchema>;

export const triggerSchema = z.object({
  type: z.enum(["manual", "schedule", "event"]),
  schedule: z.string().optional(), // cron, when type=schedule
  event: z.string().optional(), // e.g. deal.no_activity, when type=event
  where: z.record(z.unknown()).optional(),
});

export const stepSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["llm", "tool"]),
  model: modelRoleSchema.optional(), // required when kind=llm
  tool: z.string().optional(), // required when kind=tool
  prompt: z.string().optional(), // prompt file path or inline
  input: z.record(z.unknown()).default({}),
  // declarative output shape: field -> 'string' | 'array' | 'number' | 'object'
  output: z.record(z.enum(["string", "array", "number", "object"])).default({}),
});

export const agentSpecSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().default(""),
    trigger: triggerSchema,
    steps: z.array(stepSchema).min(1),
    approval: z.object({
      before_act: z.enum(["required", "threshold", "none"]).default("required"),
      threshold: z.number().optional(),
    }),
    act: z
      .array(
        z.object({
          type: z.enum(["create_task", "draft_email", "post_slack", "crm_write"]),
          assignee: z.string().optional(),
        }),
      )
      .default([]),
    learn: z
      .array(
        z.object({
          write: z.object({
            claim: z.string(),
            about: z.enum(["account", "person", "deal"]),
            // optional step id whose array output provides the subject entities
            from: z.string().optional(),
          }),
        }),
      )
      .default([]),
  })
  .superRefine((spec, ctx) => {
    for (const [i, s] of spec.steps.entries()) {
      if (s.kind === "llm" && !s.model)
        ctx.addIssue({ code: "custom", message: `steps[${i}] (${s.id}): llm step requires model` });
      if (s.kind === "tool" && !s.tool)
        ctx.addIssue({ code: "custom", message: `steps[${i}] (${s.id}): tool step requires tool` });
    }
    const ids = new Set<string>();
    for (const s of spec.steps) {
      if (ids.has(s.id))
        ctx.addIssue({ code: "custom", message: `duplicate step id: ${s.id}` });
      ids.add(s.id);
    }
  });

export type AgentSpec = z.infer<typeof agentSpecSchema>;
export type AgentStep = z.infer<typeof stepSchema>;

// ---------- loading ----------

export function parseAgentSpec(input: string | unknown): AgentSpec {
  const raw = typeof input === "string" ? parseYaml(input) : input;
  return agentSpecSchema.parse(raw);
}

export function parseSignalSpec(input: string | unknown): SignalSpec {
  const raw = typeof input === "string" ? parseYaml(input) : input;
  return signalSpecSchema.parse(raw);
}

export function loadSpecDir<T>(dir: string, parse: (raw: unknown) => T): T[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
    .map((f) => parse(parseYaml(readFileSync(join(dir, f), "utf8"))));
}
