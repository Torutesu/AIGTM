import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  numeric,
  integer,
  boolean,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

// ---------- identity (global, not org-scoped) ----------

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const sessions = pgTable("sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const organizations = pgTable("organizations", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  plan: text("plan").notNull().default("internal"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    userId: uuid("user_id").notNull().references(() => users.id),
    role: text("role").notNull().default("member"), // admin | member | viewer
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("memberships_org_user").on(t.orgId, t.userId)],
);

// ---------- tenant tables (all carry org_id, all under RLS) ----------

export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    name: text("name").notNull(),
    domain: text("domain"),
    industry: text("industry"),
    employeeCount: integer("employee_count"),
    icpFitScore: numeric("icp_fit_score"),
    stage: text("stage").notNull().default("prospect"),
    ownerId: uuid("owner_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("accounts_org").on(t.orgId)],
);

export const people = pgTable(
  "people",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    accountId: uuid("account_id").references(() => accounts.id),
    name: text("name").notNull(),
    email: text("email"),
    role: text("role"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("people_org").on(t.orgId)],
);

export const deals = pgTable(
  "deals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    accountId: uuid("account_id").notNull().references(() => accounts.id),
    name: text("name").notNull(),
    stage: text("stage").notNull().default("open"),
    amount: numeric("amount"),
    ownerId: uuid("owner_id"),
    meddpicc: jsonb("meddpicc"),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("deals_org").on(t.orgId)],
);

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    accountId: uuid("account_id").references(() => accounts.id),
    channel: text("channel").notNull(), // email | call | meeting | slack
    subject: text("subject"),
    participants: jsonb("participants"),
    summary: text("summary"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("conversations_org").on(t.orgId)],
);

export const signals = pgTable(
  "signals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    name: text("name").notNull(),
    spec: jsonb("spec").notNull(), // validated SignalSpec
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("signals_org").on(t.orgId)],
);

export const signalEvents = pgTable(
  "signal_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    signalId: uuid("signal_id").references(() => signals.id),
    accountId: uuid("account_id").references(() => accounts.id),
    personId: uuid("person_id").references(() => people.id),
    evidence: jsonb("evidence").notNull(), // {source_url, excerpt, raw...}
    score: numeric("score"),
    detectedAt: timestamp("detected_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("signal_events_org").on(t.orgId), index("signal_events_detected").on(t.detectedAt)],
);

export const agents = pgTable(
  "agents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    name: text("name").notNull(),
    spec: jsonb("spec").notNull(), // validated AgentSpec
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("agents_org").on(t.orgId)],
);

export const runs = pgTable(
  "runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    agentId: uuid("agent_id").notNull().references(() => agents.id),
    triggerKind: text("trigger_kind").notNull(), // manual | schedule | event | api
    triggerContext: jsonb("trigger_context"),
    status: text("status").notNull().default("running"), // running | fulfilled | rejected
    error: text("error"),
    tokensIn: integer("tokens_in").notNull().default(0),
    tokensOut: integer("tokens_out").notNull().default(0),
    costCents: numeric("cost_cents").notNull().default("0"),
    evalScore: numeric("eval_score"),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("runs_org").on(t.orgId), index("runs_agent").on(t.agentId)],
);

export const runSteps = pgTable(
  "run_steps",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    runId: uuid("run_id").notNull().references(() => runs.id),
    stepId: text("step_id").notNull(),
    kind: text("kind").notNull(), // llm | tool
    model: text("model"),
    tool: text("tool"),
    input: jsonb("input"),
    output: jsonb("output"),
    tokensIn: integer("tokens_in").notNull().default(0),
    tokensOut: integer("tokens_out").notNull().default(0),
    latencyMs: integer("latency_ms").notNull().default(0),
    status: text("status").notNull().default("fulfilled"), // fulfilled | rejected
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("run_steps_org").on(t.orgId), index("run_steps_run").on(t.runId)],
);

export const outbox = pgTable(
  "outbox",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    runId: uuid("run_id").references(() => runs.id),
    kind: text("kind").notNull(), // draft_email | post_slack | crm_write | create_task
    payload: jsonb("payload").notNull(),
    // pending_approval -> released -> dispatched ; or cancelled
    status: text("status").notNull().default("pending_approval"),
    reversibleUntil: timestamp("reversible_until", { withTimezone: true }),
    dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("outbox_org").on(t.orgId), index("outbox_status").on(t.status)],
);

export const approvals = pgTable(
  "approvals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    runId: uuid("run_id").references(() => runs.id),
    outboxId: uuid("outbox_id").references(() => outbox.id),
    kind: text("kind").notNull(), // review_action
    payload: jsonb("payload").notNull(), // rendered diff/preview for the human
    status: text("status").notNull().default("pending"), // pending | approved | rejected
    decidedBy: uuid("decided_by").references(() => users.id),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("approvals_org").on(t.orgId), index("approvals_status").on(t.status)],
);

export const knowledge = pgTable(
  "knowledge",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    subjectType: text("subject_type").notNull(), // account | person | deal
    subjectId: uuid("subject_id").notNull(),
    claim: text("claim").notNull(),
    sourceRunId: uuid("source_run_id").references(() => runs.id),
    confidence: numeric("confidence").notNull().default("1"),
    validFrom: timestamp("valid_from", { withTimezone: true }).defaultNow().notNull(),
    validTo: timestamp("valid_to", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("knowledge_org").on(t.orgId), index("knowledge_subject").on(t.subjectType, t.subjectId)],
);

export const segments = pgTable(
  "segments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    name: text("name").notNull(),
    filter: jsonb("filter").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("segments_org").on(t.orgId)],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    actorType: text("actor_type").notNull(), // user | agent | system
    actorId: text("actor_id").notNull(),
    action: text("action").notNull(), // run.started, approval.decided, outbox.dispatched ...
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    detail: jsonb("detail"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("audit_events_org").on(t.orgId), index("audit_events_created").on(t.createdAt)],
);
