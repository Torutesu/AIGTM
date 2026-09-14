# 06 — Lightfield teardown & gap analysis

Source: https://lightfield.app/ (fetched + full-page capture, 2026). Lightfield = "CRM
engineered for the future" — AI-native CRM, $47M Series A (a16z). Where Frontrunner
is an agent overlay on your existing stack, Lightfield **owns the system of
record** — the same architectural bet we made (docs/03, 04). It is therefore our
closest structural competitor and the right UX bar for the Records + Review
surfaces.

## Positioning claims

- "The companies of the future will run on a **world model** of their business,
  not a Salesforce-era database."
- CRM **updates itself** from every call, email, meeting, Slack thread →
  "temporal context graph" (≈ our bitemporal `knowledge` + `conversations`).
- Agents: find lookalike prospects, capture commitments, diagnose funnel, codify
  what best sellers do.
- "Agent harness": standardized SDK, deterministic code sandbox, continuous
  evals — mirrors our step-runner + mock-provider + eval plan.
- Open platform: every record readable/writable via API, **MCP**, CLI.
- Migration wedge: agent ingests legacy CRM data and recreates the data model
  day one (white-glove + agent-assisted).

## Product IA (from LP product captures)

Sidebar groups:
- Pinned: **Up next**, **For review** (approval queue), Knowledge, Skills,
  Automations
- **Chats**: New chat + history ("Build a prospect list", "Reengage VP of
  Sales", …) — assistant as first-class surface
- **Demand**: Target accounts, Sequences
- **Records**: Accounts, Opportunities, Contacts
- **Resources**: Tasks, Meetings, Notes, Lists

## Key UI patterns worth adopting

### 1. Target-accounts table (hero surface)
Columns: `Account (logo) | Score | Status | Contacts (avatar stack) | Signals
(chips) | …`. 
- **Score = segmented dash bar** (5–6 dashes, green→amber by value) + numeric —
  more glanceable than a continuous bar.
- **Status chips**: `New` (blue tint), `Active opportunity` (amber), `Customer`
  (green).
- **Signals as row chips**: "Executive hire", "Headcount growth", "Contact job
  change", "Tech stack change", "New funding round" — the why-this-account-now
  is visible inline.
- Row count footer ("18 accounts"), Filter / Display controls, "+ Add target
  account".

### 2. For review — two-pane approval UX (their "inbox zero" surface)
- Left rail: queue **grouped by agent/task type** ("Outbound to high ICP fit",
  "Meeting follow-ups", "Opportunity qualification", "GTM hiring signals"),
  rows = person·account + relative time.
- Right pane: selected item → **rationale card** (why the agent thinks this
  matters, citing signals + history) + **full draft card** rendered like an
  email (From / To / Subject / body) + Approve / Dismiss.
- Approving = "Send". The human reviews *the artifact*, not a JSON diff.

### 3. Sequences (phase 2+ for us)
Overview/Enrollments/Replies/Test-runs tabs; performance stat cards (Enrolled /
Sends / Opens % / Replies % / Bounces %); a **natural-language "Description"**
holding messaging guidance; Steps with wait periods (LinkedIn request → wait 3d
→ mutual intro → wait 5d → …). Maps to our agent `act` steps + schedule.

### 4. Skills (≈ our prompts/ + agent specs)
Workspace skill library: Account research, Call prep, Deal review, Objection
handling, Stakeholder map, Close plan, Forecast update… Each skill = `SKILL.md`
+ supporting framework docs (qualification.md, sales-process.md) — i.e. **the
playbook as files the agent cites**. Our `prompts/*.md` + `agents/*.yaml` are
the same idea; we should expose them read-only in-app (spec viewer) and
eventually let agents cite the framework section behind each judgment.

### 5. Assistant runs as visible work
Chat responses stream tool steps ("Reviewing ICP, signals, and interaction
history → 5 new accounts created"; "Generating email drafts → 5 emails ready
for review") — run progress is narrated. Our `run_steps` already stores this;
a run-detail timeline can render it verbatim.

## Gap analysis vs our implementation

| Lightfield element | Our state | Action |
|---|---|---|
| Records table (accounts w/ score, status, signal chips) | schema exists, no UI | **build `/accounts`** |
| For-review two-pane w/ email-style draft | flat approvals table | **rebuild `/approvals`** |
| Segmented dash score bar | continuous bar | **replace ScoreBar** |
| Chats / assistant surface | none | phase 2 (assistant mode) |
| Sequences w/ perf stats | `act` steps only | phase 2 |
| Skills library UI | files only | phase 2 (spec viewer) |
| "Up next" suggestion queue | inbox = pending approvals | inbox already triage-shaped |
| Auto-capture (meetings/email → records) | conversations table only | phase 2 (connectors) |
| MCP/API read-write of every record | none | phase 3 (externalization) |
| World-model narrative | knowledge claims exist | keep — differentiate on audit |

## Design-language notes (merged into our system)

Lightfield's chrome is lighter than Frontrunner's: neutral grays, black primary
CTA, hairline everything, tiny mono labels, tinted status chips — compatible
with our Frontrunner-derived tokens. We adopt: segmented score, grouped review
queue, draft-artifact preview. We keep our forest/paper identity (theirs is
generic light-gray SaaS; ours is more ownable).
