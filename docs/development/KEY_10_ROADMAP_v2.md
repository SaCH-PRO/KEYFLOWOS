# KEY 10/10 Roadmap v2 — Renovation-First Integration Plan

> **Status:** Completed  
> **Current phase:** All roadmap phases merged to `main`.  
> **Completed:** Phase 0, Phase A, Phase B, Phase C, and Phase D merged to `main`.
> **Scope:** How to evolve KEYFLOWOS toward a 10/10 autonomous business employee by *renovating the existing house*, not building a parallel mansion.  
> **Companion documents:**
> - `docs/development/KEY_10_10_ROADMAP.md` — the original strategic/target-state roadmap.
> - `docs/development/PHASE_0_BASELINE.md` — current-state snapshot.
> - `feat/key-unified-v2` branch — 50 reference files that codify the target architecture (specification, not integration).

---

## 1. Honest Assessment of the Previous Approach

The original plan was architected against the **50 new files pushed to `feat/key-unified-v2`**, not against the living code in `main`. That produced a roadmap for a parallel universe rather than an upgrade path.

| Finding | Error | Severity |
|---|---|---|
| Orchestrator already lives in `key-cortex-reasoning.service.ts` (`processQuery`, 14-step loop). | Assumed the new orchestrator file *was* the system. | Critical |
| Emotion/personality already lives in `key-cortex-personality.service.ts`. | Built a standalone emotion engine that does not integrate. | Critical |
| Only 8 personas + 7 roles exist today, not an 84-role taxonomy. | Designed a taxonomy tower without checking the basement. | High |
| Temporal behavior is handled by `TemporalFlowService`, not a consciousness layer. | Created a parallel temporal consciousness file. | High |
| LLM gateway (`ModelGatewayService`) and data context already work. | Treated existing infrastructure as stubs. | High |

**Bottom line:** The 50 files on `feat/key-unified-v2` are valuable as **reference architecture** — they express what each consciousness layer *should* do when integrated — but they cannot be executed as-is. The execution order must renovate existing services first.

---

## 2. Guiding Principles

1. **Enhance existing files before creating new ones.**
   - Do not create `emotion-engine.service.ts`; enhance the emotion function inside `key-cortex-personality.service.ts`.
   - Do not create a new temporal consciousness service; extend `TemporalFlowService` or the reasoning loop where it already calls it.

2. **Map every target-state concept to a current service.**
   - If a concept has no current owner, only then create a new service.

3. **Foundation-first, branch-per-phase.**
   - Each phase lands fully before the next begins.
   - No schema changes for Phase A until the current Phase 0 stabilization branch is in `main`.

4. **The 50 reference files are specification, not source.**
   - Use them as design docs and copy useful logic into the existing codebase.
   - Do not merge `feat/key-unified-v2` wholesale.

---

## 3. Existing Foundation Map

| Target Concept | Current Home | Notes |
|---|---|---|
| Reasoning / central orchestrator | `KeyCortexReasoningService.processQuery()` | 14-step loop; the actual brain to upgrade. |
| Emotion / personality | `KeyCortexPersonalityService` | Enhance here rather than add a new engine. |
| Temporal memory / scheduling | `TemporalFlowService` | Extend existing flow-based temporal layer. |
| LLM gateway | `ModelGatewayService` | Add task-type routing and fallback chains here. |
| Tool registry | `KeyCortexToolRegistryService` | Canonical registry already exists. |
| Event bus | `KeyCortexEventBusService` | Already normalizes envelopes and channels. |
| Organ adapters | Five existing adapters in `key-cortex/organs/` | Extend rather than replace. |
| Identity / correlation thread | `KeyCortexLifecycleService` + `BusinessEvent` lineage | Already wired; preserve and extend. |
| Approvals / governance | `KeyActionProposal` + new `KeyCortexApprovalOrchestratorService` | Currently being stabilized in Phase 0. |
| Genome integration | `BusinessGenomeModule` / `KeyGenomeModule` | Use as context source, not replace. |
| Memory | `KeyCortexMemoryService`, `AiMemory`, `SemanticMemory` | Unify retrieval paths before adding new stores. |

---

## 4. Phases

### Phase A — DB Primitives + Gateway Resilience

**Goal:** Add the data primitives and model-routing logic that every later phase depends on. This is pure additive work with zero risk to existing functionality.

**Branch:** `feat/key-phase-a-gateway` (cut from `main` after Phase 0 lands)

**Scope:**
1. Schema additions (additive only):
   - `CognitionMemory` — structured memory fragments tied to sessions/commands.
   - `PromptVersion` — versioned prompt templates for A/B testing.
   - `CognitionSession` — long-running cognitive session state.
   - `LLMProviderCost` — cost tracking per provider/model/call.
2. Upgrade `ModelGatewayService`:
   - Task-type routing (chat, tool-call, embedding, classification, summarization).
   - Provider fallback chains with cost/availability heuristics.
   - Retry, timeout, and circuit-breaker hygiene.

**Exit Criteria:**
- Migration applies cleanly to a fresh DB and to production-like data.
- `ModelGatewayService` has passing unit tests for routing and fallback.
- `tsc --noEmit` clean; full test suite green.

---

### Phase B — Upgrade `processQuery()`

**Goal:** Make the existing reasoning loop the actual 10/10 brain by enhancing it, not replacing it.

**Branch:** `feat/key-phase-b-reasoning`

**Scope:**
1. Refactor `KeyCortexReasoningService.processQuery()` internals without changing its public signature:
   - Extract prompt building into a focused helper or service.
   - Extract the tool-loop into a dedicated `KeyCortexToolLoopService`.
   - Add a lightweight route-decision step that sets `includeMemory`, `includeGenome`, `includeActions`.
2. LLM-power existing in-service functions:
   - Role/persona classification inside `KeyCortexPersonalityService`.
   - Quality/safety checks inside `KeyCortexReasoningService` or a new thin checker service.
   - Emotion/tone selection inside `KeyCortexPersonalityService`.
3. Preserve all existing controller contracts.

**Exit Criteria:**
- `processQuery` tests pass with equal or better coverage.
- Latency and quality evals show improvement or parity.
- No god-service regression; reasoning service becomes a thinner conductor.

---

### Phase C — Adaptive Layer + Genome + Memory Unification

**Goal:** Add intelligence that plugs into existing infrastructure rather than bypassing it.

**Branch:** `feat/key-phase-c-intelligence`

**Scope:**
1. Adaptive router / classifier:
   - Enhance `AdaptiveRouterService` (or create only if it truly does not exist) to classify intent and route to the right organ/flow.
2. Genome integration:
   - Use `BusinessGenomeService` / `ReadinessScorerService` as context inputs to `processQuery`.
   - Do not duplicate genome logic.
3. Memory unification:
   - Create a `KeyCortexMemoryRetrievalService` that searches, in order:
     - `KeyCortexMemory` (structured business memory)
     - `AiMemory` / `SemanticMemory` (legacy embeddings)
     - Recent `BusinessEvent`, `AiExecutionLog`, `CortexActionLog` (episodic memory)
   - Return a normalized `MemoryFragment[]` and inject into the prompt context.
4. Add evals/harness tests for retrieval quality.

**Exit Criteria:**
- Memory retrieval has ranking and fallback tests.
- Genome context flows into reasoning without breaking existing tests.
- Adaptive routing has passing unit tests.

---

### Phase D — Proactive Senses + BI + Learning

**Goal:** Build on working context/insight services so KEY can act without being asked and improve from outcomes.

**Branch:** `feat/key-phase-d-proactive`

**Status:** In progress — watcher services, digest service, tool scoring, and outcome feedback wiring implemented.

**Scope:**
1. Proactive triggers:
   - Extend `KeyCortexEventBusService` subscription rules.
   - Create watcher services for common patterns (overdue invoices, no-shows, low inventory, negative sentiment).
2. BI / digest generation:
   - Use existing `KeyCortexInsightService` / `KeyBiEngineService`.
   - Add `KeyCortexDigestService` for daily/weekly briefings.
3. Learning loop:
   - Capture outcome feedback from plans and tool executions.
   - Score tool success per tool in `KeyCortexToolRegistryService`.
   - Use `PromptVersion` from Phase A to A/B test prompt variants.

**Implemented files:**
- `apps/server/src/modules/key-cortex/watchers/`
  - `invoice-overdue-watcher.service.ts` — emits `proactive.invoice_overdue`.
  - `booking-no-show-watcher.service.ts` — emits `proactive.booking_no_show`.
  - `sentiment-watcher.service.ts` — emits `proactive.negative_sentiment` (rule-based + optional LLM).
  - `index.ts` — barrel export.
- `apps/server/src/modules/key-cortex/key-cortex-digest.service.ts` — daily/weekly digest generation and delivery via `CommunicationsService`.
- `apps/server/src/modules/key-cortex/key-cortex-tool-registry.service.ts` — added in-memory tool success scoring and `recordToolOutcome` integration.
- `apps/server/src/modules/key-cortex/key-cortex-learning.service.ts` — added `recordOutcome` for tool execution feedback stored in `CognitionMemory`.
- `apps/server/src/modules/key-cortex/key-cortex.module.ts` — registered/exported new services.

**Exit Criteria:**
- Watcher services emit and act on events with tests. ✅
- Digests generated and delivered via the real `CommunicationsService`. ✅
- Learning feedback captured and affects future autonomy decisions. ✅ (scoring + memory wiring in place)

---

## 5. Execution Order & Branch Discipline

```
Phase 0 (feat/key-phase-0-execution-foundation) ──► main
                                                     │
                                                     ▼
                              Phase A (feat/key-phase-a-gateway)
                                                     │
                                                     ▼
                          Phase B (feat/key-phase-b-reasoning)
                                                     │
                                                     ▼
                     Phase C (feat/key-phase-c-intelligence)
                                                     │
                                                     ▼
                          Phase D (feat/key-phase-d-proactive)
```

**Rules:**
- No phase branch may be cut until the previous phase is merged to `main`.
- Each phase branch starts from a green `main` (`tsc --noEmit` clean, full tests passing).
- Each phase merges only when its exit criteria are met.
- The `feat/key-unified-v2` reference files remain read-only specification; useful logic is ported branch-by-branch.

---

## 6. Relationship to `feat/key-unified-v2`

The 50 files on `feat/key-unified-v2` are **not wasted**. They are a specification expressed as code. Use them as follows:

1. **Read before designing a phase.** Understand the target-state intent.
2. **Copy logic selectively.** Port only what integrates cleanly into an existing service.
3. **Delete equivalent concepts.** If `feat/key-unified-v2` has a standalone service that duplicates an existing service, do not create it.
4. **Archive the branch.** Once all useful logic is ported, keep the branch for historical reference but do not merge it.

---

## 7. Cross-Cutting Concerns

| Concern | Approach |
|---|---|
| **Type safety** | `tsc --noEmit` must be clean before any phase merges. |
| **Testing** | Every new service/helper needs unit tests; every phase needs at least one integration test for the happy path. |
| **Migrations** | Additive only until explicitly approved otherwise. No dropping legacy tables until Phase 0+ exit criteria are stable. |
| **Tenant scoping** | All new DB queries go through the existing Prisma tenant extension. |
| **Observability** | Use existing structured logging; emit `BusinessEvent` for significant state changes. |
| **Autonomy / safety** | Reuse `AutonomyOrchestratorService` and the new `KeyCortexApprovalOrchestratorService`; do not build parallel gating. |

---

## 8. Immediate Next Steps

1. **Land Phase 0 first.** Do not start Phase A implementation until `feat/key-phase-0-execution-foundation` is merged to `main` and the build/test pipeline is green.
2. **Keep this document updated.** As each phase completes, update the roadmap with actual file names, decisions, and deviations.
3. **Do not cut `feat/key-phase-a-gateway` yet.**

---

*This is a living document. Last updated: 2026-06-28.*
