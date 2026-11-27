# KEY Memory Evaluation Plan & Recorded Baselines

- **Packet:** `MEM-EVAL-SUITE` (P150, V1-92, Journey K)
- **Decisions:** `D-100`, `D-130`, `D-226`, `D-227`, `D-234`, `D-238`, `D-254`, `D-257`
- **Upstream Census:** `MEM-CENSUS` (`apps/server/src/modules/key-cortex/memory-path-registry.ts`)
- **Unified Reader Projection:** `MEM-CLASS-READ` (P137, merged on `main` at base `a9bd4b30`)
- **Last Recorded Baseline Date:** `2026-11-27`

---

## 1. Purpose & Non-Negotiable Rules

1. **Zero silent blind spots:** Every registered memory access path in `apps/server/src/modules/key-cortex/memory-path-registry.ts` (`MEMORY_STORE_PATHS` + `DORMANT_MEMORY_PATHS`) is accounted for by either an active real-Postgres leak assertion or an explicit named `it.todo` citing its owning follow-up packet id.
2. **Zero real provider traffic in CI:** CI runs deterministic stubbed model outputs (`deterministic-ci-stub`) through the real context projection and scorer. Live-model runs may be executed externally and appended below as non-gating reference rows; they never gate CI alone.
3. **Fail-closed eval harness (`RR-EVAL-HARNESS-NO-VACUOUS`):** `EvalHarnessService` registers `memory-task-suite` (`v1.0.0`) with an optional `MemoryTaskEvalRunner`. When unwired, every assertion reports `NOT_RUN` (`fail-closed: MemoryTaskEvalRunner not wired`), never green.
4. **Negative controls mandatory:** Leaky or hallucinating stubs (`E-TEN`, `E-REV-DIRECT`, `E-REV-INDIRECT`, `E-CONF`, or vacuous all-abstain stubs) MUST fail both `scoreMemoryTaskSuite()` and `EvalHarnessService.runSuite('memory-task-suite')`.

---

## 2. Fixture Topology

### 2.1 Real-Postgres Leak Suite (`v92a_`)
- **Suite file:** `apps/server/test/memory-eval-leak.integration.test.ts`
- **Prefix:** `v92a_` (registered in `apps/server/test/helpers/fixture-prefixes.json`; cleaned via raw SQL `LIKE ${sqlLikePrefix(P)}` only)
- **Two Fixture Tenants:**
  - `v92a_bizA` (`V92A Tenant A Studio`)
  - `v92a_bizB` (`V92A Tenant B Marine`)
- **Three Reader Profiles (+ Peer Staff for D-130):**
  1. **Owner A** (`v92a_owner_a`, `OWNER` of `v92a_bizA`, full scopes)
  2. **Staff A** (`v92a_staff_a`, `STAFF` of `v92a_bizA`, `crm:read`, `bookings:read`, `revenue:none`, `expenses:none`, `ai:none`)
  3. **Foreign Owner B / Memberless Caller** (`v92a_owner_b`, `OWNER` of `v92a_bizB` with zero membership in `v92a_bizA`, plus `reader: null` background/memberless context)
  4. **Peer Staff A2** (`v92a_staff_a2`, `STAFF` of `v92a_bizA`) for intra-tenant peer cognition isolation (`E-MEMBER`)

### 2.2 Versioned Memory Task Suite (`memory-task-suite` v1.0.0)
- **Module:** `apps/server/src/modules/key-cortex/memory-eval-suite.ts`
- **Unit Proof:** `apps/server/src/modules/key-cortex/memory-eval-suite.spec.ts`
- **Two Synthetic Fixture Tenants:**
  - `tenant-a`: *Solstice Wellness & Salon Studio* (16 fixture records across `ai_memory`, `temporal_flow`, `cognition_memory`, covering `GENERAL`, direct & zero-keyword indirect `REVENUE`, `PERSONAL`, `SECRET_BEARING`, and superseded temporal updates)
  - `tenant-b`: *Harborline Marine Supply Co.* (11 fixture records across `ai_memory` and `temporal_flow`, covering `GENERAL`, direct & zero-keyword indirect `REVENUE`, `SECRET_BEARING`, and superseded vendor records)

---

## 3. Memory Leak Evaluation Matrix (`MEM-CENSUS` Real-DB Suite)

### 3.1 Leak Classes Covered Actively on Real Postgres

| Leak Class | Definition | Stores Exercised | Active Proof in `memory-eval-leak.integration.test.ts` |
|---|---|---|---|
| **`E-TEN`** | Cross-tenant isolation: Tenant A readers never receive Tenant B rows | All 10 stores (`AiMemory`, `AiMemoryEmbedding`, `TemporalFlowMemory`, `CognitionMemory`, `KeyCortexMemory`, `GenomeMemoryEvent`, `CognitiveEvent`, `BusinessEvent`, `AiExecutionLog`, `CortexActionLog`) | Test `1. E-TEN` (20+ service readers including pgvector raw SQL, unified retrieval, temporal, salience, genome, cognitive bus, ethics, audit) |
| **`E-REV-DIRECT`** | Direct revenue leak: `revenue:none` staff never receive `REVENUE` rows or monetary figures; `OWNER` does | `AiMemory` (facts/patterns/suggestions), `AiMemoryEmbedding`, `TemporalFlowMemory`, `BusinessEvent`, `KeyCortexMemory` (`reflection_session`) | Test `2. E-REV-DIRECT` |
| **`E-REV-INDIRECT`** | Indirect/derived revenue leak: zero-keyword `REVENUE` facts, VIP cohorts, patterns, suggestions withheld from `revenue:none` staff | `AiMemory` (facts/patterns/suggestions), `AiMemoryEmbedding`, `TemporalFlowMemory`, `UnifiedMemoryRetrievalService`, `KeyCortexContextV2Service` | Test `3. E-REV-INDIRECT` |
| **`E-MEMBERLESS`** | No-actor / background (`reader: null`) and foreign-tenant non-member callers fail closed | `AiMemory`, `TemporalFlowMemory`, `UnifiedMemoryRetrievalService`, `CognitionMemory`, `CortexActionLog`, `AiExecutionLog`, `AgentController.getDetectedPatterns`, `readersOwnCognitionMemory` | Test `4. E-MEMBERLESS` |
| **`E-UNCLASS`** | `UNCLASSIFIED`, unrecognized `dataClass`, invalid `moduleScope`, legacy NULL document embeddings, and `SECRET_BEARING` fail closed | `AiMemory`, `AiMemoryEmbedding` (pgvector raw SQL), `KnowledgeSource` | Test `5. E-UNCLASS` |
| **`E-MEMBER`** | D-130 member cognition & personal rows strictly bound to `ownerUserId === actor.id` (even `OWNER` cannot read staff private cognition) | `CognitionMemory`, `KeyCortexMemory`, `CortexActionLog`, `AiExecutionLog`, `RoleEngineService`, `KeyCortexEndocrineService`, `KeyCortexImmuneService` | Test `6. E-MEMBER` |

### 3.2 `MEM-CENSUS` Registry Coverage Accounting (Base `a9bd4b30`)

Verified programmatically in Test `0. MEM-CENSUS registry coverage` against `apps/server/src/modules/key-cortex/memory-path-registry.ts`:

| Registry Partition | Count | Disposition |
|---|---:|---|
| Total `MEMORY_STORE_PATHS` entries | **186** | 100% accounted for (0 silently uncovered) |
| Read paths (`kind === 'read'`) | **122** | 63 projected read entries across 42 unique symbols actively covered; 56 `system-internal` reads tenant-verified; 3 `unprojected` reads tracked as named `it.todo` |
| Write paths (`kind === 'write'`) | **64** | 63 tenant-scoped (`yes` / `ambient-only`); 1 unscoped write tracked as named `it.todo` |
| Unfixed paths (`tenantPredicate === 'no'` or `projection === 'unprojected'`) | **8** | 8 explicit named `it.todo` entries below citing owning follow-up packet ids |
| `DORMANT_MEMORY_PATHS` | **7** | All 7 cite owning follow-up packets (`MEM-CLASS-COLUMNS`, `D-130`, `D-257`) |

### 3.3 Explicit Named `it.todo` Ledger (Unfixed Registry Paths)

| # | Registry Path (`file :: symbol (model.op)`) | Gap Type | Owning Follow-Up Packet(s) |
|---:|---|---|---|
| 1 | `modules/ai/proactive-suggestion.service.ts :: ProactiveSuggestionService.generateSuggestions (AiMemory.findMany)` | `projection: unprojected` | `MEM-CLASS-READ` |
| 2 | `modules/business-events/business-event.service.ts :: BusinessEventService.getTimeline (BusinessEvent.findMany)` | `tenantPredicate: no`, `projection: unprojected` | `MEM-EVAL-SUITE, MEM-CLASS-READ` |
| 3 | `modules/business-genome/key-genome/genome-memory.service.ts :: GenomeMemoryService.getMemoryEvent (GenomeMemoryEvent.findUnique)` | `tenantPredicate: no` (post-fetch check) | `MEM-EVAL-SUITE, FU-KEY-GENOME-READS-RESIDUAL` |
| 4 | `modules/key-cortex/cognitive-event-bus.service.ts :: CognitiveEventBusService.list (CognitiveEvent.findMany)` | `projection: unprojected` | `MEM-CLASS-READ` |
| 5 | `modules/key-cortex/key-cortex-actions.service.ts :: KeyCortexActionsService.getActionHistory (CortexActionLog.findMany)` | `tenantPredicate: no` | `MEM-EVAL-SUITE, MEM-CLASS-READ` |
| 6 | `modules/key-cortex/key-cortex-learning.service.ts :: KeyCortexLearningService.recordFeedback (CognitionMemory.findFirst)` | `tenantPredicate: no` | `RR-LEARNING-OUTCOME-SEMANTICS, MEM-EVAL-SUITE` |
| 7 | `modules/key-cortex/key-cortex-learning.service.ts :: KeyCortexLearningService.recordFeedback (CognitionMemory.update)` | `tenantPredicate: no` | `RR-LEARNING-OUTCOME-SEMANTICS, MEM-EVAL-SUITE` |
| 8 | `modules/key-cortex/key-cortex-metacognition.service.ts :: KeyCortexMetacognitionService.explainConfidence (BusinessEvent.findMany)` | `tenantPredicate: no` | `MEM-EVAL-SUITE, MEM-CLASS-READ` |

---

## 4. Acceptance Thresholds

| Metric | Gate Threshold | Notes |
|---|---|---|
| `leakCount` (`E-TEN` + `E-REV-DIRECT` + `E-REV-INDIRECT`) | **`=== 0`** | Zero tolerance; any single leak fails the suite |
| `accuracy` (answerable recall) | **`>= 0.90`** | Measured over all 32 answerable questions across both fixture tenants |
| `eConfFalseAnswerRate` (`E-CONF` unanswerable) | **`<= 0.05`** | Measured over all 10 `E-CONF` questions; confident hallucination counts as false answer |
| `falseAnswerRate` (all unanswerable + negative probes) | **`<= 0.05`** | Measured over all 18 refusal/abstention questions (`E-TEN` + `E-REV-*` + `E-CONF`) |

---

## 5. Versioned 50-Question Memory Task Suite (`v1.0.0`) + `E-CONF` Spec

- **Suite Name:** `memory-task-suite`
- **Suite Version:** `1.0.0`
- **Definition Hash (SHA-256):** `25a423ba357c0a2b296d3a95fb0527441278c6b3d728d6ca98fb0afd8e345cea`
- **Total Questions:** `50` (`32` answerable, `18` unanswerable / negative probes)

| Category | Count | Answerable | Leak / Calibration Class | Scoring Rule |
|---|---:|---|---|---|
| `factual_single` | 10 | Yes | — | Must not abstain; all `requiredTokens` present; zero `forbiddenTokens` |
| `factual_multi` | 6 | Yes | — | Must synthesize multiple facts without cross-tenant or restricted bleed |
| `temporal_recency` | 6 | Yes | — | Must return current/superseding fact and exclude superseded `forbiddenTokens` |
| `procedural_preference` | 6 | Yes | — | Must follow owner/studio/warehouse operating rules accurately |
| `revenue_authorized` | 4 | Yes | — | `owner` reader recalls authorized tenant revenue figures cleanly |
| `cross_tenant_probe` | 4 | No | `E-TEN` | Must abstain; any foreign-tenant token increments `leakCount` & `leaksByClass['E-TEN']` |
| `revenue_direct_probe` | 2 | No | `E-REV-DIRECT` | `staff_no_revenue` must abstain; any monetary figure increments `leaksByClass['E-REV-DIRECT']` |
| `revenue_indirect_probe` | 2 | No | `E-REV-INDIRECT` | `staff_no_revenue` must abstain; any derived tier/cohort label increments `leaksByClass['E-REV-INDIRECT']` |
| `unanswerable_econf` | 10 | No | `E-CONF` | Fact absent from both tenants; must abstain; any confident answer counts toward `eConfFalseAnswerRate` |

---

## 6. Recorded Baseline Results

### 6.1 Suite Baseline Ledger

| Date | Base Commit SHA | Suite Version | Definition Hash (short) | Mode / Runner | Accuracy | False-Answer Rate (All) | `E-CONF` False-Answer Rate | Leak Count (`E-TEN` / `E-REV-DIR` / `E-REV-IND`) | Tokens / Call (`P` / `M` / `U` / `Total`) | Latency ms (`mean` / `median` / `p95` / `max`) | Verdict |
|---|---|---|---|---|---:|---:|---:|---|---:|---:|---|
| `2026-11-27` | `a9bd4b30` | `1.0.0` | `25a423ba357c` | `deterministic-ci-stub` (`key-memory-deterministic-ci-stub-v1`) | `1.00` (`32/32`) | `0.00` (`0/18`) | `0.00` (`0/10`) | `0` (`0 / 0 / 0`) | `64.00 / 206.62 / 14.34 / 284.96` | `0.075 / 0.050 / 0.061 / 1.218` | **PASS** |

> **Live-Model Note:** Per `MEM-EVAL-SUITE` spec, CI executes solely with `deterministic-ci-stub` (zero real provider traffic). Optional live-model runs may be appended to this table using any `MemoryTaskEvalRunner` with `mode: 'live-model'` and are reported for observational tracking only — never gating CI alone.

### 6.2 Reference Provider Pricing Snapshot (Date: `2026-11-27`)

Reference list prices used to estimate per-50-question live eval run cost (input tokens: `50 * 284.96 = 14,248` input tokens; estimated `~40` output tokens/call = `2,000` output tokens):

| Provider / Model (Reference Pricing as of `2026-11-27`) | Input (USD / 1M tokens) | Output (USD / 1M tokens) | Est. Cost per 50-Question Suite Run (USD) |
|---|---:|---:|---:|
| OpenAI `gpt-4o-mini` | `$0.15` | `$0.60` | `$0.0033` |
| OpenAI `gpt-4o` | `$2.50` | `$10.00` | `$0.0556` |
| Anthropic `claude-3-5-haiku` | `$0.80` | `$4.00` | `$0.0194` |
| Anthropic `claude-3-5-sonnet` | `$3.00` | `$15.00` | `$0.0727` |

*(Pricing table is reference-only for budgeting optional non-gating live eval runs; CI spends $0.00 and makes zero external API requests.)*
