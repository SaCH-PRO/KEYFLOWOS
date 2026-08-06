# KEYFLOWOS — capability map

**What KEY can do today, and what it cannot.** Every verdict cites a `file:line`
you can open. If a claim here has no citation, it has not been verified and does
not belong.

Baseline re-derived 2026-08-06. Companion docs:
`neuro-atlas-code-mapping.md` (biology → code), `business-organism-map.md` (organ
checklist), `MASTER_ROLLOUT_PLAN.md` (phases), `PRODUCTION_STATE.md` (deployed).

| | |
|---|---|
| KEY tools | **137** — 46 read · 7 draft · 18 organize · 18 execute · 48 crud |
| Risk tiers | 73 T1 · 48 T2 · 13 T3 · 3 T4 |
| Write-family | 84 · read/draft 53 |
| Dispatch | 133 native `case` + 4 cortex-bridged — zero orphans, zero unhandled |
| Prisma models | 428 |
| Web screens | 202 `page.tsx`, **29 redirects/re-exports → 173 real** |
| Cortex services | 97 · server modules 101 · nav destinations 55 |
| Organ tools | 29 registered, **4 bridged** |
| Standing gates | **19 specs** — the original 14 plus `trust-explanation-wiring`, `standing-context-reachability`, `phantom-injection`, and the extended fabrication/honesty/domain-parity rules |
| Tests | **3,126 server · 117 web**, all green |

---

# Part 1 — The mind (CNS)

## 1.1 How anything runs at all

Only four entry points exist. Everything else is a callee.

| Entry point | Count |
|---|---|
| `@Cron` / `@Interval` (`ScheduleModule.forRoot()`, `app.module.ts:123`) | 9 services, 15 jobs |
| `@OnEvent` | 5 classes |
| `OnModuleInit` | 8 classes |
| HTTP / WS / the chat path (`ai/flow-orchestrator.service.ts`) | 4 controllers + 1 gateway |

## 1.2 The three termini

Everything the CNS computes reaches a human through exactly one of these.

**1. `standingContext` — one string, six subsystems.**
`CognitiveTriageService.triage()` concatenates endocrine, interoception, immune,
salience, epigenetics and incentive via `describeForPrompt()` calls at
`cognitive-triage.service.ts:336,343,354,365,376,385`.
`FlowOrchestratorService` appends it to the system prompt at
`flow-orchestrator.service.ts:1119-1122` (non-stream) and `:1496-1499` (stream).

> **Delete one line and six live systems go dark with no failing test.** This is
> the most load-bearing string in the codebase. See queue item 11.

**2. The perception block.** `buildPerceptionSection()`
(`flow-orchestrator.service.ts:551-621`) → `UnifiedMemoryRetrievalService`,
deadline-bounded, `userId`-scoped, `minRankScore: 0.5`. Atlas improvement #1 is
**done**.

**3. The awareness feed.** Background layers write `keyCortexMemory` rows typed by
`AWARENESS_TYPES` (`key-cortex-awareness.service.ts:22-38`); `GET
/api/v1/cortex/awareness` (`key-cortex.controller.ts:3265`) reads them;
`KeyAwarenessPanel.tsx:148` renders them. The only path where a background sweep
reaches a human unprompted.

## 1.3 Perception — LIVE

| Service | Capability | Driver |
|---|---|---|
| `key-cortex-event-bus` | Normalized pub/sub every organ publishes onto | callers (17 files) |
| `cognitive-event-bus` | Normalizes connector/business signals to one store | event bus |
| `event-emitter-flow-bridge:141` | Nest EventEmitter → cortex bus (`onAny`) | `OnModuleInit` |
| `flow-signal-bridge:24` | Bus event → FlowSignal (FINANCIAL/TEMPORAL/PEOPLE) | `OnModuleInit` |
| `key-cortex-organ-registrar:53` | Harvests `listTools()` from 5 organ adapters | `OnModuleInit` |
| `organs/temporal-flow-adapter:179,191,202` | Inbox message/opportunity/risk → bus | `@OnEvent` ×3 |
| `organs/key-inbox-adapter:161,173,185` | Message/reply/genome-signal → bus | `@OnEvent` ×3 |
| `organs/storelink-adapter:194,206` | Storefront order + lead form → bus | `@OnEvent` ×2 |
| `key-cortex-interoception` | Organ `getState()` polling; body integrity | triage `:330` |
| `unified-memory-retrieval` | 8 structured stores + semantic, ranked, scoped | per chat turn |
| `unified-memory-writer` | Canonical structured-memory write path | memory + document services |
| `key-cortex-intuition:525,687` | Weak-signal + churn-risk detection | `@Cron` hourly + daily 06:00 |
| `key-cortex-salience:138` | Amygdala — ranks threats/opportunities → cortisol | `@Cron` hourly |
| `key-cortex-awareness:78` | Reads back what the background noticed | HTTP |
| 18× `adapters/*-adapter` | Typed call surfaces replacing `as any` into 17 modules | connector + context assembly |
| `watchers/` ×3 | invoice-overdue · booking-no-show · sentiment | proactive engine |

## 1.4 Interpretation — LIVE (runs per chat message)

| Service | Capability | Note |
|---|---|---|
| `cognitive-triage` | Thalamus — grades reflex/standard/deliberate, sets token budget, temperature, tool exposure | assembles `standingContext` |
| `adaptive-router:66` | Multi-dimensional query classifier, no model call | |
| `key-cortex-query-pipeline` | Orchestration spine, 25+ delegates | |
| `key-cortex-expertise-lens` | Picks discipline + answer shape, deterministic | `flow-orchestrator:51` |
| `key-cortex-mood-detection` | Keyword mood classifier | → `CortexSession.mood` |
| `key-cortex-emotion` | Behavioural emotion vs user baseline | **deep-think only** |
| `key-cortex-temporal-reasoning` | Cycles, seasons, trends, forecasting | **deep-think only** |

## 1.5 Memory — LIVE (one exception)

| Service | Capability | Driver |
|---|---|---|
| `key-cortex-memory` | Preferences, facts, decisions, failures, successes | conversation service |
| `memory-consolidation:57` | Decay, promote, resolve conflicts — during each business's **local night** | `@Cron` hourly, circadian-gated `:69` |
| `key-cortex-learning` | Outcome loop + confidence calibration | 5 callers |
| `value-learning:20` | Approvals/rejections → weighted value constraints | REST + 1 caller (weak) |
| `key-cortex-genome-context` / `-bridge` | Genome-enriched context, autonomy gating, opportunity ranking | 6 callers |
| `key-cortex-epigenetics` | How a business *expresses* its genome — style, cadence | triage `:376` |
| **`knowledge-ingestion`** | Ingest external knowledge into semantic memory | **nothing — INERT**, tagged `@keyflow:dormant` |

## 1.6 Regulation — LIVE

| Service | Capability | Driver |
|---|---|---|
| `key-cortex-endocrine` | Four slow hormones (cortisol, dopamine, humility, malaise), persisted across restart | triage `:336` + 4 |
| `key-cortex-homeostasis:151` | Control loop — integrity vs set points, corrective hormones | `@Cron` 30 min |
| `key-cortex-circadian:35` | Suprachiasmatic nucleus — **timezone source of truth** | gate, no cron of its own |
| `key-cortex-immune:168` | Correlates anomalies that didn't know about each other | `@OnEvent` anomaly |
| `key-cortex-incentive` | Hormones addressed to the *team*, not to KEY | triage `:385` |
| `key-cortex-reflection:682,695,706,717` | Dream · synthesis · weekly · maintenance | `@Cron` ×4, idle-gated |
| `key-cortex-cerebellum:102` | Intended vs actual, error correction → learning | `@Cron` 6 h |
| `key-cortex-creativity:516` | Idea generation | `@Cron` 05:00 |
| `key-proactive-engine:72,113,138,170` | Morning brief · weekly digest · EOD · 15-min sweep | `@Cron` ×4, circadian-gated |
| `key-bi-engine:89` | Business mental model — revenue, cashflow, deals, health | `@Cron` `*/15` |
| `key-cortex-digest` | Composes daily/weekly briefs | proactive engine |
| `key-cortex-metacognition:35` | Confidence about its own confidence | **deep-think only** |

> Atlas §20/§32 (circadian) and improvement #8 are **done** —
> `key-cortex-circadian.service.ts:85,102` gates the proactive engine and memory
> consolidation, held by `parasympathetic-consolidation.spec.ts`.

## 1.7 Decision + action — LIVE

| Service | Capability |
|---|---|
| `key-cortex-tool-registry` | Single source of truth — risk tier, approval, idempotency, compensation |
| `key-cortex-actions:107` | Registers the legacy `cortex.*` tools |
| `key-cortex-efferent-bridge:66` | Mirrors `FLOW_TOOLS` into the registry — a thought becomes an action |
| `key-cortex-executor` | Real execution with error handling, rollback, audit |
| `key-cortex-planner` | Goal → plan; attaches a compensating action **before** each step runs |
| `key-cortex-saga` / `-saga-executor` / `-compensation` | Multi-step transactions, tenant-scoped rollback |
| `key-idempotency` | Replay protection |
| `key-cortex-approval-orchestrator` | Collapses 3 approval models into one path (widest cross-module reach) |
| `key-cortex-consciousness:205` | 11-step pipeline, 8 cognition layers — **proposals only, never executions** |
| `key-cortex-reasoning` + 25 delegates | The main chat brain |
| `key-cortex-safe-database` | Blood-brain barrier — tenant-scoped query/update wrappers |
| `key-cortex-lifecycle` | One `correlationId` from session → command → execution → audit |
| `key-cortex-trigger:36` | Rule engine subscribed to every bus event |
| `key-cortex-realtime:84-278` | 9 domain events + 5-min health tick → WebSocket |
| `key-cortex-ethics` | Seven immutable values + stakeholder veto — **deep-think only, see 1.9** |
| `key-cortex-reasoning-engine` | 7 reasoning modes — **deep-think only** |

## 1.8 Governance — LIVE

| Service | Capability | Note |
|---|---|---|
| `key-cortex-audit` | Unified audit writer with identity lineage | |
| `key-cortex-evidence` | SHA-256 proof-of-completion feeding DNA scoring | |
| `key-cortex-event` | Bridge-event emission | 11 callers |
| `self-assessment` / `eval-harness` / `digital-employee-acceptance` | State-of-KEY report, eval suites, acceptance scoring | **REST-only — no cron, no CI hook** (atlas #10 open) |
| **`trust-explanation:23`** | "Every recommendation explains itself" (Layer 7) | **INERT** |

## 1.9 Two structural facts to decide on

**Ethics never sees a tool call — and cannot as things stand.**
`KeyCortexEthicsService` is injected in exactly one place,
`key-cortex-consciousness.service.ts:187`. Consciousness runs only when
`shouldDeliberate` passes (`flow-orchestrator.service.ts:443-461`), which excludes
every action verb (`create|make|add|send|schedule|book|update|…|publish|post`).

The guard is deliberate and the reasoning at `:433-441` is sound:

> `processConsciously` injects the eight cognition layers and **NO executor**. It
> returns `actions` as PROPOSALS, never executions. So routing an action-bearing
> message there would produce excellent reasoning and silently perform nothing —
> the worst possible failure, because it looks like success.

Widening the guard would reintroduce exactly that. But the consequence stands:
the seven immutable values and the stakeholder veto — plus emotion, temporal
reasoning, metacognition, the reasoning engine and creativity — **never see a
tool call**.

The obvious fix is to invoke it *from the tool path*, beside
`AiOversightService`. **Measured 2026-08-06 — and the answer is no, not as
written.**

`evaluateAction(action, params, businessId)` takes the action as a **string** and
scores it with substring heuristics. Probed against all 78 real write tools:

| Probe | Result |
|---|---|
| 78 write tools, empty params | **0 denied** |
| `data_export_all_customers` | **PERMITTED** — though `data_export` is on its own `HIGH_RISK_ACTIONS` list |
| `third_party_share_contacts` | **PERMITTED** — likewise on that list |
| `marketing_send_campaign`, `bulkSize: 5000` | **PERMITTED** |
| `permanently_delete_all_contacts` | DENIED |
| `issue_refund` | DENIED unless `requiresApproval: true` |

The two hard vetoes in `computePermitted` fire on `permanent`+`delete` and on
`charge|bill|refund`. **No tool in the registry contains any of those
substrings** — the three `delete` tools do not say `permanent`. The veto is
unreachable by construction, and the high-risk flags that do fire are
non-critical and change nothing.

Wiring it would deny nothing that exists while creating the appearance of an
ethical gate — the exact failure this codebase keeps finding, in the component
whose own value list includes `honesty`. **Decision: not wired.**

What governs the tool path today is real and enforced: risk tiers plus approval
routing (`ai-oversight.service.ts:63,173-181`), T3/T4 requiring human approval.

Doing this properly means expressing the values check over **registry metadata**
— tier, family, recipient count, tenant scope, whether the action moves money or
leaves the building — rather than over how an action name happens to be spelled.
That is a build, not a wiring fix.

**Five dead services.** Two are a worse category: `@Optional()` is genuinely
present, so Nest binds `undefined`, boot stays clean, and every call site reads
as wired.

| Service | State |
|---|---|
| ~~`key-cortex-keystore-adapter.service.ts:20`~~ | **DELETED** — in no module, no caller |
| `cognition-session.service.ts` | Registered, zero injection sites — **kept, tagged `@keyflow:dormant`** |
| `knowledge-ingestion.service.ts` | Registered, zero injection sites — **kept, tagged `@keyflow:dormant`** |

**The rule applied:** delete what *lies*, keep and mark what is merely dormant.
`KeyCommandRouterService` claimed to be the single command pathway while
registered nowhere and read by nothing, and `KeyCortexKeystoreAdapterService` was
an orphan — both gone, along with a 204-line spec that constructed the router
directly with mocks and so passed while nothing could reach it. The other two are
honestly registered and simply unused; they carry the existing
`@keyflow:dormant` marker rather than a phantom injection, so nobody reads them
as live.

**And the class is now gated.** `phantom-injection.spec.ts` scans the whole
server: any `@Optional() @Inject(X)` where `X` appears in no `providers` array
fails the build. Without `@Optional()` Nest refuses to start and you find out in
seconds — `@Optional()` is precisely what converts a loud boot failure into a
silent permanent no-op. Both known instances are also asserted by name.
| ~~`trust-explanation.service.ts:23`~~ | **FIXED** — registered; held by `trust-explanation-wiring.spec.ts` |
| ~~`key-command-router.service.ts:28`~~ | **DELETED** — with its injection and its spec |

`key-command-router.service.ts` opens by claiming "ONE pathway for all commands.
No more direct Cortex execution." The opposite ships.

`trust-explanation` is the cheapest live fix in the repo: it has **zero
constructor dependencies**, and `key-cortex-query-pipeline.service.ts:988-998`
already has a real guarded call site waiting for it.

---

# Part 2 — The hands (arsenal)

## 2.1 The 8 roles

`ROLE_BASELINE_TOOLS` (`role-engine.service.ts:148`) is a 14-tool floor granted to
every role: orient (contacts, calendar, documents), know the team (4 people
reads), read what the customer said (2 inbox reads), plus `keyflow_create_note`
and `create_task` — no role should escalate to leave a note.

| Role | maxRiskTier | Reachable / 126 | Shape |
|---|---|---|---|
| `general` | 1 | **114** | Widest and most gated — 46 need confirmation. The fallback role. |
| `operator` | 3 | 95 | The only role that acts at T3 |
| `operations` | 2 | 85 | Cannot see an invoice |
| `marketing` | 2 | 54 | Blocks the last two content-delivery steps |
| `sales` | 2 | 50 | |
| `support` | 2 | 45 | |
| `finance` | 2 | 44 | Cannot see a booking or a project |
| `executive` | 1 | 40 | Near-pure read — 33 of 40 |

`maxRiskTier` **clamps auto-execute, it does not remove reach**
(`ai-oversight.service.ts:63,173-181`): above-tier tools stay `allowed: true` and
route to quick-confirm (T2), formal approval (T3) or admin approval (T4).

## 2.2 Bridged vs native

122 native, 4 bridged. Bridged tools are declared as full `FlowTool`s so they
inherit role allowlists, tiers and the CI route check, but have no handler —
`default:` (`flow-orchestrator.service.ts:4021`) routes them to
`executeBridgedCortexTool` `:4048`.

| Flow name | Cortex name |
|---|---|
| `inbox_list_threads` | `key_inbox.list_threads` |
| `inbox_read_thread` | `key_inbox.get_thread` |
| `inbox_brief` | `key_inbox.generate_brief` |
| `inbox_mark_resolved` | `key_inbox.mark_resolved` |

An explicit table rather than dynamic exposure because dotted names are illegal in
OpenAI/Anthropic function names, unbridged names silently collapse to tier 2, and
prompt cost (`flow-tool-registry.ts:2779-2793`).

**25 of 29 organ tools are unbridged** — genome (7), connector (5), storelink (7),
temporal (5) are invisible to chat. `key_inbox.send_reply` is deliberately
unbridged (`:2550`): `send_message_with_approval` covers it, and "two tools for
one action is how a model ends up sending twice."

## 2.3 Seven handlers that misreported — **all fixed 2026-08-06**

Kept as a record of the defect class, not as an open list. The gate that now
catches it is described in §5.1.


Prior honesty fixes held — `marketing_send_campaign` calls `sendCampaign`,
`commerce_send_invoice` throws on `delivery.status === 'FAILED'`, the five
`delegation_*` loops have handlers, `automations_create_playbook` warns when
action-less. These did not:

| # | Tool | Defect |
|---|---|---|
| **S1** | `sync_seo_pages:3443` | Upserts **one** page, returns `{synced: 1}` — a constant, not a count. `SeoService.syncPageInventory` (`seo.service.ts:290`) does the real crawl and is bypassed. |
| **S2** | `generate_content_brief:3458` | Raw-Prisma stub row. Family is `draft`; nothing is drafted. `SeoContentService.generateBrief:65` bypassed. |
| **S3** | `call_log_outcome:3546` | `const completed = await …completeCall()` never read; returns the input echoed. |
| **S4** | `evidence_verify:3597` | Result discarded, returns hardcoded `verified: true`. |
| **S5** | `content_submit_for_review:3513`, `content_deliver_request:3521` | Return `'INTERNAL_REVIEW'`/`'DELIVERED'`; the service and `VALID_TRANSITIONS` (`content-request.service.ts:26-31`) are lowercase → feeding a returned status back throws `BadRequestException`. |
| **S6** | `content_assign_request:3504`, `_transition_status:3508`, `_upload_deliverables:3517` | `await` uncaptured, return args. `uploaded` is the count KEY *asked for*. |
| **S7** | `finance_view_receivables:3758`, `fetch_content_gaps:3394` | Logic reimplemented in the switch while `ReceivablesService.getAging:220` and `detectContentGaps:16` exist — KEY's AR can diverge from the Finance screen's. |

**S1 and S2 are the worst**: success language for work not done — the class
`flow-tool-honesty` exists to eliminate, reappearing where that spec does not
look.

---

# Part 3 — The body (organs)

33 domains × four layers. Verdicts: **OPERATIONAL** (KEY can read and write) ·
**READ_ONLY** (KEY can see, not act) · **HANDS_OFF** (zero tools) ·
**DATA_ONLY** (model exists, no loop) · **SHELL** (UI renders invented data).

## 3.1 Zero-tool domains — HANDS_OFF

~~Deals~~ was the twelfth and is **DONE 2026-08-06** — 11 tools, see §3.6.
The rest, verified by direct count against `flow-tool-registry.ts`: `refund` 0 · `report` 0 · `goal` 0 · `contract` 0 · `inventory` 0 · `stock` 0 ·
`warehouse` 0 · `retainer` 0 · `portal` 0 · `asset` 0 · `procure` 0 · `supplier` 0.

| Domain | Service depth | Writable UI | Nav |
|---|---|---|---|
| **Inventory & stock** | continental-ops ~19 + marketplace | `inventory-command-center.tsx` **2,032** | ❌ |
| **Procurement / suppliers** | procurement 13 + supplier 24 | `procurement/[requestId]` 507 | ❌ |
| **Contracts** | contracts 14 | `contracts/page.tsx` **895** | ✅ `:182` |
| **Payments** | payments 11 + ops 8 | `payments/page.tsx` **792** | ❌ |
| **Reports** | reports + ledger-reporting 1,164 ln | `reports/page.tsx` **546** | ✅ `:129` |
| **Goals / strategy** | cortex-goals controller | `goals/page.tsx` **395** | ✅ `:192` |
| **Assets** | asset 9 (+3 parallel tables) | `assets/[id]` 452 | ❌ |
| **Retainers** | retainer 9 (periods dead) | `retainers/page.tsx` 157 | ❌ |
| **Legal / compliance** | governance (no legal module) | `legal/page.tsx` 157 | ✅ `:183` |
| **Portal** | portal 6 / 91 ln | `portal/page.tsx` 125 | ❌ |

Together: **~65 models, ~105 service methods, ~5,250 lines of writable UI KEY
cannot reach.** Four sit in the main nav — a user works in them daily and finds
the assistant blind.

## 3.2 READ_ONLY — service depth ≫ tool depth

| Domain | Service | Tools |
|---|---|---|
| **Community** | `community.service.ts` **53 public** — most of any service | 1 read |
| **Marketplace** | `marketplace.service.ts` **49 public** | 2 read |
| **Deep finance** | **43 files** — posting, reconciliation, tax, credit notes, periods, fixed assets | 3 read |
| **Documents & Drive** | documents 23 + drive 28 | 2 read; `drive_create_*` writes Drive, **not** `DocumentInstance` |
| **SEO** | seo 17 + 3 | 6 read, 0 write |

> **Correction to the rollout plan (2.7):** deep finance is *not* read-only for
> humans — 46 distinct mutations exist under `app/finance/**`. It is read-only
> **for KEY**, and `/app/finance` is not in nav.

## 3.3 Inverted and broken

**Time tracking — write-only.** 3 tools, all `organize`
(`registry:2146,2166,2183`), **zero reads**. KEY can start a timer it can never
find again, and cannot answer "how many hours did I log this week."
`time-tracking/page.tsx` is 600 lines and fully writable. Not in nav.

**Store performance tab — ~~SHELL~~ FIXED 2026-08-06.** Four panels rendered
hardcoded constants and never fetched; a fifth fabrication, `seedRandom()` →
`generateTrendData(30, 42)`, was charted as "Revenue & Profit Trend". Now wired
to `lib/api/store.ts` over endpoints that already existed
(`site.controller.ts:248-343`, `commerce-insights.controller.ts:45`). Customers
are grouped from the orders themselves — there is no customer table behind a
guest checkout — and profit joins order items to the landed-cost margin engine
the Commerce screens use. Per-promo revenue attribution, the invented status
timeline and the hardcoded trend deltas were removed rather than wired: no
source exists for them. See §5.1 for why the gate missed all of this.

**Helpdesk — stub data model.** `SupportTicket` (`schema.prisma:4223-4252`) is 30
lines with no message thread and no SLA (`slaBreach|slaDue|firstResponseAt` → 0
hits). `helpdesk.service.ts` is 116 lines, 5 methods. A second orphan table
`HelpdeskTicket:12366` is read once behind an `as any`
(`key-cortex-evolution.service.ts:2146,2164`).

**Retainers — DATA_ONLY periods.** `retainerPeriod` appears in exactly 4 places,
all inside `retainer.service.ts` (`:133,150,166,180`). `createPeriod:119` takes
`hoursUsed` as a caller parameter — there is no `TimeEntry` rollup and no code
path generates an invoice from a period. `apps/web/src/lib/retainers.ts` exports
zero period functions, so the half is unreachable from any UI.

## 3.6 Deals / pipeline — OPERATIONAL (added 2026-08-06)

11 tools over `CrmDealsService` (16 methods) plus the forecast and velocity
services. Read: list/filter, detail, stages, weighted forecast, velocity and
bottlenecks. Write: create, update, move stage, mark won, mark lost, delete.

Three decisions worth keeping: `deals_list_stages` exists because `moveStage`
takes an **id**, not a name, and a write without the lookup is a tool that can
only fail; win/lose are `execute`-family because closing a deal moves money in
every report; `deals_delete` is tier 3 and points at `deals_mark_lost`, since a
lost deal is history that win rates and velocity depend on. `deals_create`
compensates to a tenant-scoped soft delete — closing does **not** compensate,
because reopening a deal rewrites revenue history.

Held by `deals-tools.spec.ts` (12 assertions).

## 3.4 OPERATIONAL

CRM/contacts (12 tools) · commerce (9) · bookings (6) · calendar (3) · projects
(9) · expenses (3, no update/delete) · inbox (4) · marketing (7) · content ops
(**10 — best coverage in the repo**, full create→assign→transition→submit→upload→
deliver lifecycle) · social (4) · automations/flows (9) · approvals (3) · evidence
(3) · people/HR (5, read-heavy — no tool creates an OrgUnit, JobRole or
assignment).

## 3.5 Debt to record

**Nine domains absent from nav entirely** (verified: zero hits in
`nav-config.ts`): `/app/finance`, `/app/time-tracking`, `/app/payments`,
`/app/continental-ops`, `/app/procurement`, `/app/assets`, `/app/retainers`,
`/app/portal`, `/app/documents`. The 2,032-line inventory command centre is
reachable only as a tab inside a dormant-flagged marketplace page.

**Duplicate models:** tickets (`SupportTicket` vs orphan `HelpdeskTicket`) · goals
(`AiGoal` vs `BusinessGoal`, two disconnected systems) · assets (`Asset` /
`BusinessAsset` / `FixedAsset` / `MediaAsset`) · tasks (4) · campaigns (4).

---

# Part 4 — The queue

## Tier 0 — one-liners with real behaviour behind them
1. ~~**Register `TrustExplanationService`**~~ — **DONE 2026-08-06.**
2. ~~**Decide the two zombies**~~ — **DONE 2026-08-06.** Both deleted; the two
   honestly-dormant services tagged `@keyflow:dormant`; the class gated by
   `phantom-injection.spec.ts`.

## Tier 1 — close the gate blind spots (before adding more tools)
3. ~~**Extend `no-fabricated-screens`**~~ — **DONE 2026-08-06.** Walks component
   trees, flags placeholder-named constants feeding render state, covers non-nav
   screens, and catches synthesised (seeded-RNG) series. Negative-controlled: it
   failed on the four Store panels before they were fixed.
4. ~~**Fix the Store performance tab**~~ — **DONE 2026-08-06.**
5. ~~**Tighten manual-parity**~~ — **DONE 2026-08-06.** Domain parity is a
   reviewed list (25 documented cross-domain pairings, 3 fixed), because
   name-matching alone flags 28 of which most are correct. `time_*` →
   `/app/time-tracking`, `people_assign_task` → `/app/projects`, `documents_*` →
   `/app/document-intelligence`.

   Fixing the routes exposed a second defect the first had been hiding: the
   checker recognised only `@/lib/api` and `@/lib/client`, so `/app/time-tracking`
   — 600 lines writing through `@/lib/time-tracking` — read as having no write
   path. Nine such top-level api modules exist; detection is now by content
   (does this file wrap `./api`) rather than by path.

## Tier 2 — stop the misreporting — **ALL DONE 2026-08-06**
6. ~~**S1/S2**~~ — now call `SeoService.syncPageInventory` and
   `SeoContentService.generateBrief`.
7. ~~**S3/S4/S6**~~ — return what the service returned.
8. ~~**S5**~~ — statuses come from the service in its own vocabulary, and
   `deliverRequest` now returns `invoiceRequested`/`deliveryInvoiceId`/
   `invoiceError`; the tool **throws** when an invoice was due and did not
   appear, rather than reporting a clean delivery.
9. ~~**S7**~~ — `ReceivablesService.getAging` (basis-aware, ledger-reconciled,
   surfacing `ledgerDelta`) and `detectContentGaps`.
10. ~~**Extend `tool-honesty-sweep`**~~ — a handler that drops a service result
    cannot build its return from `args` and literals alone. Four void writes
    exempted by name with reasons. Negative-controlled against `evidence_verify`.

## Tier 3 — protect the CNS — **DONE 2026-08-06**
11. ~~Gate asserting the six `describeForPrompt()` outputs reach the prompt in
    both paths.~~ `standing-context-reachability.spec.ts`, 10 assertions.
    Negative control: removing only the streaming interpolation fails one
    assertion and leaves the other nine green.

## Tier 4 — organs, by value per unit of effort
Service and UI already exist for all of these; only tools are missing.

12. ~~**Deals**~~ — **DONE 2026-08-06.** 11 tools; see §3.6.
13. **Inventory & stock** — tools *and* a nav entry.
14. **Payments** — refund, payment link, retry.
15. **Contracts · reports · goals** — in nav, complete services, zero tools.
16. **Deep finance writes** — post a journal, reconcile, close a period.
17. **Procurement · assets · portal · legal** — plus nav entries.
18. **Time-tracking reads** — cheapest correctness fix in the list.
19. **Retainers** — the periods→hours→invoice loop exists in no service. Real
    build. Defer.
20. **Helpdesk** — no thread, no SLA. Product build. Defer.

## Owner decisions
- ~~**Ethics is not in the execution path**~~ — **decided 2026-08-06: not
  wired.** It denies 0 of 78 real write tools and permits two actions on its own
  high-risk list; see §1.9 for the probe. Gating on registry metadata rather
  than name spelling is a build, and belongs in the queue when wanted.
- **25 of 29 organ tools unbridged.** Bridge, or keep internal?
- **Addon packs do not gate tools** — 12 tools on `/app/seo` and
  `/app/call-tasks` work for businesses that cannot open the screen.
- **Nine domains not in nav**, including the finance and inventory work centres.
- **Eval harness is REST-only** — no cron, no CI hook.

---

# Part 5 — How this stays true

## 5.1 The gates have a blind spot

Every standing gate passes, and this map still found real defects. Both gate
families check a **shape** and not a **referent**.

**`no-fabricated-screens` missed fabricated panels** (closed 2026-08-06). Three
structural reasons the Store tab passed:

- `hasDataSource()` (`no-fabricated-screens.spec.ts:79-94`) returns true if
  **anything** in the import tree at depth 3 touches `@/lib/api`. Store fetches
  for its catalog, so the whole page is cleared.
- `FAKES_A_LOAD` (`:97`) is tested against `pageFor(route)` only (`:113`). The
  DEMO panels are components; the regex never sees them.
- It iterates nav destinations only — non-nav screens are never checked.

It also had no test for the actual smell: a module-scope constant assigned
straight into render state. Both gaps are now closed, plus a third the original
rule would still have missed — a deterministic RNG generating a chart series,
which is fabrication that never names itself a placeholder.

**Manual-parity checked *a* mutation, not *the* mutation** (closed 2026-08-06).
`time_*` were write-family pointing at `/app/projects`, which has mutations and
is not the time screen. `documents_*` → `/app/profile`; `people_assign_task` →
`/app/work/projects`, a one-line re-export shim.

The instructive part: pointing the time tools at the *correct* screen made
parity **fail**. `/app/time-tracking` writes through `@/lib/time-tracking`, and
the checker recognised only `@/lib/api` and `@/lib/client`. Two defects had been
concealing each other — the wrong route, and a checker that would have rejected
the right one. This is the general hazard with gates that pass: a green check can
mean the rule is satisfied *or* that the rule cannot see the thing it judges.

Still open in this family: `finance_view_receivables|list_action_items` →
`/app/finance` (`registry:2279,2311`), a 7-line redirect stub. Read-family, so
domain parity does not cover them, and `/app/finance` is not in nav at all.

Items 3 and 10 are **closed**; item 5 (manual-parity) remains open. Each gate was
made to **fail against `HEAD`** before the underlying defect was fixed — that is
the proof it catches the class rather than the instance.

`tool-honesty-sweep` gained the third blind spot in the same family: a handler
that drops a service result and answers with its own arguments. Seven handlers
shared that shape while the spec written for exactly this class passed them all,
because it only asked whether a tool that *claims to send* reaches a send path —
never whether a tool that *did* something reports what happened.

## 5.2 The 14 standing gates

`flow-tool-honesty` · `role-tool-reachability` · `tool-enum-validity` ·
`tool-honesty-sweep` · `cortex-tool-bridge` · `saga-compensation-wiring` ·
`invoice-send-delivery` · `system-actor-authority` · `people-tools` ·
`payment-recovery-deferral` · `disclosure-mode` · `middleware-redirect-targets` ·
`no-fabricated-screens` · `nav-destinations` · plus `check-tool-routes.ts`, which
self-tests that it can still fail.

Narrower CNS gates: `key-cortex-endocrine-durability` ·
`unified-memory-retrieval-scoping` · `key-cortex-evidence-discipline` ·
`key-cortex-efferent` · `intuition-signal-identity` · `key-cortex-planner-tenancy`
· `reflection-idle-gate` · `parasympathetic-consolidation` ·
`salience-awareness-surface` · `opportunity-signal-reachability` ·
`tool-name-collision` · `planner-saga-compensation`.

## 5.3 The rule

**No capability claim enters this document without a source read.** Producing
this map, three of the findings handed to it were wrong — a service reported as
having no-op call sites had none at all, a "dead" service turned out to have one
live guarded call site, and a deliberate design decision was reported as a gap.
Each was caught only by opening the file.

The same rule applies to audit reports, agent output, and this document's own
future edits.
