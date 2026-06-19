# Phase 17 / Stabilization Plan — Reliability, Navigation Polish, and End-to-End Confidence

Now that Phases 11–16 are complete, the next phase should **not** add major new features. It should convert the platform from “built” to **reliably operable**.

Phase 17 should be:

```text id="w691ic"
Stabilization, production readiness, and end-to-end smoke coverage
```

The goal is to protect the work already done.

---

# Phase 17 Goal

Make KEYFlowOS stable enough that you can confidently say:

```text id="lojt4m"
The platform boots.
The core flows work.
The dashboards are reachable.
The tests are separated into reliable and flaky suites.
The environment is documented.
The user can navigate the new operating system cleanly.
```

This phase should focus on:

```text id="chuu5k"
1. Isolating flaky tests
2. Adding smoke tests for the completed platform arc
3. Improving navigation and route discoverability
4. Verifying empty states and error states
5. Hardening env/config validation
6. Creating a final production-readiness checklist
```

---

# Why This Phase Is Necessary

The latest work confirms that the Command Center is correctly aggregating the operating system. It pulls from Executive Brief, all KEY modes, Key Autonomy approvals, Temporal Flow, Genome Evolution, Blueprint, Assets, Constitution, and Constitution staleness.

The Key Inbox follow-up also added action confirmation, normalized payload handling, reply drafting/sending, and business-event emissions.

However, you already identified remaining full-suite failures from:

```text id="t7d9xn"
calendar timeouts
keyflow-dev-auth boot-guard timeout
```

Those should not be allowed to obscure true regressions.

Phase 17 should separate:

```text id="b8fo65"
Real failures
```

from:

```text id="6yg5cl"
Known flaky/integration-timeout failures
```

---

# Phase 17 Scope

## In Scope

```text id="xx934p"
Test reliability
Smoke testing
Navigation polish
Route accessibility
Empty states
Error states
Config/env validation
CI test grouping
Documentation/checklist
```

## Out of Scope

```text id="lgm9s1"
New AI features
New autonomy actions
New integrations
New dashboards
Major database model expansions
Real-time websocket work
Complex permissions overhaul
```

---

# Phase 17 Workstream 1 — Test Suite Stabilization

## Problem

Full-suite signal is currently weakened by known flaky tests.

You reported:

```text id="3aejel"
calendar timeouts
keyflow-dev-auth boot-guard timeout
```

These should be isolated into a known integration/flaky group so regular feature work can rely on a deterministic suite.

---

## 17.1 Categorize tests

Create test categories:

```text id="mp1wzj"
unit
integration
smoke
flaky-quarantined
```

Suggested naming convention:

```text id="ros9bp"
*.spec.ts                 normal unit/service/controller tests
*.integration.spec.ts     integration tests
*.smoke.spec.ts           smoke tests
*.flaky.spec.ts           quarantined unstable tests
```

Alternative if renaming is too disruptive:

```text id="7ktiof"
Keep filenames unchanged.
Use package scripts with explicit include/exclude globs.
```

---

## 17.2 Add test scripts

In server `package.json`, add scripts like:

```json id="5zpa7v"
{
  "test:unit": "vitest run --exclude '**/*.integration.spec.ts' --exclude '**/*.flaky.spec.ts' --exclude '**/*.smoke.spec.ts'",
  "test:smoke": "vitest run '**/*.smoke.spec.ts'",
  "test:integration": "vitest run '**/*.integration.spec.ts'",
  "test:flaky": "vitest run '**/*.flaky.spec.ts'",
  "test:ci": "pnpm test:unit && pnpm test:smoke"
}
```

If the project uses a different Vitest config pattern, adapt the exact glob syntax, but preserve the concept:

```text id="52o7z5"
CI should run reliable tests.
Flaky/integration tests should be separate.
```

---

## 17.3 Quarantine known flaky tests

Targets:

```text id="1m69a8"
calendar timeout specs
keyflow-dev-auth boot-guard timeout spec
```

Options:

```text id="hat70c"
1. Rename to *.flaky.spec.ts
2. Mark with describe.skip and create tracking issue
3. Move to integration suite with longer timeout
4. Mock the slow dependency and restore to unit suite
```

Best recommendation:

```text id="nz6eez"
Do not skip forever.
Move to integration/flaky suite and add explicit TODO comments with issue references.
```

---

## 17.4 Fix boot-guard timeout root cause

For `keyflow-dev-auth` timeout:

Investigate:

```text id="ql6wqx"
Does the test boot the full app unnecessarily?
Is it waiting on external service/env?
Is the timeout guarding a startup promise?
Can module imports be narrowed?
Can guards/services be mocked?
Can the boot wait be shortened in test env?
```

Recommended approach:

```text id="v3zhse"
Split one full app boot test into:
1. fast unit test of guard logic
2. one slower integration boot test
```

This prevents a slow app bootstrap from blocking the whole suite.

---

## 17.5 Fix calendar timeout root cause

For calendar tests:

Investigate:

```text id="4a2dlv"
Google Calendar connector calls
date/time loops
cron/scheduler registration
network-like waits
unmocked OAuth/token flows
timezone-dependent assertions
```

Recommended approach:

```text id="8g9szj"
Mock Google Calendar service boundaries.
Avoid live connector calls.
Freeze time.
Use deterministic date fixtures.
Move connector-level behavior into integration suite.
```

---

# Phase 17 Workstream 2 — End-to-End Smoke Tests

Add a small number of **fast, deterministic smoke tests** that verify the completed operating system arc.

Do not use real external integrations.

---

## 17.6 Add backend smoke test

Create:

```text id="az5a1f"
apps/server/src/test/keyflow-operating-system.smoke.spec.ts
```

The smoke test should verify that the main modules can produce the operating snapshot with mocked services.

Minimum coverage:

```text id="27zzs9"
1. Executive Brief can be generated.
2. KEY Executive Mode brief can be generated.
3. Key Autonomy proposal can be created/listed.
4. Business Command Center snapshot can be generated.
5. Snapshot includes pending approvals, urgent items, risks, opportunities, genome status, constitution status.
```

This does not need a real DB if service-level mocks are easier.

---

## 17.7 Add route-level smoke test

Create:

```text id="vijmjj"
apps/server/src/test/keyflow-routes.smoke.spec.ts
```

Verify controllers/routes exist and are callable with guards mocked:

```text id="ggoasj"
GET /intelligence/businesses/:businessId/executive-brief
GET /intelligence/businesses/:businessId/key-modes
GET /intelligence/businesses/:businessId/key-modes/:mode
GET /business-command-center/businesses/:businessId/snapshot
GET /key-autonomy/businesses/:businessId/actions/proposals
POST /key-autonomy/businesses/:businessId/actions/proposals
```

---

## 17.8 Add frontend smoke checks

At minimum, ensure pages build and import cleanly:

```text id="vntwk7"
pnpm --filter web build
```

Optional lightweight route smoke test if a test framework exists:

```text id="zp9ad3"
command-center page renders empty state
key-autonomy page renders no-proposals state
key-modes page renders no-selected-mode state
intelligence page renders executive brief panel shell
```

---

# Phase 17 Workstream 3 — Navigation and Discoverability

The platform now has many powerful routes. Phase 17 should make them discoverable.

New/high-value routes:

```text id="56qbkc"
/app/command-center
/app/key-autonomy
/app/key-modes
/app/intelligence
/app/key-inbox
/app/profile?tab=business-genome
/app/temporal-flow
```

---

## 17.9 Add Command Center as primary entry point

Make `/app/command-center` the obvious operating home.

Options:

```text id="4xlhxt"
1. Add it to sidebar/navigation near top.
2. Add dashboard card from current /app landing page.
3. Redirect /app to /app/command-center if appropriate.
```

Recommendation:

```text id="b5fl3q"
Add to sidebar/top-level navigation first.
Delay redirect until you are certain no existing /app home behavior is needed.
```

---

## 17.10 Add cross-links

Add links:

```text id="6qcdez"
Command Center → Key Autonomy
Command Center → Key Modes
Command Center → Temporal Flow
Command Center → Business Genome
Command Center → Key Inbox
Intelligence → Command Center
Key Modes → Command Center
Key Autonomy → Command Center
Profile/Genome → Command Center
```

This helps the product feel like one OS.

---

## 17.11 Add labels/tooltips

For new concepts, add concise explanations:

```text id="sl3x3p"
KEY Autonomy: approval-gated actions KEY can execute after permission.
KEY Executive Modes: role-specific KEY perspectives.
Command Center: one operating cockpit for priorities, risks, approvals, and opportunities.
Temporal Flow: timeline of meaningful business events and signals.
Business Genome: living source of truth for KEY.
```

---

# Phase 17 Workstream 4 — Empty States and Error States

Because many dashboards depend on business data, empty states matter.

---

## 17.12 Command Center empty states

Verify behavior when:

```text id="4k6ai1"
No pending approvals
No urgent Temporal Flow items
No risks
No opportunities
No Constitution
No assets
No Genome proposals
No Executive Brief data
```

Empty state examples:

```text id="iicfzq"
No pending approvals.
KEY will show approval requests here when an executive mode recommends an executable action.
```

```text id="4o9h6g"
No urgent Temporal Flow items.
KEY has not detected time-sensitive business events.
```

---

## 17.13 Key Autonomy empty states

Already has a no-proposals state; verify copy and links.

Recommended copy:

```text id="nbxx6r"
No proposals in this tab.
Go to KEY Executive Modes to request an action that requires approval.
```

---

## 17.14 Key Modes empty states

Verify:

```text id="kbp0df"
No business selected
Mode list fails to load
Selected mode fails to load
No findings
No recommended actions
```

---

## 17.15 Key Inbox send/reply states

Now that reply draft/send exists, verify:

```text id="9738ys"
Draft saved
Send failed
Send not supported
No recipient
Provider unavailable
Action requires confirmation
Action execution failed
```

The controller now requires explicit confirmation before action execution and emits confirmation/execution/failure events.

---

# Phase 17 Workstream 5 — Config and Environment Hardening

The user already noted unrelated changes in `.env.example`, `env.ts`, and security/semantic services earlier. Phase 17 should intentionally review env/config rather than letting it drift.

---

## 17.16 Audit env variables

Create a table/document in repo:

```text id="dg7z27"
docs/ENVIRONMENT.md
```

Include:

```text id="bjwds5"
Variable
Required?
Default
Used by
Development behavior
Production behavior
Failure mode
```

High-priority groups:

```text id="w5l7fu"
Database
Auth/JWT/session
OpenAI/KEY
Google Calendar
Gmail
WhatsApp
Meta
Stripe/PayPal
Supabase
Sentry
Redis/BullMQ
Web push
Security audit
Semantic memory
```

---

## 17.17 Harden config validation

Review:

```text id="qbdpe3"
apps/server/src/config/env.ts
```

Goals:

```text id="orjlln"
1. Missing optional integration keys should not break local dev.
2. Missing required production keys should fail clearly.
3. Test env should use safe defaults.
4. Error messages should name the missing variable.
5. No secrets should be logged.
```

---

## 17.18 Update `.env.example`

Ensure `.env.example` matches actual config.

Sections:

```text id="lcdz39"
Core
Database
Auth
AI
Email/Gmail
WhatsApp
Meta
Calendar
Payments
Storage
Observability
Queues
Security
Development toggles
```

---

# Phase 17 Workstream 6 — Command Center Quality Pass

Because Phase 16 is the central UI, give it a QA pass.

---

## 17.19 Verify ranking behavior

Create fixtures to test:

```text id="apnnnq"
CRITICAL approval beats medium opportunity
Approved awaiting execution beats passive insight
Urgent Temporal Flow beats normal opportunity
Asset risk appears in risk section and top priorities
Constitution stale appears only once
Duplicate risks are deduped
```

The Command Center already uses a `TYPE_WEIGHT` ranking system.

---

## 17.20 Verify snapshot performance

The snapshot currently calls all executive modes in parallel.

That is good for correctness, but monitor performance.

Potential optimization later:

```text id="s3k1ih"
1. Cache mode summaries briefly.
2. Limit Command Center to key modes: STRATEGIST, CFO, CMO, COO, RISK_OFFICER.
3. Lazy-load full mode grid after initial snapshot.
```

For Phase 17, do not optimize prematurely. Just measure.

Add a simple logger/timer if already common in the codebase:

```text id="wa640u"
BusinessCommandCenterService.snapshot completed in X ms
```

---

## 17.21 Verify no direct unsafe execution from Command Center

Command Center should link to Key Autonomy, not execute inline.

Acceptance:

```text id="9a39lg"
No approve/execute mutation directly inside Command Center v1.
All execution routes through /app/key-autonomy.
```

---

# Phase 17 Workstream 7 — Documentation

Add:

```text id="s6hdil"
docs/KEYFLOWOS_PHASE_11_16_SUMMARY.md
docs/PHASE_17_STABILIZATION.md
docs/ENVIRONMENT.md
docs/TESTING.md
```

---

## 17.22 Phase summary doc

Document completed arc:

```text id="xr1796"
Phase 11 — Executive Brief Engine
Phase 12 — Living Constitution v2
Phase 13 — Document Pack Export
Phase 14 — KEY Executive Modes
Phase 15 — Permission-Based Autonomous KEY
Phase 16 — Business Command Center
```

Include:

```text id="wlhk11"
Purpose
Main routes
Main services
How they connect
Known limitations
Next roadmap
```

---

## 17.23 Testing doc

Include:

```text id="czhhyg"
How to run reliable tests
How to run smoke tests
How to run integration tests
Known flaky tests
How to add new tests
Timeout conventions
Mocking conventions
```

---

## 17.24 Production readiness checklist

Create:

```text id="9363qi"
docs/PRODUCTION_READINESS.md
```

Sections:

```text id="1rh4bx"
Build
Tests
Env
Database migrations
Auth
Payments
Email
WhatsApp
Calendar
Observability
Backups
Security
Rate limits
Background jobs
Smoke tests
Rollback plan
```

---

# Phase 17 Backend Acceptance Criteria

```text id="67myvc"
1. Reliable server test script exists.
2. Smoke test script exists.
3. Known flaky calendar/dev-auth tests are isolated or fixed.
4. Command Center service tests still pass.
5. Key Inbox tests still pass.
6. Key Autonomy tests still pass.
7. Executive Modes tests still pass.
8. Server build passes.
9. Server reliable test suite passes.
10. Full suite failure, if any, is documented and isolated.
```

---

# Phase 17 Frontend Acceptance Criteria

```text id="9z1dig"
1. /app/command-center is reachable from navigation.
2. /app/key-autonomy is reachable from navigation or Command Center.
3. /app/key-modes is reachable from Command Center/Intelligence.
4. Empty states are clear.
5. Error states are clear.
6. Web build passes.
7. Primary links between modules work.
```

---

# Phase 17 Documentation Acceptance Criteria

```text id="m4i1bs"
1. ENVIRONMENT.md exists.
2. TESTING.md exists.
3. PRODUCTION_READINESS.md exists.
4. Phase 11–16 summary exists.
5. Known flaky tests are documented with next action.
```

---

# Suggested Implementation Order

```text id="d7s5gc"
1. Add TESTING.md and define test categories.
2. Add reliable/smoke/integration/flaky test scripts.
3. Isolate known flaky calendar/dev-auth tests.
4. Add backend operating-system smoke test.
5. Add route smoke test.
6. Add Command Center nav/sidebar entry.
7. Add cross-links between Command Center, Key Modes, Key Autonomy, Intelligence, Temporal Flow, Genome.
8. Polish empty states.
9. Add ENVIRONMENT.md.
10. Update .env.example.
11. Harden env.ts error messages/defaults.
12. Add PRODUCTION_READINESS.md.
13. Add Phase 11–16 summary doc.
14. Run server build.
15. Run reliable server test suite.
16. Run targeted integration/flaky suite and document remaining failures.
17. Run web build.
18. Commit.
```

---

# Suggested Commits

```text id="h8ohpo"
chore: document phase 17 stabilization plan
chore: stabilize test suites and smoke coverage
chore: polish operating cockpit navigation and empty states
docs: add environment and production readiness guides
```

Alternative:

```text id="9fmkqy"
chore: phase 17 stabilization and production readiness
```

---

# Definition of Done

Phase 17 is complete when the platform has:

```text id="ry5f49"
A reliable test signal
A documented flaky-test strategy
A reachable Command Center
Clear empty/error states
Documented environment requirements
A production readiness checklist
A smoke-tested operating arc
```

The final system should feel like this:

```text id="2hnkz2"
The product is not just feature-complete.
It is navigable, testable, explainable, and ready to stabilize for real users.
```

That is the right bridge before any new Phase 18 product expansion.
