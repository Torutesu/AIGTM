import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createDb,
  migrate,
  withOrg,
  schema,
  seed,
  type DbHandle,
} from "@aigtm/db";
import { tools } from "./tools";

let handle: DbHandle;
let orgId: string;
let userId: string;
let otherOrgId: string;

const ctx = () => ({ orgId, userId, actorType: "user" as const });

beforeAll(async () => {
  handle = await createDb("memory:");
  await migrate(handle);
  ({ orgId, userId } = await seed(handle));
  const [o2] = await handle.db
    .insert(schema.organizations)
    .values({ name: "Other Org" })
    .returning();
  otherOrgId = o2.id;
  await handle.db.insert(schema.accounts).values({
    orgId: otherOrgId,
    name: "Other Corp",
    stage: "prospect",
    icpFitScore: "99",
    industry: "devtools",
  });
});

afterAll(async () => {
  await handle.close();
});

async function callTool(
  name: string,
  input: Record<string, unknown>,
  oid = orgId,
): Promise<unknown> {
  return withOrg(handle, { orgId: oid, userId, actorType: "user" }, (tx) =>
    tools[name](tx, oid, input),
  );
}

describe("segments.members", () => {
  it("returns accounts matching minScore+stage filter", async () => {
    const rows = (await callTool("segments.members", {
      segment: "High-fit prospects",
    })) as { name: string }[];
    // seed: Nordic(96), Acme(82), さくら産業(71) are prospects ≥70;
    // Hummingbird(88) is excluded by stage, tsubame(64) by score.
    expect(rows.map((r) => r.name).sort()).toEqual([
      "Acme Robotics",
      "Nordic Systems",
      "さくら産業",
    ]);
  });

  it("resolves a segment by uuid too", async () => {
    const segs = (await withOrg(handle, ctx(), (tx) =>
      tx.select().from(schema.segments),
    )) as { id: string; name: string }[];
    const id = segs.find((s) => s.name === "Active opportunities")!.id;
    const rows = (await callTool("segments.members", { segment: id })) as {
      name: string;
    }[];
    expect(rows.map((r) => r.name)).toEqual(["Hummingbird Labs"]);
  });

  it("applies industry substring filter case-insensitively", async () => {
    const [s] = await handle.db
      .insert(schema.segments)
      .values({ orgId, name: "AI cos", filter: { industry: "AI" } })
      .returning();
    const rows = (await callTool("segments.members", {
      segment: s.id,
    })) as { name: string }[];
    expect(rows.map((r) => r.name).sort()).toEqual([
      "Cascade AI",
      "Hummingbird Labs",
    ]);
  });

  it("never returns another org's accounts or segments", async () => {
    const [otherSeg] = await handle.db
      .insert(schema.segments)
      .values({ orgId: otherOrgId, name: "O", filter: { stage: "prospect" } })
      .returning();
    await expect(
      callTool("segments.members", { segment: otherSeg.id }),
    ).rejects.toThrow("segment not found");
    const rows = (await callTool("segments.members", {
      segment: "High-fit prospects",
    })) as { name: string }[];
    expect(rows.map((r) => r.name)).not.toContain("Other Corp");
  });

  it("rejects missing or empty segment input", async () => {
    await expect(callTool("segments.members", {})).rejects.toThrow(
      "requires segment",
    );
    await expect(
      callTool("segments.members", { segment: "" }),
    ).rejects.toThrow("requires segment");
  });

  it("throws on unknown segment", async () => {
    await expect(
      callTool("segments.members", { segment: "does-not-exist" }),
    ).rejects.toThrow("segment not found");
  });

  it("caps results at the limit input", async () => {
    const [seg] = await handle.db
      .insert(schema.segments)
      .values({ orgId, name: "All", filter: {} })
      .returning();
    const rows = (await callTool("segments.members", {
      segment: seg.id,
      limit: 3,
    })) as { name: string }[];
    expect(rows).toHaveLength(3);
  });
});
