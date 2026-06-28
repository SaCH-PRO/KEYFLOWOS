# KEY: PATH TO 10/10 — v2
## Reality-Based Upgrade Roadmap for the Living Codebase

**Status:** Phase A through E complete — 279 tests passing. KEY 10/10 upgrade delivered.  
**Current branch target:** `main` (the working codebase).  
**Reference architecture:** `feat/key-unified-v2` (50 files — useful as spec, not executable as-is).

---

## Honest Diagnosis

The original roadmap was designed against reference files that do not drive the live system. The actual codebase already contains:

- A real **LLM gateway** (`ModelGatewayService`) with multi-provider support, fallback, and budget logic.
- Real **data connectivity** (`KeyCortexContextService`, `KeyCortexContextV2Service`, `KeyCortexInsightService`).
- A working **orchestrator** (`KeyCortexReasoningService.processQuery()`) with a 14-step pipeline.
- Persistent memory tables (`AiMemory`, `AiMemoryEmbedding`, `CortexSession`, `KeyEvolutionLog`, `GenomeRecommendationOutcome`).
- A real **tool/action registry** (`KeyToolRegistryService`, `KeyCortexActionsService`).

The stubs that actually block perceived intelligence are:
- `KeyCortexGenomeBridgeService` — autonomy always denied, recommendations empty.
- `KeyCortexActionsService.requestApproval()` — always returns `false`.
- `KeyProactiveEngineService` — only scans `demo-business`.
- Role/personality detection — keyword-based.
- No adaptive routing — full pipeline runs for every query.

**Therefore, this roadmap upgrades the existing house rather than building a new mansion.**

---

## Phase A: Foundation ✅
**Duration:** 1–2 days  
**Impact:** Unblocks everything  
**Risk:** Near-zero (additive schema + service upgrades)  
**Status:** Completed — schema synced, gateway upgraded, 57 model-gateway tests passing.

### A.1 Database Schema Additions
Files: `packages/db/prisma/schema.prisma`

- **Add `PromptVersion`** — versioned system prompts, templates, A/B testing, win rates.
- **Add `CognitionMemory`** — per-query learning: query, recommendation, user response, actual outcome, lessons learned, confidence delta.
- **Extend `CortexSession`** — add `detectedRole`, `detectedFunction`, `layersUsed`, `llmCallsMade`, `responseTimeMs`, `userFeedback`.
- **Skip `LLMProviderCost`** — `AiUsageLog` already tracks provider, model, tokens, cost, latency, and fallback.

### A.2 Model Gateway Upgrade
File: `apps/server/src/modules/ai/model-gateway.service.ts`

The gateway already works. Upgrade it with:
- Task-type routing (`reasoning`, `emotion_analysis`, `creative`, `classification`, `summarization`, `code`, `forecasting`).
- Explicit fallback chains per task type.
- Circuit breaker (3 failures → 5 min unhealthy).
- Response-time logging (already partially in `AiUsageLog`; enrich `taskCategory`).
- Streaming support (already present; harden fallback path).

### A.3 Prompt Registry
File: `apps/server/src/modules/ai/prompt-registry.service.ts` (new)

Centralize prompt templates with versioning and A/B testing. Backed by `PromptVersion`.

---

## Phase B: Neural Tissue — LLM-First Orchestrator ✅
**Duration:** 1 week  
**Impact:** Largest single jump in perceived intelligence  
**Status:** Completed — `KeyCortexReasoningService.processQuery()` and `streamQuery()` now use LLM-first structured reasoning via `ModelGatewayService`. 11 reasoning-service helper tests + 122 combined key-cortex/ai tests passing.

### B.1 Rewrite `KeyCortexReasoningService.processQuery()`
File: `apps/server/src/modules/key-cortex/key-cortex-reasoning.service.ts`

- Replace the 14-step concatenation with an LLM-first reasoning call.
- Use `PromptRegistry` to load the orchestrator system prompt.
- Feed enriched context: genome snapshot, role, emotion state, conversation history, relevant frameworks.
- Parse structured response: Role Mode, Analysis, Hidden Signals, Recommendation, Risk Check, Success Metrics, Next Step, Confidence.
- Run ethics and quality validation against the parsed output; regenerate with constraints if needed.
- Log the session to extended `CortexSession`.

### B.2 LLM-Power Existing Services (in place)
- **Emotion detection** inside `key-cortex-personality.service.ts` — send message + history to LLM.
- **Role classification** inside `ai/role-engine.service.ts` — use LLM for role/function selection.
- **Quality checks** inside `key-mind/key-business-standard.service.ts` (or equivalent) — evaluate 8 criteria via LLM.

Do **not** create new standalone `emotion-engine.service.ts` files.

### B.3 Enhance Context Assembly
File: `apps/server/src/modules/key-cortex/key-cortex-context-v2.service.ts`

Ensure the context fed to the orchestrator includes real metrics (revenue, customers, pipeline, cash, churn) formatted for the LLM.

---

## Phase C: Adaptive Intelligence ✅
**Duration:** 5–7 days
**Status:** Completed — adaptive router, contextual memory, genome bridge, and approval gate wired and tested.

### C.1 Adaptive Router
File: `apps/server/src/modules/key-cortex/adaptive-router.service.ts` (new)

Classify each query by complexity, domain, urgency, emotional weight, time horizon, and data requirement. Then decide:
- Simple factual → emotion + analytical reasoning + ethics only.
- Strategy → full reasoning + creativity + temporal + ethics.
- Crisis → deep emotion + intuition + ethics + strategic reasoning.
- Creative → emotion + creative reasoning + creativity layer + ethics.
- Data query → analytical + temporal.

### C.2 Contextual Memory
Use `CortexSession.messages` and `AiMemory`/`AiMemoryEmbedding` to maintain a running summary of long conversations. After each turn, ask an LLM to update the running summary.

### C.3 Un-Stub the Genome Bridge
File: `apps/server/src/modules/key-cortex/key-cortex-genome-bridge.service.ts`

- `checkAutonomy()` — real policy check (subscription tier, risk tier, user preference, past acceptance rate).
- `getRankedRecommendations()` — query real genome signals/recommendations.
- `recordOutcome()` — write to `GenomeRecommendationOutcome` and `CognitionMemory`.

### C.4 Un-Stub the Approval Gate
File: `apps/server/src/modules/key-cortex/key-cortex-actions.service.ts`

Replace `requestApproval()` stub with real approval routing using `AiApprovalRequest`.

---

## Phase D: Data & Persistent Learning
**Duration:** 5–7 days

### D.1 Proactive Engine Fix ✅
File: `apps/server/src/modules/key-cortex/key-proactive-engine.service.ts`

- `getActiveBusinesses()` now queries real businesses with `autopilotEnabled=true` and an active subscription or recent Cortex/AI activity (last 7 days), capped at 500.
- Anomaly scans create real `GenomeSignal` rows via `GenomeSignalService` for invoice overdue, missed tasks, revenue anomalies, genome weakness, and dormant leads.
- Added `key-proactive-engine.service.spec.ts` with 7 tests.

### D.2 Real-Time Business Mental Model ✅
File: `apps/server/src/modules/key-cortex/key-bi-engine.service.ts` (new)

- Created `KeyBiEngineService` with `BusinessMentalModel` contract (health score/status, top risks, top opportunities, key trends, attention items, metrics).
- Scheduled `refreshAll()` every 15 minutes; scans active businesses (same criteria as proactive engine) capped at 500.
- Direct Prisma queries for invoices, tasks, leads, deals, revenue, and genome integrity; no LLM required, so refresh is fast and cheap.
- Caches results in Redis (`key-bi-engine:mental-model:{businessId}`) with 15-min TTL.
- Persists snapshots to `BusinessHealthSnapshot` (`area='MENTAL_MODEL'`) for historical tracking.
- Wired into `KeyCortexModule` providers and exports.
- Added `key-bi-engine.service.spec.ts` with 7 tests.

### D.3 Persistent Learning Loop ✅
File: `apps/server/src/modules/key-cortex/key-cortex-learning.service.ts` (new)

- `recordObservation()` creates a `CognitionMemory` row during every `processQuery()` with `userResponse='no_action'`.
- `recordFeedback()` accepts explicit user feedback (`accepted`/`rejected`/`modified`/`no_action`) via `POST /api/v1/cortex/feedback`.
- LLM-based lesson extraction with rule-based fallback; updates `lessonsLearned` and `confidenceDelta` on the cognition memory.
- Persists outcomes to `GenomeRecommendationOutcome` and `KeyEvolutionLog`.
- `retrieveLessons()` fetches relevant past lessons by role/function and injects them into the LLM prompt context.
- Added `key-cortex-learning.service.spec.ts` with 7 tests.

### D.4 Metacognition & Confidence Calibration ✅
File: `apps/server/src/modules/key-cortex/key-cortex-learning.service.ts`

- `getAcceptanceRate()` aggregates `accepted`/`rejected`/`modified` per business/role/function.
- `calibrateConfidence()` blends stated confidence with historical acceptance rate and flags over/under-confidence.
- `KeyCortexReasoningService` now calibrates final response confidence and returns an optional `knowledgeGap` field in `CortexResponse` when historical data suggests caution.
- Extended `CortexSession` type with cognition metadata fields (`detectedRole`, `detectedFunction`, `layersUsed`, `llmCallsMade`, `responseTimeMs`, `userFeedback`).

---

## Phase E: Polish & Testing ✅
**Duration:** 2–3 days

- Added `key-cortex-reasoning.e2e.spec.ts` with end-to-end `processQuery()` and `streamQuery()` tests, plus edge cases:
  - LLM failure returns a clean exception.
  - Missing/empty business data still produces a response.
  - Malicious input (`<script>`, prompt-injection wording) is handled without crashing.
  - Learning-service integration records observations and surfaces knowledge gaps.
- Added `key-cortex-quality.eval.spec.ts` as an evaluation harness with 5 representative queries across simple/moderate/complex complexity, validating response structure, confidence range, and latency targets.
- Normalized `confidence` metadata to 0–1 scale in `KeyCortexReasoningService`.
- Final validation: `279 passed` across `20` test files; `tsc --noEmit` clean.

---

## Execution Order Recommendation

If limited to one week:

1. **Day 1:** Phase A — schema + ModelGateway upgrade.
2. **Days 2–3:** Phase B — LLM-first orchestrator.
3. **Day 4:** Phase C — adaptive router + un-stub genome bridge.
4. **Day 5:** Phase C — contextual memory + approval gate.

This delivers the biggest perceived intelligence jump with the least risk.

---

## Cost Estimate

- Development API calls: ~$50–100.
- Production: ~$0.02 per mixed query; 10k queries/month ≈ $200.

---

## Success Metrics

| Metric | Current | Target |
|---|---|---|
| Simple response time | ~3s | <1s |
| Complex response time | ~3s | <4s |
| User acceptance rate | unmeasured | >85% |
| Confidence calibration | none | stated ≈ actual ±5% |
| Multi-turn coherence | isolated queries | full conversation memory |
| Dream/proactive insights | 0 or demo-only | 3+ actionable/night |
| Signal detection | keyword-only | >80% real anomalies |

---

## One-Sentence Guidance

> **Upgrade the existing orchestrator with LLM-first reasoning, adaptive routing, and real data — do not build parallel consciousness files that nobody calls.**
