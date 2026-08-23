# KEY Cortex — The Reasoning & Action Layer

> KEY Cortex is the product's AI assistant, modelled in the code as a nervous system. Strip the biological naming and it is three things stacked: a **chat/reasoning pipeline** that turns a user's sentence into an LLM call enriched with business context; a **universal connector** that lets the LLM's tool calls reach into ~18 other KEYFLOWOS modules; and a **proactive layer** of cron jobs and watchers that reasons about a business when nobody asked. Everything else — the "organs", "endocrine system", "immune centre", "circadian clock", "amygdala", "cerebellum" — are helper services layered on top of those three. At 70,434 lines across 143 non-spec files it is the largest module in the repo by a wide margin, and the gap between how much of it is *constructed* and how much of it is *reached by a user* is the single most important fact on this page.

## How it works

**Cortex is a reasoning layer, not an orchestrator.** The distinction matters: it does not own long-running workflow state (that is `autopilot` and `temporal-flow`), and it does not own the autonomy policy (that is `key-autonomy`). What it owns is the *turn*: given a business, a user and a sentence, assemble context, decide, optionally call tools, and answer. Its 92 HTTP routes are almost all thin façades over one of ~10 subsystem services.

**The main path is `POST /api/v1/cortex/chat`.** [key-cortex.controller.ts](apps/server/src/modules/key-cortex/key-cortex.controller.ts) hands off to [key-cortex-reasoning.service.ts](apps/server/src/modules/key-cortex/key-cortex-reasoning.service.ts), which since the "Phase 0.7b" decomposition is a near-empty shell that forwards to [key-cortex-query-pipeline.service.ts](apps/server/src/modules/key-cortex/key-cortex-query-pipeline.service.ts). That pipeline is where the work happens, and it is explicitly staged — it writes an audit row at each step, named `STEP_1_RECEIVE_QUERY` through `STEP_13_14_COMPLETION_LAYER`: safety check, session load, goal-intent detection (which can divert the whole turn into [key-cortex-planner.service.ts](apps/server/src/modules/key-cortex/key-cortex-planner.service.ts)), adaptive routing, genome intelligence, memory retrieval, full-context assembly, intent parse, autonomy check, ranked recommendations, prompt build, the LLM call, action execution, outcome reporting, response generation. Roughly 25 collaborator services are `@Optional()`-injected into it, so each stage degrades to a skip rather than an error when its dependency is absent.

**Tool calls leave through two different doors, and they are not the same door.** The older path is [key-cortex-connector.service.ts](apps/server/src/modules/key-cortex/key-cortex-connector.service.ts), a 204-line router holding an `adapterMap` from module name to one of 18 typed adapters in [adapters/](apps/server/src/modules/key-cortex/adapters); the capability catalogue it advertises to the model lives in the 2,458-line [key-cortex-capability-registry.service.ts](apps/server/src/modules/key-cortex/key-cortex-capability-registry.service.ts). The newer path is [key-cortex-tool-registry.service.ts](apps/server/src/modules/key-cortex/key-cortex-tool-registry.service.ts), a canonical registry populated at boot by [key-cortex-organ-registrar.service.ts](apps/server/src/modules/key-cortex/key-cortex-organ-registrar.service.ts), which harvests `listTools()` from the five "organ" adapters plus the two safe-database wrappers. Both are live. The connector is the most-injected service in the slice; the registry is the one that carries per-tool risk tiers and outcome scoring.

**Writes are wrapped in an approval + saga + compensation stack.** [key-cortex-approval-orchestrator.service.ts](apps/server/src/modules/key-cortex/key-cortex-approval-orchestrator.service.ts) is the single gate that collapsed three older approval shapes into one; [key-idempotency.service.ts](apps/server/src/modules/key-cortex/key-idempotency.service.ts) dedupes on a key; [key-cortex-saga.service.ts](apps/server/src/modules/key-cortex/key-cortex-saga.service.ts) and [key-cortex-compensation.service.ts](apps/server/src/modules/key-cortex/key-cortex-compensation.service.ts) record steps and roll them back. [key-cortex-lifecycle.service.ts](apps/server/src/modules/key-cortex/key-cortex-lifecycle.service.ts) threads one `correlationId` through session → command → execution log → audit event, and [key-cortex-audit.service.ts](apps/server/src/modules/key-cortex/key-cortex-audit.service.ts) is the single writer for that trail. This part of the slice is genuinely well-built.

**The "consciousness" stack is a second, parallel reasoning path.** `POST /api/v1/cortex/conscious/chat` and its SSE twin go to [key-cortex-consciousness.service.ts](apps/server/src/modules/key-cortex/key-cortex-consciousness.service.ts), which runs an 11-step pipeline across eight "layers" — emotion, multi-modal reasoning, reflection, intuition, metacognition, creativity, ethics, temporal — each a separate service totalling ~11,000 lines. This path shares almost nothing with the main query pipeline; it is a distinct implementation of "answer a question", reachable at a different URL. The web app calls `conscious/stream` but never `chat` or `chat/stream`, so on the live product the *conscious* path is the one users actually hit and the main pipeline is reached only via `execute`.

**The proactive layer runs on cron and is the part that works without a user.** [key-proactive-engine.service.ts](apps/server/src/modules/key-cortex/key-proactive-engine.service.ts) owns four `@Cron` jobs; three of them fire hourly and use [key-cortex-circadian.service.ts](apps/server/src/modules/key-cortex/key-cortex-circadian.service.ts) to select only the businesses for which it is locally 8AM / Monday 9AM / 6PM, which is a genuinely careful fix for per-tenant timezones. They drive the three watchers in [watchers/](apps/server/src/modules/key-cortex/watchers) (overdue invoices, booking no-shows, sentiment) and [key-cortex-digest.service.ts](apps/server/src/modules/key-cortex/key-cortex-digest.service.ts). Alongside them, [key-cortex-reflection.service.ts](apps/server/src/modules/key-cortex/key-cortex-reflection.service.ts) runs four more crons (reflection, dream, synthesis, maintenance), [key-cortex-intuition.service.ts](apps/server/src/modules/key-cortex/key-cortex-intuition.service.ts) two, and [key-bi-engine.service.ts](apps/server/src/modules/key-cortex/key-bi-engine.service.ts), [key-cortex-cerebellum.service.ts](apps/server/src/modules/key-cortex/key-cortex-cerebellum.service.ts), [key-cortex-homeostasis.service.ts](apps/server/src/modules/key-cortex/key-cortex-homeostasis.service.ts), [key-cortex-salience.service.ts](apps/server/src/modules/key-cortex/key-cortex-salience.service.ts), [key-cortex-creativity.service.ts](apps/server/src/modules/key-cortex/key-cortex-creativity.service.ts) and [memory-consolidation.service.ts](apps/server/src/modules/key-cortex/memory-consolidation.service.ts) one each — **16 real cron registrations in this module alone**, all unconditional, with no leader election anywhere in the server.

**Two event buses coexist.** [key-cortex-event-bus.service.ts](apps/server/src/modules/key-cortex/key-cortex-event-bus.service.ts) is an in-process `Map`-backed pub/sub — subscribers live in memory, so nothing survives a restart or crosses a replica — which optionally mirrors into `CognitiveEvent` rows via [cognitive-event-bus.service.ts](apps/server/src/modules/key-cortex/cognitive-event-bus.service.ts). Separately, the app-wide `EventEmitter2` (registered globally with wildcards in `core/event-bus/event-bus.module.ts`) carries the 19 `@OnEvent` handlers in this slice. [event-emitter-flow-bridge.service.ts](apps/server/src/modules/key-cortex/event-emitter-flow-bridge.service.ts) and [flow-signal-bridge.service.ts](apps/server/src/modules/key-cortex/flow-signal-bridge.service.ts) exist to move traffic between the two.

**Reachability is the headline.** Every one of the 125 providers is registered, and `KeyCortexModule` is imported by `app.module.ts:261`, so all of it is constructed at boot. A transitive reference walk from the real roots (3 controllers, the gateway, every uncommented `@Cron`/`@OnEvent`, every `onModuleInit`) reaches 124 of 126 classes. But that is an upper bound measured at *class* granularity, and it flatters the module badly. Measured by what a browser can actually cause: of **92 HTTP route handlers, the web app calls just 11 distinct paths**, plus two more it calls that do not exist. The entire v5 WebSocket layer has no client. The whole sandbox, flow-studio, phone, document and evolution surfaces — roughly 8,500 lines behind 30 routes — have no caller outside their own controller methods. See [Wiring reality](#wiring-reality).

## Entry points

| Kind | Entry | File | Notes |
|---|---|---|---|
| http | `POST /api/v1/cortex/sessions` + `GET/PATCH/DELETE sessions[/:id]` (5 routes) | [key-cortex.controller.ts](apps/server/src/modules/key-cortex/key-cortex.controller.ts) | `AuthGuard` + `BusinessGuard` on the whole controller. No web caller. |
| http | `POST /api/v1/cortex/chat` | [key-cortex.controller.ts](apps/server/src/modules/key-cortex/key-cortex.controller.ts) | The main pipeline. **No web caller.** |
| sse | `GET /api/v1/cortex/chat/stream` | [key-cortex.controller.ts](apps/server/src/modules/key-cortex/key-cortex.controller.ts) | No web caller. |
| sse | `GET /api/v1/cortex/stream` | [key-cortex.controller.ts](apps/server/src/modules/key-cortex/key-cortex.controller.ts) | No web caller. |
| http | `POST /api/v1/cortex/execute` | [key-cortex.controller.ts](apps/server/src/modules/key-cortex/key-cortex.controller.ts) | **Called by web.** NL command → connector execution. |
| http | `GET /api/v1/cortex/context` | [key-cortex.controller.ts](apps/server/src/modules/key-cortex/key-cortex.controller.ts) | **Called by web.** ContextV2 snapshot. |
| http | `GET /api/v1/cortex/recommendations` | [key-cortex.controller.ts](apps/server/src/modules/key-cortex/key-cortex.controller.ts) | **Called by web.** |
| http | `GET /api/v1/cortex/awareness` | [key-cortex.controller.ts](apps/server/src/modules/key-cortex/key-cortex.controller.ts) | **Called by web.** |
| http | `GET/PATCH /api/v1/cortex/autonomy-profile` | [key-cortex.controller.ts](apps/server/src/modules/key-cortex/key-cortex.controller.ts) | **Called by web.** |
| sse | `GET /api/v1/cortex/conscious/stream` | [key-cortex.controller.ts](apps/server/src/modules/key-cortex/key-cortex.controller.ts) | **Called by web.** The 8-layer consciousness path. |
| http | `POST /api/v1/cortex/conscious/chat` | [key-cortex.controller.ts](apps/server/src/modules/key-cortex/key-cortex.controller.ts) | Non-streaming twin. No web caller. |
| http | `POST /api/v1/cortex/query`, `GET capabilities`, `GET actions/tools`, `POST actions/approve`, `POST feedback` | [key-cortex.controller.ts](apps/server/src/modules/key-cortex/key-cortex.controller.ts) | No web caller. |
| http | `POST /api/v1/cortex/voice/speak`, `voice/listen`, `GET voice/voices` | [key-cortex.controller.ts](apps/server/src/modules/key-cortex/key-cortex.controller.ts) | OpenAI TTS/Whisper. No web caller. |
| http | `GET personalities`, `POST personalities/switch` | [key-cortex.controller.ts](apps/server/src/modules/key-cortex/key-cortex.controller.ts) | No web caller. |
| http | `POST insights`, `GET insights/{profit,revenue,churn,pipeline}`, `GET report`, `POST profit-opportunities` | [key-cortex.controller.ts](apps/server/src/modules/key-cortex/key-cortex.controller.ts) | 7 routes over the insight engine. No web caller. |
| http | `POST/GET/PATCH monitors`, `POST monitors/:id/toggle`, `GET alerts` | [key-cortex.controller.ts](apps/server/src/modules/key-cortex/key-cortex.controller.ts) | No web caller. |
| http | `POST batch`, `POST rollback` | [key-cortex.controller.ts](apps/server/src/modules/key-cortex/key-cortex.controller.ts) | Saga-backed batch execution. No web caller. |
| http | `POST sandbox/{generate,execute,auto,apply,explain}`, `GET sandbox/templates` | [key-cortex.controller.ts](apps/server/src/modules/key-cortex/key-cortex.controller.ts) | **Arbitrary code execution.** No web caller. See Wiring reality. |
| http | `POST flows/generate`, `POST/GET flows`, `GET/PUT/DELETE flows/:id`, `POST flows/:id/{execute,toggle}`, `GET flows/templates`, `POST flows/apply-template`, `GET flows/nodes` | [key-cortex.controller.ts](apps/server/src/modules/key-cortex/key-cortex.controller.ts) | 11 routes. Two are shadowed and unreachable — see Wiring reality. |
| http | `POST phone/{call,script,analyze}`, `GET phone/{history,status}` | [key-cortex.controller.ts](apps/server/src/modules/key-cortex/key-cortex.controller.ts) | Twilio. No web caller. |
| http | `POST documents`, `GET documents`, `GET/DELETE documents/:id`, `POST documents/{ask,extract,compare}` | [key-cortex.controller.ts](apps/server/src/modules/key-cortex/key-cortex.controller.ts) | 8 routes, RAG over uploads. No web caller. |
| http | `GET evolution/{profile,patterns,report,decision}`, `POST evolution/tune` | [key-cortex.controller.ts](apps/server/src/modules/key-cortex/key-cortex.controller.ts) | No web caller. |
| http | `GET /api/v1/cortex/eval/suites`, `POST eval/run` | [key-cortex-audit.controller.ts](apps/server/src/modules/key-cortex/key-cortex-audit.controller.ts) | Runs against a synthetic `eval_biz`, not the caller's tenant. |
| http | `GET /api/v1/cortex/audit/decisions` | [key-cortex-audit.controller.ts](apps/server/src/modules/key-cortex/key-cortex-audit.controller.ts) | **Called by web. Cross-tenant leak — see Wiring reality.** |
| http | `GET /api/v1/cortex/audit/{values,assessment,acceptance}` | [key-cortex-audit.controller.ts](apps/server/src/modules/key-cortex/key-cortex-audit.controller.ts) | Same `@Param` defect; no web caller. |
| http | `POST/GET /api/v1/cortex/goals`, `GET goals/:goalId`, `DELETE goals/:goalId`, `POST goals/:goalId/plans` | [key-cortex-goals.controller.ts](apps/server/src/modules/key-cortex/key-cortex-goals.controller.ts) | **Called by web.** |
| http | `POST /api/v1/cortex/plans`, `GET plans/:planId`, `POST plans/:planId/execute` | [key-cortex-goals.controller.ts](apps/server/src/modules/key-cortex/key-cortex-goals.controller.ts) | `plans/:planId/execute` **called by web.** |
| http | `GET/POST /api/v1/cortex/triggers`, `PATCH triggers/:id` | [key-cortex-goals.controller.ts](apps/server/src/modules/key-cortex/key-cortex-goals.controller.ts) | No web caller. |
| websocket | namespace `/key-cortex`, messages `key:chat`, `key:approve`, `key:reject`, `key:typing` | [key-cortex.gateway.ts](apps/server/src/modules/key-cortex/key-cortex.gateway.ts) | Token-authenticated, membership-verified. **No client exists in the repo.** |
| cron | `EVERY_HOUR` ×3 — morning brief (local 8AM), weekly digest (local Mon 9AM), EOD (local 6PM); `*/15 * * * *` signal monitor | [key-proactive-engine.service.ts](apps/server/src/modules/key-cortex/key-proactive-engine.service.ts) | Drives all three watchers + digests. |
| cron | `EVERY_30_MINUTES` reflection; `0 3 * * *` dream; `0 4 * * 0` synthesis; `0 2 * * *` maintenance | [key-cortex-reflection.service.ts](apps/server/src/modules/key-cortex/key-cortex-reflection.service.ts) | Loops every active business. Output is in-memory only. |
| cron | `EVERY_HOUR` + `0 6 * * *` | [key-cortex-intuition.service.ts](apps/server/src/modules/key-cortex/key-cortex-intuition.service.ts) | Weak-signal scan. Persistence not implemented. |
| cron | `*/15 * * * *` | [key-bi-engine.service.ts](apps/server/src/modules/key-cortex/key-bi-engine.service.ts) | Business mental-model refresh into Redis. |
| cron | `EVERY_6_HOURS` | [key-cortex-cerebellum.service.ts](apps/server/src/modules/key-cortex/key-cortex-cerebellum.service.ts) | Intended-vs-actual error correction. Zero injectors; cron is its only entry. |
| cron | `EVERY_30_MINUTES` | [key-cortex-homeostasis.service.ts](apps/server/src/modules/key-cortex/key-cortex-homeostasis.service.ts) | Control loop over business health. |
| cron | `EVERY_HOUR` | [key-cortex-salience.service.ts](apps/server/src/modules/key-cortex/key-cortex-salience.service.ts) | Ranks what matters. |
| cron | `0 5 * * *` | [key-cortex-creativity.service.ts](apps/server/src/modules/key-cortex/key-cortex-creativity.service.ts) | Nightly ideation. |
| cron | `EVERY_HOUR` | [memory-consolidation.service.ts](apps/server/src/modules/key-cortex/memory-consolidation.service.ts) | Acts only during each business's local resting hours. |
| event | `business_event.anomaly_detected` | [key-cortex-immune.service.ts](apps/server/src/modules/key-cortex/key-cortex-immune.service.ts) | Threat response. |
| event | `key.action.executed/failed`, `key.approval.requested/resolved`, `key.insight.generated`, `key.alert`, `key.suggestion`, `key.health.update`, `key.reasoning.chunk`, `key.stats.requested` (10) | [key-cortex-realtime.service.ts](apps/server/src/modules/key-cortex/key-cortex-realtime.service.ts) | Forwards to the gateway — which has no clients. |
| event | `key_inbox.message_received`, `key_inbox.reply_sent`, `key_inbox.genome_signal_detected` | [organs/key-inbox-adapter.service.ts](apps/server/src/modules/key-cortex/organs/key-inbox-adapter.service.ts) | |
| event | `storefront.order_created`, `lead_form.submitted` | [organs/storelink-adapter.service.ts](apps/server/src/modules/key-cortex/organs/storelink-adapter.service.ts) | |
| event | `key_inbox.message_received`, `key_inbox.opportunity_detected`, `key_inbox.risk_detected` | [organs/temporal-flow-adapter.service.ts](apps/server/src/modules/key-cortex/organs/temporal-flow-adapter.service.ts) | |
| init | `onModuleInit` ×9 | organ registrar, actions, consciousness, efferent bridge, realtime, trigger, both flow bridges, temporal-flow adapter | Tool registration + subscription wiring at boot. |
| service | 109 exported providers | [key-cortex.module.ts](apps/server/src/modules/key-cortex/key-cortex.module.ts) | Consumed by `ai`, `approvals`, `key-autonomy` modules. |

## Files

143 non-spec source files: 114 in the module root, 19 in `adapters/`, 6 in `organs/`, 4 in `watchers/`.

### Root — reasoning pipeline

| File | Lines | What it does | Talks to |
|---|---|---|---|
| [key-cortex.controller.ts](apps/server/src/modules/key-cortex/key-cortex.controller.ts) | 3313 | 75 REST/SSE routes under `api/v1/cortex`; also declares 4 DTO classes. | Injects 24 services incl. `KeyCortexReasoningService`, `KeyCortexConnectorService`, `KeyCortexExecutorService`, `KeyCortexConsciousnessService`, `KeyAutonomySafetyService` |
| [key-cortex-reasoning.service.ts](apps/server/src/modules/key-cortex/key-cortex-reasoning.service.ts) | 1500 | Thin façade preserved for API compatibility; forwards to the query pipeline. 18 of its injected deps are never referenced. | Injects `KeyCortexQueryPipelineService` (+ 18 dead injections) |
| [key-cortex-query-pipeline.service.ts](apps/server/src/modules/key-cortex/key-cortex-query-pipeline.service.ts) | 1801 | The real 14-step chat pipeline: safety → session → routing → context → intent → autonomy → prompt → LLM → actions → response. | `ModelGatewayService`, ~25 `@Optional()` collaborators; writes `AiExecutionLog` |
| [key-cortex-reasoning-engine.service.ts](apps/server/src/modules/key-cortex/key-cortex-reasoning-engine.service.ts) | 1137 | Layer 2: seven reasoning modes (deductive, inductive, abductive, …) for the consciousness path. | `ModelGatewayService`; used by `KeyCortexConsciousnessService` |
| [key-cortex-session.service.ts](apps/server/src/modules/key-cortex/key-cortex-session.service.ts) | 298 | Get-or-create `CortexSession`, TTL from `KEY_CORTEX_SESSION_TTL_HOURS`. | `PrismaService`; model `CortexSession` |
| [key-cortex-prompt-context.service.ts](apps/server/src/modules/key-cortex/key-cortex-prompt-context.service.ts) | 189 | Assembles the message array sent to the model. | `KeyCortexContextService` |
| [key-cortex-system-prompt.service.ts](apps/server/src/modules/key-cortex/key-cortex-system-prompt.service.ts) | 299 | Builds the system prompt from persona + capabilities. | `KeyCortexPersonalityService`, capability registry |
| [key-cortex-tool-loop.service.ts](apps/server/src/modules/key-cortex/key-cortex-tool-loop.service.ts) | 284 | Runs the LLM ↔ tool-call loop until the model stops requesting tools. | `KeyCortexToolRegistryService`; `prisma` injected but unused |
| [key-cortex-action-detection.service.ts](apps/server/src/modules/key-cortex/key-cortex-action-detection.service.ts) | 195 | Detects action intent in free text when the model emitted no tool call. | Query pipeline |
| [key-cortex-provider-selection.service.ts](apps/server/src/modules/key-cortex/key-cortex-provider-selection.service.ts) | 68 | Chooses the AI provider for a turn. | `ModelGatewayService` |
| [key-cortex-structured-output.service.ts](apps/server/src/modules/key-cortex/key-cortex-structured-output.service.ts) | 241 | Coerces model output into typed shapes. | Query pipeline, reasoning |
| [key-cortex-mood-detection.service.ts](apps/server/src/modules/key-cortex/key-cortex-mood-detection.service.ts) | 52 | Classifies user mood to select tone. | Query pipeline |
| [key-cortex-suggestion.service.ts](apps/server/src/modules/key-cortex/key-cortex-suggestion.service.ts) | 101 | Generates follow-up suggestions appended to a response. | Query pipeline |
| [key-cortex-interaction.service.ts](apps/server/src/modules/key-cortex/key-cortex-interaction.service.ts) | 285 | Records interaction feedback for the learning loop. | `KeyCortexLearningService`, Prisma |
| [key-cortex-command-execution.service.ts](apps/server/src/modules/key-cortex/key-cortex-command-execution.service.ts) | 316 | Executes a parsed command via the connector, with audit. | `KeyCortexConnectorService`, `KeyCortexAuditService` |
| [key-cortex-legacy-insight.service.ts](apps/server/src/modules/key-cortex/key-cortex-legacy-insight.service.ts) | 438 | Pre-v2 insight generation kept for the legacy response shape. | Prisma |
| [key-cortex-quality.service.ts](apps/server/src/modules/key-cortex/key-cortex-quality.service.ts) | 189 | Scores a response for hedging/vagueness/evidence before return. | Query pipeline |
| [key-cortex-expertise-lens.service.ts](apps/server/src/modules/key-cortex/key-cortex-expertise-lens.service.ts) | 384 | Picks the professional discipline KEY reasons in (accountant, marketer, …). | Query pipeline |
| [key-cortex-expertise-lens.types.ts](apps/server/src/modules/key-cortex/key-cortex-expertise-lens.types.ts) | 62 | Lens enum + shapes. | — |
| [adaptive-router.service.ts](apps/server/src/modules/key-cortex/adaptive-router.service.ts) | 406 | Multi-dimensional query classifier (complexity, domain, urgency) choosing model tier. | Query pipeline, reasoning |
| [cognitive-triage.service.ts](apps/server/src/modules/key-cortex/cognitive-triage.service.ts) | 457 | "Thalamus" — decides how much cognition an inbound message deserves. | Inbox/organ paths |
| [key-cortex-reasoning.types.ts](apps/server/src/modules/key-cortex/key-cortex-reasoning.types.ts) | 75 | Shared reasoning types. | — |
| [key-cortex.types.ts](apps/server/src/modules/key-cortex/key-cortex.types.ts) | 282 | Core `CortexQuery`/`CortexResponse`/`CortexSession` types. | Whole slice |

### Root — consciousness stack (8 layers)

| File | Lines | What it does | Talks to |
|---|---|---|---|
| [key-cortex-consciousness.service.ts](apps/server/src/modules/key-cortex/key-cortex-consciousness.service.ts) | 1617 | The 11-step conscious pipeline orchestrating all 8 layers. Snapshots/goals/logs held in in-memory `Map`s. | Injects all 8 layer services + `KeyCortexContextV2Service`, `KeyCortexGenomeBridgeService`, `KeyCortexInteroceptionService`, `KeyCortexEndocrineService`; `modelGateway`, `personality`, `prisma` injected but unused |
| [key-cortex-consciousness.types.ts](apps/server/src/modules/key-cortex/key-cortex-consciousness.types.ts) | 928 | Type system for the consciousness layer. | — |
| [key-cortex-emotion.service.ts](apps/server/src/modules/key-cortex/key-cortex-emotion.service.ts) | 923 | Layer 1: detects user emotion, calibrates KEY's emotional response. | Consciousness |
| [key-cortex-reflection.service.ts](apps/server/src/modules/key-cortex/key-cortex-reflection.service.ts) | 1689 | Layer 3: reflection + "dream mode" hypothesis generation. 4 crons. Dream journal is an in-memory `Map`; DB persistence explicitly absent (`:572`, `:627`, `:1194`, `:1480`). | Consciousness; `insightService`/`modelGateway` injected but unused |
| [key-cortex-intuition.service.ts](apps/server/src/modules/key-cortex/key-cortex-intuition.service.ts) | 2299 | Layer 4: weak-signal detection. 2 crons. Signal persistence absent (`:481`, `:2264`). | Consciousness; `modelGateway` injected but unused |
| [key-cortex-metacognition.service.ts](apps/server/src/modules/key-cortex/key-cortex-metacognition.service.ts) | 1109 | Layer 5: confidence calibration and self-model. No spec. | Consciousness |
| [key-cortex-creativity.service.ts](apps/server/src/modules/key-cortex/key-cortex-creativity.service.ts) | 1700 | Layer 6: ideation engine. Cron `0 5 * * *`. | Consciousness; `modelGateway`/`insightService` injected but unused |
| [key-cortex-ethics.service.ts](apps/server/src/modules/key-cortex/key-cortex-ethics.service.ts) | 1091 | Layer 7: ethical review of recommendations. | Consciousness |
| [key-cortex-temporal-reasoning.service.ts](apps/server/src/modules/key-cortex/key-cortex-temporal-reasoning.service.ts) | 1367 | Layer 8: time-aware reasoning. `contextV2` injected but unused. | Consciousness |

### Root — "nervous system" / homeostatic services

| File | Lines | What it does | Talks to |
|---|---|---|---|
| [key-cortex-event-bus.service.ts](apps/server/src/modules/key-cortex/key-cortex-event-bus.service.ts) | 258 | In-process `Map`-backed pub/sub; the most-injected bus in the slice (16 consumers). Mirrors to `CognitiveEvent`. | `CognitiveEventBusService` (optional), Prisma |
| [cognitive-event-bus.service.ts](apps/server/src/modules/key-cortex/cognitive-event-bus.service.ts) | 66 | Normalizes signals into the `CognitiveEvent` store. | Prisma; model `CognitiveEvent` |
| [event-emitter-flow-bridge.service.ts](apps/server/src/modules/key-cortex/event-emitter-flow-bridge.service.ts) | 441 | Bridges `EventEmitter2` domain events into the cortex bus at boot. | `KeyCortexEventBusService`, `EventEmitter2` |
| [flow-signal-bridge.service.ts](apps/server/src/modules/key-cortex/flow-signal-bridge.service.ts) | 134 | Bridges the cortex bus into canonical `FlowSignal`s. | `FlowSignalModule` |
| [key-cortex-efferent-bridge.service.ts](apps/server/src/modules/key-cortex/key-cortex-efferent-bridge.service.ts) | 164 | Turns a decision into an organ action ("thought → action"). | Organ adapters, tool registry |
| [key-cortex-interoception.service.ts](apps/server/src/modules/key-cortex/key-cortex-interoception.service.ts) | 259 | Afferent half: organs report state back to the brain. | `KeyCortexOrganRegistrarService.listAdapters()` |
| [key-cortex-awareness.service.ts](apps/server/src/modules/key-cortex/key-cortex-awareness.service.ts) | 222 | Read-back of what KEY noticed; backs `GET /awareness`. | Salience, Prisma |
| [key-cortex-salience.service.ts](apps/server/src/modules/key-cortex/key-cortex-salience.service.ts) | 555 | "Amygdala" — ranks noticed signals by importance. Cron hourly. | Event bus, Prisma |
| [key-cortex-homeostasis.service.ts](apps/server/src/modules/key-cortex/key-cortex-homeostasis.service.ts) | 333 | Control loop pulling business metrics back toward setpoints. Cron 30 min. | Prisma, endocrine |
| [key-cortex-cerebellum.service.ts](apps/server/src/modules/key-cortex/key-cortex-cerebellum.service.ts) | 284 | Compares intended vs actual outcomes and corrects. Cron 6 h. **Zero injectors** — cron is its only caller. | Prisma |
| [key-cortex-endocrine.service.ts](apps/server/src/modules/key-cortex/key-cortex-endocrine.service.ts) | 431 | Slow diffuse modulation (hormone-like global state). 5 consumers. | Prisma, Redis |
| [key-cortex-circadian.service.ts](apps/server/src/modules/key-cortex/key-cortex-circadian.service.ts) | 122 | `localHour`/`businessesAtLocalHour`/`isRestingHours` via `Intl` + `Business.timezone`. No cron of its own. | Consumed by proactive engine + memory consolidation |
| [key-cortex-immune.service.ts](apps/server/src/modules/key-cortex/key-cortex-immune.service.ts) | 481 | Threat/anomaly response. `@OnEvent('business_event.anomaly_detected')`. | Event bus, Prisma |
| [key-cortex-epigenetics.service.ts](apps/server/src/modules/key-cortex/key-cortex-epigenetics.service.ts) | 327 | Per-business expression toggles over inherited defaults. | Prisma |
| [key-cortex-incentive.service.ts](apps/server/src/modules/key-cortex/key-cortex-incentive.service.ts) | 259 | Reward shaping for learned behaviour. | Prisma |
| [calm-mode.config.ts](apps/server/src/modules/key-cortex/calm-mode.config.ts) | 155 | Static config damping proactive output. | Proactive engine |

### Root — connector, tools & execution

| File | Lines | What it does | Talks to |
|---|---|---|---|
| [key-cortex-connector.service.ts](apps/server/src/modules/key-cortex/key-cortex-connector.service.ts) | 204 | Routes a `ConnectorCommand` to one of 18 adapters via `adapterMap`. Most-injected service in the slice (24 consumers). No spec. | All 18 adapters, `KeyCortexCapabilityRegistryService` |
| [key-cortex-capability-registry.service.ts](apps/server/src/modules/key-cortex/key-cortex-capability-registry.service.ts) | 2458 | Declares every module capability advertised to the LLM. Largest untested file in the slice. | Connector |
| [key-cortex-connector.types.ts](apps/server/src/modules/key-cortex/key-cortex-connector.types.ts) | 373 | `ModuleName` union, command/result shapes. | Connector + adapters |
| [key-cortex-connector.utils.ts](apps/server/src/modules/key-cortex/key-cortex-connector.utils.ts) | 31 | `connectorOk` / `connectorFail` helpers. | All adapters |
| [key-cortex-context-assembly.service.ts](apps/server/src/modules/key-cortex/key-cortex-context-assembly.service.ts) | 315 | Assembles the business context snapshot. No spec. | Connector, Prisma |
| [key-cortex-tool-registry.service.ts](apps/server/src/modules/key-cortex/key-cortex-tool-registry.service.ts) | 858 | Canonical tool registry with risk tiers, outcome scoring, gateway definitions. | Organ registrar, tool loop; model `ToolOutcomeScore` |
| [key-cortex-action-executor.plugin.ts](apps/server/src/modules/key-cortex/key-cortex-action-executor.plugin.ts) | 128 | Plugin adapter registering cortex execution into the wider action system. | `KeyCortexExecutorService` |
| [key-cortex-actions.service.ts](apps/server/src/modules/key-cortex/key-cortex-actions.service.ts) | 787 | Legacy action-execution façade with approval flow. `toolRegistry` injected but unused. | Approval orchestrator, Prisma |
| [key-cortex-executor.service.ts](apps/server/src/modules/key-cortex/key-cortex-executor.service.ts) | 1525 | Real execution with error handling, rollback and audit. | Connector, saga, compensation, audit |
| [key-cortex-command.service.ts](apps/server/src/modules/key-cortex/key-cortex-command.service.ts) | 917 | Natural language → structured `ConnectorCommand`. | `ModelGatewayService`, capability registry |
| [key-cortex-safe-database.service.ts](apps/server/src/modules/key-cortex/key-cortex-safe-database.service.ts) | 316 | Authority-gated `QUERY_DATABASE` / `UPDATE_RECORD` tool wrappers. | Tool registry, Prisma |
| [safe-expression.ts](apps/server/src/modules/key-cortex/safe-expression.ts) | 189 | Dependency-free bounded expression evaluator for flow conditions. | Flow studio, triggers |
| [key-cortex-sandbox.service.ts](apps/server/src/modules/key-cortex/key-cortex-sandbox.service.ts) | 1251 | AI code generation + execution: SQL via Prisma, JS via `vm.runInNewContext`, Python via `spawn('python3')`, HTML passthrough. No spec. | `AiUsageService`, Prisma, Redis; `modelGateway` injected but unused |
| [key-cortex-sandbox.types.ts](apps/server/src/modules/key-cortex/key-cortex-sandbox.types.ts) | 183 | Sandbox request/result types. | — |

### Root — governance, approval & audit

| File | Lines | What it does | Talks to |
|---|---|---|---|
| [key-cortex-approval-orchestrator.service.ts](apps/server/src/modules/key-cortex/key-cortex-approval-orchestrator.service.ts) | 242 | Single canonical approval gate collapsing three legacy shapes. | `KeyActionProposal`, `ApprovalRequest`, audit |
| [key-cortex-approval.service.ts](apps/server/src/modules/key-cortex/key-cortex-approval.service.ts) | 334 | Adapter over the canonical proposal system. | Approval orchestrator |
| [key-cortex-audit.service.ts](apps/server/src/modules/key-cortex/key-cortex-audit.service.ts) | 56 | Thin wrapper ensuring every governance event carries identity lineage. | `BusinessEvent`, Prisma |
| [key-cortex-audit.controller.ts](apps/server/src/modules/key-cortex/key-cortex-audit.controller.ts) | 108 | 6 routes: eval harness + audit read-backs. **4 handlers read a path param the route never defines.** | `EvalHarnessService`, `ValueLearningService`, `SelfAssessmentService`, `ComplianceMapService`, Prisma |
| [key-cortex-evidence.service.ts](apps/server/src/modules/key-cortex/key-cortex-evidence.service.ts) | 363 | Creates evidence rows proving work completion. No spec. | Prisma, genome bridge |
| [key-cortex-lifecycle.service.ts](apps/server/src/modules/key-cortex/key-cortex-lifecycle.service.ts) | 433 | Threads one `correlationId` across session/command/execution/audit. | Audit, Prisma |
| [key-idempotency.service.ts](apps/server/src/modules/key-cortex/key-idempotency.service.ts) | 107 | Idempotency registry for autonomous actions. | Model `IdempotencyKey` |
| [key-cortex-saga.service.ts](apps/server/src/modules/key-cortex/key-cortex-saga.service.ts) | 198 | Saga orchestrator for multi-step operations. | Models `SagaExecution`, `SagaStep` |
| [key-cortex-saga-executor.service.ts](apps/server/src/modules/key-cortex/key-cortex-saga-executor.service.ts) | 167 | Saga-backed batch executor behind `POST /batch`. | Saga, compensation, executor |
| [key-cortex-compensation.service.ts](apps/server/src/modules/key-cortex/key-cortex-compensation.service.ts) | 388 | Per-action rollback handlers. Two autopilot compensations are TODO no-ops (`:275`, `:287`). | Adapters, saga |
| [value-learning.service.ts](apps/server/src/modules/key-cortex/value-learning.service.ts) | 100 | Approvals/rejections → weighted value constraints; drift detection. No spec. | Model `ValueConstraint` |
| [self-assessment.service.ts](apps/server/src/modules/key-cortex/self-assessment.service.ts) | 52 | Periodic "state of KEY" report. No spec. | Prisma |
| [digital-employee-acceptance.service.ts](apps/server/src/modules/key-cortex/digital-employee-acceptance.service.ts) | 78 | Acceptance-test scenario skeleton. No spec. | Prisma |
| [eval-harness.service.ts](apps/server/src/modules/key-cortex/eval-harness.service.ts) | 256 | Named eval suites run against a synthetic `eval_biz`. | `AutonomyOrchestratorService` |
| [trust-explanation.service.ts](apps/server/src/modules/key-cortex/trust-explanation.service.ts) | 272 | Explains why an action was recommended. Live in the query pipeline; **dead in the reasoning service**. | Query pipeline (`:988`) |
| [cortex-genome-contracts.ts](apps/server/src/modules/key-cortex/cortex-genome-contracts.ts) | 312 | Stabilized Cortex ↔ Genome contract types. | Genome bridge |

### Root — context, memory & learning

| File | Lines | What it does | Talks to |
|---|---|---|---|
| [key-cortex-context-v2.service.ts](apps/server/src/modules/key-cortex/key-cortex-context-v2.service.ts) | 1643 | Aggregates context across all modules; backs `GET /context`. 10 consumers. | Connector, Prisma, Redis |
| [key-cortex-context.service.ts](apps/server/src/modules/key-cortex/key-cortex-context.service.ts) | 367 | Legacy genome/activity snapshot. No spec. | Prisma |
| [key-cortex-genome-context.service.ts](apps/server/src/modules/key-cortex/key-cortex-genome-context.service.ts) | 286 | Genome-enriched context with Redis TTL from `KEY_CORTEX_GENOME_CONTEXT_TTL_SECONDS`. | Genome bridge, Redis |
| [key-cortex-memory.service.ts](apps/server/src/modules/key-cortex/key-cortex-memory.service.ts) | 280 | Persistent multi-type memory. | Model `KeyCortexMemory` |
| [unified-memory-writer.service.ts](apps/server/src/modules/key-cortex/unified-memory-writer.service.ts) | 161 | Canonical structured-memory writer (Phase 0.9). | `KeyCortexMemory`, `CognitionMemory` |
| [unified-memory-writer.types.ts](apps/server/src/modules/key-cortex/unified-memory-writer.types.ts) | 25 | Writer input shapes. | — |
| [unified-memory-retrieval.service.ts](apps/server/src/modules/key-cortex/unified-memory-retrieval.service.ts) | 505 | Single retrieval layer over all memory stores. 6 consumers. | `AiMemory`, `KeyCortexMemory`, `SemanticMemoryService` |
| [unified-memory.types.ts](apps/server/src/modules/key-cortex/unified-memory.types.ts) | 79 | Normalized memory fragment type. | — |
| [key-cortex-memory-retrieval.service.ts](apps/server/src/modules/key-cortex/key-cortex-memory-retrieval.service.ts) | 31 | Roadmap-named facade over the unified retrieval layer. | `UnifiedMemoryRetrievalService` |
| [memory-consolidation.service.ts](apps/server/src/modules/key-cortex/memory-consolidation.service.ts) | 188 | Hourly cron; consolidates only during each business's local resting hours. | `KeyCortexCircadianService`, memory writer |
| [knowledge-ingestion.service.ts](apps/server/src/modules/key-cortex/knowledge-ingestion.service.ts) | 119 | Chunks + indexes external knowledge into semantic memory. **`@keyflow:dormant` — zero callers.** | `SemanticMemoryService`, model `KnowledgeSource` |
| [cognition-session.service.ts](apps/server/src/modules/key-cortex/cognition-session.service.ts) | 74 | CRUD over `CognitionSession`. **`@keyflow:dormant` — zero callers.** | Model `CognitionSession` |
| [key-cortex-learning.service.ts](apps/server/src/modules/key-cortex/key-cortex-learning.service.ts) | 561 | Persistent learning loop + confidence calibration. 7 consumers. | Prisma, interaction service |
| [key-cortex-evolution.service.ts](apps/server/src/modules/key-cortex/key-cortex-evolution.service.ts) | 2179 | Self-evolution: pattern detection, auto-tuning, decision explanation. No spec. `aiUsage` injected but unused. | Prisma, learning |

### Root — proactive, insight & delivery

| File | Lines | What it does | Talks to |
|---|---|---|---|
| [key-proactive-engine.service.ts](apps/server/src/modules/key-cortex/key-proactive-engine.service.ts) | 556 | 4 crons; timezone-aware briefs/digests/EOD + 15-min signal monitor. Drives all three watchers. | Circadian, watchers, digest, Prisma |
| [key-cortex-trigger.service.ts](apps/server/src/modules/key-cortex/key-cortex-trigger.service.ts) | 187 | Rule-based triggers; `onModuleInit` loads rules. | Model `KeyCortexTriggerRule` |
| [key-cortex-digest.service.ts](apps/server/src/modules/key-cortex/key-cortex-digest.service.ts) | 250 | Daily/weekly digest generation + delivery. | Communications, BI engine |
| [key-bi-engine.service.ts](apps/server/src/modules/key-cortex/key-bi-engine.service.ts) | 668 | Business mental model cached in Redis; cron every 15 min. | Prisma, Redis |
| [key-cortex-insight.service.ts](apps/server/src/modules/key-cortex/key-cortex-insight.service.ts) | 1314 | Profit/revenue/churn/pipeline analysis behind 7 routes. 8 consumers. No spec. | Prisma |
| [key-cortex-monitor-v2.service.ts](apps/server/src/modules/key-cortex/key-cortex-monitor-v2.service.ts) | 814 | Autonomous monitor loop management behind the `monitors` routes. No spec. | Prisma, executor |
| [key-cortex-planner.service.ts](apps/server/src/modules/key-cortex/key-cortex-planner.service.ts) | 596 | Goals → plans → steps → execution. 6 consumers. | Models `AiGoal`, `AiPlan`, `AiPlanStep` |
| [key-cortex-goals.controller.ts](apps/server/src/modules/key-cortex/key-cortex-goals.controller.ts) | 278 | 11 routes for goals/plans/triggers + validated DTOs. `prisma` injected but unused. | Planner, trigger service |

### Root — genome, realtime & I/O

| File | Lines | What it does | Talks to |
|---|---|---|---|
| [key-cortex-genome-bridge.service.ts](apps/server/src/modules/key-cortex/key-cortex-genome-bridge.service.ts) | 717 | Bidirectional Cortex ↔ Business Genome: autonomy gating, opportunity detection, recommendation ranking. 9 consumers. `outcomeLearningService` injected but unused. | `BlueprintModule`, `BusinessGenomeModule`, models `BusinessGenome`, `GenomeRecommendation` |
| [key-cortex-event.service.ts](apps/server/src/modules/key-cortex/key-cortex-event.service.ts) | 423 | Emits bridge events for audit/monitoring. 11 consumers. No spec. | `BusinessEvent`, event bus |
| [key-cortex.gateway.ts](apps/server/src/modules/key-cortex/key-cortex.gateway.ts) | 526 | socket.io namespace `/key-cortex`; 4 message handlers. **No client exists.** | Reasoning, approval, executor, `KeyCortexWsAuthService` |
| [key-cortex-ws-auth.service.ts](apps/server/src/modules/key-cortex/key-cortex-ws-auth.service.ts) | 136 | Validates handshake bearer token + business membership. | `AuthModule`, Prisma |
| [key-cortex-realtime.service.ts](apps/server/src/modules/key-cortex/key-cortex-realtime.service.ts) | 293 | 10 `@OnEvent` handlers forwarding domain events to the gateway. No spec. | Gateway, `EventEmitter2` |
| [key-cortex-personality.service.ts](apps/server/src/modules/key-cortex/key-cortex-personality.service.ts) | 707 | Persona/tone/voice management. 7 consumers. | Prisma |
| [key-cortex-conversation.service.ts](apps/server/src/modules/key-cortex/key-cortex-conversation.service.ts) | 889 | Session lifecycle + message history. | Models `CortexSession`, `Message` |
| [key-cortex-voice.service.ts](apps/server/src/modules/key-cortex/key-cortex-voice.service.ts) | 655 | OpenAI TTS/Whisper with persona voice mapping. No spec. S3 upload is TODO (`:647`). | `openai`, `OPENAI_API_KEY`; `personalityService` injected but unused |
| [key-cortex-phone.service.ts](apps/server/src/modules/key-cortex/key-cortex-phone.service.ts) | 1125 | Twilio calls, scripts, transcripts, analysis. No spec. `aiUsage` injected but unused. | Twilio env vars |
| [key-cortex-document.service.ts](apps/server/src/modules/key-cortex/key-cortex-document.service.ts) | 1244 | RAG: upload, extract, compare, Q&A. No spec. Object storage is TODO (`:1190`). | `openai`, models `VisualIntake`, `ExtractedEntity` |
| [key-cortex-flow-studio.service.ts](apps/server/src/modules/key-cortex/key-cortex-flow-studio.service.ts) | 2650 | Visual workflow builder + execution engine behind 11 routes. No spec. | Prisma, `safe-expression.ts`, models `Automation`, `Workflow` |
| [key-cortex-flow-studio.types.ts](apps/server/src/modules/key-cortex/key-cortex-flow-studio.types.ts) | 355 | Flow node/edge types. | — |
| [key-cortex.module.ts](apps/server/src/modules/key-cortex/key-cortex.module.ts) | 732 | 32 module imports, 3 controllers, 125 providers, 109 exports. | `app.module.ts:261` |

### adapters/ — typed module adapters behind the connector

Each exposes `execute(ConnectorCommand): Promise<ConnectorResult>` and is dispatched by `KeyCortexConnectorService.adapterMap`.

| File | Lines | What it does | Talks to |
|---|---|---|---|
| [crm-adapter.service.ts](apps/server/src/modules/key-cortex/adapters/crm-adapter.service.ts) | 442 | 20 CRM actions (contacts, deals, tasks). | `CrmService` |
| [commerce-adapter.service.ts](apps/server/src/modules/key-cortex/adapters/commerce-adapter.service.ts) | 439 | 17 commerce actions (invoices, products, orders). | `CommerceService` |
| [bookings-adapter.service.ts](apps/server/src/modules/key-cortex/adapters/bookings-adapter.service.ts) | 468 | 14 booking/availability actions. | `PrismaService`, bookings module |
| [inbox-adapter.service.ts](apps/server/src/modules/key-cortex/adapters/inbox-adapter.service.ts) | 347 | 15 KeyInbox thread/message actions. | Prisma, `KeyInboxModule` |
| [flow-adapter.service.ts](apps/server/src/modules/key-cortex/adapters/flow-adapter.service.ts) | 279 | 14 flow/automation actions. | Prisma, `FlowModule` |
| [autopilot-adapter.service.ts](apps/server/src/modules/key-cortex/adapters/autopilot-adapter.service.ts) | 266 | 14 autopilot task actions. | Prisma, `AutopilotModule` (forwardRef) |
| [social-adapter.service.ts](apps/server/src/modules/key-cortex/adapters/social-adapter.service.ts) | 251 | 12 social post/engagement actions. `publishing` injected but unused. | Prisma, `SocialModule` |
| [projects-adapter.service.ts](apps/server/src/modules/key-cortex/adapters/projects-adapter.service.ts) | 225 | 12 project actions. No spec. | `ProjectsService` |
| [analytics-adapter.service.ts](apps/server/src/modules/key-cortex/adapters/analytics-adapter.service.ts) | 223 | Analytics queries. | `AnalyticsEngineService` |
| [temporal-adapter.service.ts](apps/server/src/modules/key-cortex/adapters/temporal-adapter.service.ts) | 218 | 12 temporal-flow memory actions. | `TemporalFlowMemoryService` |
| [finance-adapter.service.ts](apps/server/src/modules/key-cortex/adapters/finance-adapter.service.ts) | 189 | Expense/finance actions. `accounts` injected but unused. | `ExpensesService` |
| [notifications-adapter.service.ts](apps/server/src/modules/key-cortex/adapters/notifications-adapter.service.ts) | 175 | 9 notification actions. | `NotificationsService` |
| [settings-adapter.service.ts](apps/server/src/modules/key-cortex/adapters/settings-adapter.service.ts) | 173 | Identity/settings reads. | `IdentityService` |
| [communications-adapter.service.ts](apps/server/src/modules/key-cortex/adapters/communications-adapter.service.ts) | 167 | 13 messaging actions. No spec. | `CommunicationsModule` (forwardRef) |
| [content-adapter.service.ts](apps/server/src/modules/key-cortex/adapters/content-adapter.service.ts) | 155 | 6 content actions. | `ContentService` |
| [intelligence-adapter.service.ts](apps/server/src/modules/key-cortex/adapters/intelligence-adapter.service.ts) | 148 | BI queries. | `BusinessIntelligenceService` (forwardRef) |
| [bridge-adapter.service.ts](apps/server/src/modules/key-cortex/adapters/bridge-adapter.service.ts) | 98 | Maps `module: 'genome'` onto the genome bridge. No spec. | `KeyCortexGenomeBridgeService` |
| [activity-adapter.service.ts](apps/server/src/modules/key-cortex/adapters/activity-adapter.service.ts) | 71 | Activity-log reads. No spec. | `ActivityLogService` |
| [index.ts](apps/server/src/modules/key-cortex/adapters/index.ts) | 18 | Barrel. | — |

### organs/ — peripheral nervous system

| File | Lines | What it does | Talks to |
|---|---|---|---|
| [key-organ-adapter.interface.ts](apps/server/src/modules/key-cortex/organs/key-organ-adapter.interface.ts) | 93 | `KeyOrganAdapter` base class + `IKeyOrganAdapter` contract (`organId`, `listTools()`). | All 5 organs |
| [key-cortex-organ-registrar.service.ts](apps/server/src/modules/key-cortex/key-cortex-organ-registrar.service.ts) | 75 | `onModuleInit` harvests `listTools()` from all 5 organs plus the 2 safe-database wrappers and registers them in the canonical registry. `listAdapters()` is also the organ list used by interoception. | `KeyCortexToolRegistryService`, all 5 organ adapters, `KeyCortexSafeDatabaseService` |
| [storelink-adapter.service.ts](apps/server/src/modules/key-cortex/organs/storelink-adapter.service.ts) | 241 | Storefront/portal/presence organ. `@OnEvent` on `storefront.order_created`, `lead_form.submitted`. | Tool registry, `PortalModule`, `SiteModule` |
| [temporal-flow-adapter.service.ts](apps/server/src/modules/key-cortex/organs/temporal-flow-adapter.service.ts) | 236 | TemporalFlow organ; 3 `@OnEvent` handlers + `onModuleInit`. | `TemporalFlowModule` |
| [key-inbox-adapter.service.ts](apps/server/src/modules/key-cortex/organs/key-inbox-adapter.service.ts) | 220 | KeyInbox organ; 3 `@OnEvent` handlers. `replySender` injected but unused. | `KeyInboxModule` |
| [key-genome-adapter.service.ts](apps/server/src/modules/key-cortex/organs/key-genome-adapter.service.ts) | 211 | Genome organ tools. | `KeyGenomeModule` |
| [key-connector-adapter.service.ts](apps/server/src/modules/key-cortex/organs/key-connector-adapter.service.ts) | 161 | Third-party connector organ. | `KeyConnectorModule` |

### watchers/ — rule-based proactive scanners

| File | Lines | What it does | Talks to |
|---|---|---|---|
| [sentiment-watcher.service.ts](apps/server/src/modules/key-cortex/watchers/sentiment-watcher.service.ts) | 368 | `scan`/`scanAll` + `detectSentiment` over inbox messages and tickets. | Prisma, `ModelGatewayService`; called by proactive engine |
| [booking-no-show-watcher.service.ts](apps/server/src/modules/key-cortex/watchers/booking-no-show-watcher.service.ts) | 138 | Flags no-show bookings. | Model `Booking`; called by proactive engine (EOD + 15-min) |
| [invoice-overdue-watcher.service.ts](apps/server/src/modules/key-cortex/watchers/invoice-overdue-watcher.service.ts) | 136 | Flags overdue invoices. | Model `Invoice`; called by proactive engine (morning + 15-min) |
| [index.ts](apps/server/src/modules/key-cortex/watchers/index.ts) | 3 | Barrel. | — |

## Data model

Aggregated by scanning `prisma.client.<model>` across all 143 non-spec files.

**Exclusively owned by this slice** (no `prisma.client.<model>` reference anywhere else in `apps/server` or `packages`): `CortexSession`, `CortexActionLog`, `CognitionSession`, `CognitionMemory`, `CognitiveEvent`, `KeyCortexTriggerRule`, `ValueConstraint`, `KnowledgeSource`, `IdempotencyKey`, `SagaExecution`, `SagaStep`, `AiGoal`.

Note two of these are owned only in the sense that nothing else touches them *and nothing in this slice writes them at runtime either*: `CognitionSession` is written solely by the dormant `CognitionSessionService`, and `KnowledgeSource` solely by the dormant `KnowledgeIngestionService`.

**Shared, written here:** `KeyCortexMemory` (21 refs — also read by `finance/statement-source.service.ts`), `BusinessEvent` (13), `AutonomyVerdict` (6 — co-owned with `key-autonomy/autonomy-orchestrator.service.ts`), `ToolOutcomeScore` (3, same co-owner), `AiPlan`/`AiPlanStep` (8/6 — heavily shared with the `ai` module), `AiMemory` (5), `AiExecutionLog` (4), `BusinessGenome` (6), `TemporalFlowMemory` (3), `GenomeEvolutionProposal`, `GenomeRecommendation`, `GenomeMemoryEvent`, `ApprovalRequest`, `ConsentRecord`, `DelegationLoop`, `FlowSession`.

**Read-mostly domain models** reached through adapters and context assembly: `Invoice` (17), `Automation` (14), `Contact` (13), `Booking` (12), `Business` (11), `Task` (9), `SupportTicket` (9), `AutopilotTask` (9), `Message` (8), `KeyInboxThread` (8), `KeyInboxMessage` (7), `CalendarEvent` (6), `Payment` (4), plus single-digit reads across `Deal`, `Lead`, `Product`, `Project`, `Subscription`, `SocialPost`, `SocialConnection`, `EmailCampaign`, `Expense*`, `CrmTask`, `CrmActivity`, `Membership`, `User`, `StaffMember`, `JobRole`, `MediaAsset`, `VisualIntake`, `ExtractedEntity`, `IntegrationConnection`, `Availability`, `Workflow`, `Conversation`, `TeamActivityLog`.

## External services

| Service | Used by | Env vars |
|---|---|---|
| OpenAI (direct SDK) | [key-cortex-voice.service.ts](apps/server/src/modules/key-cortex/key-cortex-voice.service.ts) (TTS/Whisper), [key-cortex-document.service.ts](apps/server/src/modules/key-cortex/key-cortex-document.service.ts) | `OPENAI_API_KEY` |
| Twilio | [key-cortex-phone.service.ts](apps/server/src/modules/key-cortex/key-cortex-phone.service.ts) — outbound calls + webhooks | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`, `TWILIO_WEBHOOK_BASE_URL` |
| All other LLM traffic | routed through `ModelGatewayService` / `AiUsageService` in the `ai` module, not configured here | — |
| Redis | session cache, genome-context TTL, BI mental model | via `RedisModule` |
| `python3` binary | [key-cortex-sandbox.service.ts](apps/server/src/modules/key-cortex/key-cortex-sandbox.service.ts) `spawn('python3', ['-c', …])` | none — assumes the binary is on `PATH` in the container |

Cortex-specific tuning: `KEY_CORTEX_MAX_CONTEXT_TOKENS` (default 8000), `KEY_CORTEX_SESSION_TTL_HOURS`, `KEY_CORTEX_GENOME_CONTEXT_TTL_SECONDS` (default 60), `KEY_CORTEX_MAX_SESSION_AGE_DAYS`, plus `APP_URL` and `NODE_ENV`.

## Wiring reality

**The module graph itself is sound.** `KeyCortexModule` is imported at `app.module.ts:117/261`. Its 125 providers and 109 exports are consistent — `comm -13` of the two lists is empty, so nothing is exported without being provided and the module cannot fail to boot on that. All 126 `@Injectable`/`@Controller`/`@WebSocketGateway` classes in the slice are registered. `ScheduleModule.forRoot()` (`app.module.ts:132`) and a global `EventEmitterModule.forRoot({wildcard:true})` (`core/event-bus/event-bus.module.ts:7`) are both present, so the 16 crons and 19 `@OnEvent` handlers really do fire.

A transitive walk from the genuine runtime roots reaches **124 of 126 classes**. The 2 it does not reach are exactly the two the codebase already marks `@keyflow:dormant`. That is a good result, and it is also misleading — the walk is at file-reference granularity. What follows is what fails at finer granularity.

### Cross-tenant leak on a live compliance screen

[key-cortex-audit.controller.ts:18](apps/server/src/modules/key-cortex/key-cortex-audit.controller.ts) declares `@Controller('/api/v1/cortex')` — **no `:businessId` segment**. Four handlers nonetheless read one:

```ts
@Get('audit/decisions')
async auditDecisions(@Param('businessId') businessId: string, ...) {
  this.prisma.client.autonomyVerdict.findMany({ where: { businessId }, take: 50 })
```

`@Param('businessId')` on a route with no such parameter resolves to `undefined`, and Prisma treats `where: { businessId: undefined }` as *filter absent*. So `GET /api/v1/cortex/audit/decisions` returns the 50 most recent `AutonomyVerdict` rows and the `total`/`blocked` counts **across every tenant in the database**.

It is reached. `BusinessGuard` (`core/auth/business.guard.ts:21`) accepts `req.query.businessId`, and [apps/web/src/app/app/intelligence/compliance/page.tsx:63](apps/web/src/app/app/intelligence/compliance/page.tsx) calls exactly that:

```ts
apiGet(`/api/v1/cortex/audit/decisions?businessId=${businessId}`)
```

The guard passes on the query param; the handler ignores it. The page then renders those rows as this business's compliance audit trail. The same defect affects `audit/values`, `audit/assessment` and `audit/acceptance` (lines 89, 96, 103), which pass `undefined` into `getValueConstraints`, `generate` and `evaluate`. The docblock at lines 36-54 asserts "this controller is mounted under a per-business prefix" — it is not; every other business-scoped controller in the repo does it properly (e.g. `analytics.controller.ts:18` = `api/businesses/:businessId/analytics`).

### Two flow routes are shadowed and can never execute

In [key-cortex.controller.ts](apps/server/src/modules/key-cortex/key-cortex.controller.ts), `@Get('flows/:id')` is declared at line 2422, while `@Get('flows/templates')` is at 2543 and `@Get('flows/nodes')` at 2596. Express matches in registration order, so `GET /api/v1/cortex/flows/templates` is handled by `flowGet('templates')` and `GET /api/v1/cortex/flows/nodes` by `flowGet('nodes')` — both then demand a `businessId` query param and look up a flow by that literal id. `flowTemplates()` and `flowNodes()` are unreachable. Latent today (no caller), but the handlers are dead as written.

### The web calls a route that does not exist, and renders mock data when it 404s

[apps/web/src/components/key/KeyActivityFeed.tsx:163](apps/web/src/components/key/KeyActivityFeed.tsx) polls `${API_BASE}/api/v1/cortex/activity` every 15 s, and line 206 POSTs to `/api/v1/cortex/activity/${item.id}/action`. `git grep` finds no `activity` route on any cortex controller and no controller anywhere serving that path. The catch block is:

```ts
} catch (err) {
  setError((err as Error).message);
  setActivities(getMockActivities());   // fabricated feed
}
```

so a 404 renders invented activity items. Mitigating: the component is exported from `components/key/index.ts:6` but never imported by any page — it is dead UI calling a dead route. The approve/reject handler swallows its error entirely and silently reverts.

### The entire v5 WebSocket layer has no client

[key-cortex.gateway.ts](apps/server/src/modules/key-cortex/key-cortex.gateway.ts) (526 lines, 4 message handlers), [key-cortex-realtime.service.ts](apps/server/src/modules/key-cortex/key-cortex-realtime.service.ts) (293 lines, 10 `@OnEvent` forwarders) and [key-cortex-ws-auth.service.ts](apps/server/src/modules/key-cortex/key-cortex-ws-auth.service.ts) (136 lines) implement a namespace nothing connects to. `socket.io-client` appears in **no** `package.json` in the repo, and `apps/web` contains no socket construction. The server-side auth is genuinely careful (token-derived identity, membership verification before room join) — it just protects a door with no visitors. Every `key.*` event `KeyCortexRealtimeService` forwards is emitted into a room with zero members.

### Injected-but-never-called dependencies

A scan of every constructor for `private`/`readonly` params never referenced as `this.<name>` in the class body finds **41** across 19 files. The concentration in [key-cortex-reasoning.service.ts](apps/server/src/modules/key-cortex/key-cortex-reasoning.service.ts) is structural: 18 of its injected services — `personalityService`, `actionsService`, `sessionService`, `promptContextService`, `toolLoopService`, `structuredOutputService`, `suggestionService`, `genomeContextService`, `systemPromptService`, `interactionService`, `commandExecutionService`, `adaptiveRouter`, `aiMemoryService`, `semanticMemoryService`, `insightService`, `proactive`, `trustExplanation`, `learningService` — are leftovers from before the Phase 0.7b decomposition moved the work to the query pipeline. They are harmless but they make the class read as the brain when it is a forwarder. Notable individual cases: `KeyCortexActionsService.toolRegistry` (`:89`), `KeyCortexSandboxService.modelGateway` (`:110`), `KeyCortexConsciousnessService.{modelGateway,personality,prisma}` (`:187-190`), `KeyCortexGenomeBridgeService.outcomeLearningService` (`:130`), `KeyCortexGoalsController.prisma` (`:175`).

`TrustExplanationService` deserves a note because the module's own comment (`key-cortex.module.ts:505-515`) documents it as the archetype of this failure — written, `@Optional()`-injected, never registered, so the guard `if (this.trustExplanation && …)` was false forever. **That one is fixed**: it is now in `providers` and `exports`, so the guard at [key-cortex-query-pipeline.service.ts:988](apps/server/src/modules/key-cortex/key-cortex-query-pipeline.service.ts) does fire. But the identical injection in `key-cortex-reasoning.service.ts:167` is still never used — the service resolves and is then ignored on that path.

### The KeyStore integration is three declarations and nothing else

`key-cortex.module.ts:274` imports `forwardRef(() => KeystoreModule)` under a comment claiming KEY Cortex can "manage service orders, browse listings, and track deliverable requests". In fact: `keystore` is a `ModuleName` union member (`key-cortex-connector.types.ts:33`), `KeystoreCreateOrderParams` is a declared interface (`:366`), and `KeyCortexConnectorService`'s adapter map ends with `keystore: undefined`. No Keystore service is injected anywhere in the slice, and the capability registry advertises no keystore capabilities. Any `ConnectorCommand` with `module: 'keystore'` returns `Unknown module: keystore`.

### The JS sandbox is not a security boundary

`POST /api/v1/cortex/sandbox/execute` (auth + business membership only) reaches [key-cortex-sandbox.service.ts:807](apps/server/src/modules/key-cortex/key-cortex-sandbox.service.ts), which runs caller-supplied JavaScript with `vm.runInNewContext(wrappedCode, sandbox, …)`. Node documents `vm` as explicitly *not* a security mechanism, and the sandbox object here passes host-realm intrinsics (`Object`, `Error`, `Math`, `JSON`, `Array`) straight in, so `Object.constructor('return process')()` returns the host `process`. The protection is a 17-entry source-text regex denylist (`:61-80`) which blocks the literal strings `constructor.constructor`, `Function(` followed by a quote, `child_process`, `globalThis`, `eval(` — none of which match bracket notation or string concatenation. The Python path additionally `spawn`s `python3 -c` with a similar literal-import denylist. `key-cortex-code-execution.spec.ts` asserts things about the *source text* of the services (no `$queryRawUnsafe`, no captured `new Function`) and never exercises an escape, so nothing here is covered by a behavioural test. No web caller exists today, which is the only thing limiting exposure.

### Reasoning that computes and discards

[key-cortex-reflection.service.ts](apps/server/src/modules/key-cortex/key-cortex-reflection.service.ts) runs four crons across every active business (30-minute reflection, nightly dream, weekly synthesis, nightly maintenance) and [key-cortex-intuition.service.ts](apps/server/src/modules/key-cortex/key-cortex-intuition.service.ts) two more. Both keep results in process-local `Map`s and mark DB persistence as absent: `reflection:572`, `:627`, `:1194`, `:1480` and `intuition:481`, `:2264` all read `// persistence not implemented (model absent from schema)`, and `reflection:956` notes insight persistence is unimplemented too. So ~4,000 lines of scheduled LLM-backed reasoning produce hypotheses and weak signals that vanish on restart and are invisible to any other replica. `getDreamJournal()` merges an always-empty `persistedHypotheses` array into its result, which makes the read path look like it queries a store it does not have.

Also unimplemented on a live path: [key-cortex-compensation.service.ts:275,287](apps/server/src/modules/key-cortex/key-cortex-compensation.service.ts) — two autopilot rollback handlers are TODO no-ops, so a saga rolling back an autopilot task reports success without undoing it.

### No leader election

All 16 crons are registered unconditionally, with no `DISABLE_SCHEDULERS` guard in this slice and no leader election anywhere in the server. On more than one replica every job double-fires: the 15-minute proactive scan, the hourly briefs, the nightly dream and synthesis passes, and the BI refresh all run once per instance.

### The blunt summary

Measured by browser reachability rather than by module registration: of **92 HTTP route handlers, only 11 distinct paths are called by `apps/web`** (`execute`, `context`, `recommendations`, `awareness`, `autonomy-profile`, `conscious/stream`, `audit/decisions`, `goals`, `goals/:id`, `goals/:id/plans`, `plans/:id/execute`), plus 2 calls to a route that does not exist. The cron and event layer is genuinely live and is what makes most of the module run at all. Everything behind `sandbox/*`, `flows/*`, `phone/*`, `documents/*`, `evolution/*`, `monitors/*`, `insights/*`, `voice/*`, `personalities/*`, `sessions/*`, `chat`, `chat/stream`, `stream`, `query`, `capabilities`, `batch` and `rollback` — around 60 routes over roughly 12,000 lines of service code — is reachable by an authenticated HTTP client but has no caller in this repo.

## Tests

**106 spec files, 20,008 lines**, against 143 non-spec files and 70,434 lines.

The strongest coverage is on the newer "nervous system" and governance work, and it is behaviour-focused rather than shape-focused: `key-cortex-salience.spec.ts` (616 lines), `key-cortex-immune.service.spec.ts` (423), `cognitive-triage.service.spec.ts` (403), `key-cortex-endocrine-durability.spec.ts` (390), `key-cortex-tool-registry.service.spec.ts` (379 + a second 195-line file under `__tests__/`), `key-cortex-epigenetics.service.spec.ts` (334), `key-cortex-incentive.service.spec.ts` (315).

Several specs exist specifically to police the failure mode this document keeps finding — they assert wiring, not logic:

- `stub-detection.guard.spec.ts` — fails the build on `(service as any)` casts and `status:'placeholder'` returns, but only scans the connector, the tool registry and `organs/`; it does not scan `adapters/`.
- `saga-compensation-wiring.spec.ts`, `trust-explanation-wiring.spec.ts`, `key-cortex-expertise-lens.wiring.spec.ts`, `opportunity-signal-reachability.spec.ts`, `standing-context-reachability.spec.ts`, `unified-memory-retrieval-scoping.spec.ts`, `reflection-idle-gate.spec.ts`, `phantom-injection.spec.ts`, `tool-name-collision.spec.ts`.
- `key-cortex-reasoning.e2e.spec.ts` (387 lines) is the only end-to-end spec.

**26 registered classes have no spec that so much as names them, totalling 17,916 lines — 25% of the slice's non-spec code.** Ranked by size: `KeyCortexFlowStudioService` (2650), `KeyCortexCapabilityRegistryService` (2458), `KeyCortexEvolutionService` (2179), `KeyCortexInsightService` (1314), `KeyCortexSandboxService` (1251), `KeyCortexDocumentService` (1244), `KeyCortexPhoneService` (1125), `KeyCortexMetacognitionService` (1109), `KeyCortexMonitorV2Service` (814), `KeyCortexVoiceService` (655), `KeyCortexEventService` (423), `KeyCortexContextService` (367), `KeyCortexEvidenceService` (363), `KeyCortexContextAssemblyService` (315), `KeyCortexRealtimeService` (293), `ProjectsAdapterService` (225), `KeyCortexConnectorService` (204), `CommunicationsAdapterService` (167), `FlowSignalBridgeService` (134), `KnowledgeIngestionService` (119), `KeyCortexAuditController` (108), `ValueLearningService` (100), `KeyCortexBridgeAdapterService` (98), `DigitalEmployeeAcceptanceService` (78), `ActivityAdapterService` (71), `SelfAssessmentService` (52).

Two entries there matter more than their size suggests. `KeyCortexConnectorService` is the most-injected service in the whole slice (24 consumers) and has no unit test — only the source-text stub guard. `KeyCortexAuditController` has none, which is why the `@Param('businessId')` leak above has gone unnoticed.

## Open questions

- **Is the `conscious/*` path meant to replace the main chat pipeline, or coexist?** The web only calls `conscious/stream`; `chat` and `chat/stream` have no caller. Two full reasoning implementations (~11,000 lines vs ~3,500) are being maintained and only one is used.
- **Was `/api/v1/cortex/activity` ever implemented?** `KeyActivityFeed.tsx` was written against a concrete response shape (`{ activities: [...] }` with `id`, `actionTaken`), which suggests the route existed or was specified. Nothing in git-tracked source serves it now.
- **Why do `reflection` and `intuition` reference Prisma models that are "absent from schema"?** Were `ReflectionHypothesis` / `IntuitionSignal` models dropped from the schema, or never added? The code was clearly written against them.
- **Is the sandbox intended to be exposed?** No web caller exists, but the routes are live behind ordinary member auth. If it is a developer tool it should be role-gated; if it is a product feature the `vm` boundary needs replacing (`isolated-vm`, or an out-of-process runner).
- **Which of the two event buses is canonical?** `KeyCortexEventBusService` (in-memory) and `EventEmitter2` (global) are bridged in both directions by `event-emitter-flow-bridge` and `flow-signal-bridge`; it is not obvious from the code which is meant to win, or why the cortex bus needs to be separate given it cannot survive a restart.
- **How are the 16 crons expected to behave on the multi-replica Docker Compose topology?** Nothing in this slice guards against concurrent execution.
- **Is `keystore` planned work or an abandoned direction?** The type-level scaffolding exists with no implementation and no tracking comment.
