import { describe, it, expect } from "vitest";
import { parseAgentSpec, parseSignalSpec } from "./index";

const validAgent = `
name: Test Agent
trigger:
  type: manual
steps:
  - id: s1
    kind: tool
    tool: deals.stalled
    output:
      deals: array
  - id: s2
    kind: llm
    model: reasoning
    output:
      note: string
approval:
  before_act: required
act:
  - type: create_task
learn:
  - write:
      claim: stall_reason
      about: deal
      from: s1
`;

describe("agent spec", () => {
  it("parses a valid spec", () => {
    const spec = parseAgentSpec(validAgent);
    expect(spec.name).toBe("Test Agent");
    expect(spec.steps).toHaveLength(2);
    expect(spec.approval.before_act).toBe("required");
  });

  it("rejects llm step without model", () => {
    expect(() =>
      parseAgentSpec(`
name: Bad
trigger: {type: manual}
steps:
  - id: s1
    kind: llm
approval: {before_act: none}
`),
    ).toThrowError();
  });

  it("rejects tool step without tool name", () => {
    expect(() =>
      parseAgentSpec(`
name: Bad
trigger: {type: manual}
steps:
  - id: s1
    kind: tool
approval: {before_act: none}
`),
    ).toThrowError();
  });

  it("rejects duplicate step ids", () => {
    expect(() =>
      parseAgentSpec(`
name: Bad
trigger: {type: manual}
steps:
  - {id: s1, kind: tool, tool: a}
  - {id: s1, kind: tool, tool: b}
approval: {before_act: none}
`),
    ).toThrowError();
  });
});

describe("signal spec", () => {
  it("parses a valid signal", () => {
    const spec = parseSignalSpec(`
name: First GTM hire
sources:
  - type: job_boards
actions:
  - emit: signal_event
`);
    expect(spec.sources[0].type).toBe("job_boards");
  });

  it("rejects signal without sources", () => {
    expect(() => parseSignalSpec({ name: "x", sources: [] })).toThrowError();
  });
});
