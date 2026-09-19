import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, and, like } from "drizzle-orm";
import {
  createDb,
  migrate,
  withOrg,
  schema,
  erasePerson,
  eraseAccount,
  type DbHandle,
} from "./index";
import { seed } from "./seed";

let handle: DbHandle;
let orgId: string;

beforeAll(async () => {
  handle = await createDb("memory:");
  await migrate(handle);
  ({ orgId } = await seed(handle));
});

afterAll(async () => handle.close());

const ctx = () => ({ orgId, userId: "test-actor" });

describe("erasePerson", () => {
  it("anonymizes the person and scrubs their email from participants", async () => {
    // seed has rin@acme-robotics.example as a conversation participant
    const [person] = (await withOrg(handle, ctx(), (tx) =>
      tx
        .select()
        .from(schema.people)
        .where(
          and(
            eq(schema.people.orgId, orgId),
            eq(schema.people.email, "rin@acme-robotics.example"),
          ),
        )
        .limit(1),
    )) as { id: string; email: string | null }[];
    expect(person).toBeTruthy();

    const res = await withOrg(handle, ctx(), (tx) =>
      erasePerson(tx, ctx(), person.id),
    );
    expect(res.erased).toBe(true);

    const [after] = (await withOrg(handle, ctx(), (tx) =>
      tx
        .select()
        .from(schema.people)
        .where(eq(schema.people.id, person.id))
        .limit(1),
    )) as { name: string; email: string | null; role: string | null }[];
    expect(after.name).toBe("[erased]");
    expect(after.email).toBeNull();
    expect(after.role).toBeNull();

    // their email no longer appears in any participants array
    const convs = (await withOrg(handle, ctx(), (tx) =>
      tx.select({ participants: schema.conversations.participants }).from(schema.conversations),
    )) as { participants: unknown }[];
    for (const c of convs) {
      for (const p of (c.participants as string[] | null) ?? []) {
        expect(p).not.toBe("rin@acme-robotics.example");
      }
    }
    expect(convs.some((c) => (c.participants as string[])?.includes("[erased]"))).toBe(true);

    // idempotent
    const again = await withOrg(handle, ctx(), (tx) =>
      erasePerson(tx, ctx(), person.id),
    );
    expect(again.erased).toBe(false);
  });

  it("records an audit event", async () => {
    const events = (await withOrg(handle, ctx(), (tx) =>
      tx
        .select()
        .from(schema.auditEvents)
        .where(eq(schema.auditEvents.action, "person.erased")),
    )) as unknown[];
    expect(events.length).toBeGreaterThanOrEqual(1);
  });
});

describe("eraseAccount", () => {
  it("tombstones the account and erases its people", async () => {
    const [account] = (await withOrg(handle, ctx(), (tx) =>
      tx
        .select()
        .from(schema.accounts)
        .where(like(schema.accounts.name, "%Nordic%"))
        .limit(1),
    )) as { id: string }[];
    expect(account).toBeTruthy();

    const res = await withOrg(handle, ctx(), (tx) =>
      eraseAccount(tx, ctx(), account.id),
    );
    expect(res.erased).toBe(true);
    expect(res.peopleErased).toBeGreaterThanOrEqual(1);

    const [after] = (await withOrg(handle, ctx(), (tx) =>
      tx
        .select()
        .from(schema.accounts)
        .where(eq(schema.accounts.id, account.id))
        .limit(1),
    )) as { name: string; domain: string | null }[];
    expect(after.name).toBe("[erased]");
    expect(after.domain).toBeNull();

    // attached people are tombstoned too
    const people = (await withOrg(handle, ctx(), (tx) =>
      tx
        .select()
        .from(schema.people)
        .where(eq(schema.people.accountId, account.id)),
    )) as { name: string; email: string | null }[];
    for (const p of people) {
      expect(p.name).toBe("[erased]");
      expect(p.email).toBeNull();
    }
  });
});
