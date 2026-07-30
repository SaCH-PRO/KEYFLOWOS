# KEYFLOWOS — Mind / Soul / Evolution Master Plan

**Subtitle:** From AI Co-Pilot to Autonomous Digital Employee  
**Scope:** Mind, Soul, and Evolution capabilities only. Body / tools / new connectors are explicitly out of scope.  
**Date:** 2026-06-26  
**Status:** Updated after fresh baseline audit — ready for execution  

---

## 1. Vision & Definition of Done

### 1.1 The goal
KEYFLOWOS should feel like the best business partner and employee a user could hire:  
- It **remembers** the business like an institutional veteran.  
- It **reasones** across functions like a senior operator.  
- It **acts** with judgment, not just speed.  
- It **explains itself** so users trust it.  
- It **learns** from every interaction and outcome.  
- It **evolves** its own understanding of the business without losing its values.

### 1.2 Definition of done
The Mind / Soul / Evolution layer is considered complete when:
1. A single `AutonomyOrchestratorService` returns one canonical verdict for every proposed action.
2. A single `UnifiedMemoryRetrievalService` ranks and fetches relevant context across all memory stores.
3. KEY can generate, simulate, execute, and revise multi-step plans without a prompt.
4. Every recommendation carries a calibrated confidence score and a trust explanation.
5. The Soul’s values are updated from human feedback and auditable.
6. An automated `EvalHarnessService` runs continuously and blocks regressions.
7. KEY can ingest live best-practice / market / regulatory knowledge and apply it within guardrails.
8. The system passes a “digital employee” acceptance test: it handles a full week of routine business operations with human-level judgment and fewer than one escalation per critical decision.

---

## 2. Guiding Principles

1. **Mind ↔ Soul integration first.** A fast Mind without a live Soul is dangerous; a cautious Soul without a capable Mind is useless.
2. **One source of truth per concern.** One autonomy oracle. One memory retrieval layer. One value model. One eval harness.
3. **Evidence before action.** Every autonomous decision must be traceable to Genome facts, user authority, or explicit policy.
4. **Calibrated trust.** KEY must know when it is uncertain and escalate gracefully.
5. **Human-in-the-loop by default, autonomous by grant.** Authority is delegated per business, per domain, per risk tier.
6. **Evolve safely.** Learning loops must be sandboxed, evaluated, and reversible.
7. **Do not expand the Body.** No new connectors, commerce modules, or operational tools unless required to feed the Mind/Soul.

---

## 3. Current State Baseline (Fresh Audit)

### 3.1 Capability maturity (L1–L5)

| Subsystem | Score | Rationale |
|---|---|---|
| **Mind — Perception** | **L2** | `key-inbox`, `temporal-flow`, connectors produce events, but there is no normalized `CognitiveEventBus`; signals are module-specific. |
| **Mind — Reasoning** | **L2–L3** | `KeyCortexReasoningService` orchestrates LLM + router + actions, but the live autonomy integration is **broken** and there is no chain-of-thought verification or tool-use validation. |
| **Mind — Memory** | **L2** | Multiple stores exist; semantic search works but is empty without backfill; no unified retrieval; `KeyCortexMemoryService` is Redis-only with a 10-minute TTL. |
| **Mind — Planning** | **L2** | `PlannerService`/`PlanExecutorService` are reactive; no simulation, long-horizon planning, or replanning. |
| **Mind — Metacognition** | **L2–L3** | `TrustExplanationService` generates static explanations; `KeyCortexLearningService` records feedback and calibrates confidence, but calibration is coarse and not surfaced in UX. |
| **Soul — Identity** | **L4** | `BusinessBlueprint` + `BusinessGenome` + DNA mapping are robust; integrity/completeness scoring exists. |
| **Soul — Values** | **L2** | `BusinessConstitutionVersion` exists, but values are static; no feedback-driven `ValueLearningService` yet. |
| **Soul — Governance** | **L3** | Constitution, `AuthorityGrant`, `AutopilotSettings`, and `GenomeAutonomyGateService` exist, but multiple overlapping approval/autonomy services create inconsistent verdicts. |
| **Soul — Trust** | **L3** | Explanations and audit trails exist, but confidence/uncertainty is not consistently shown to users. |
| **Soul — Voice** | **L2** | Personas are rich but not grounded in Blueprint values; no value-conflict warnings. |
| **Evolution** | **L2** | Learning loops exist, but no eval harness, knowledge ingestion, or automated consolidation. |

**Summary:** The foundation is broad but not coherent. The two biggest risks are (1) the live autonomy gate is bypassed in the reasoning path, and (2) memory is fragmented and partly ephemeral.

### 3.2 What already exists

| Layer | Existing assets |
|---|---|
| **Mind — Perception** | `key-inbox-*`, `temporal-flow`, connectors, event listeners |
| **Mind — Reasoning** | `key-cortex-reasoning.service.ts`, `adaptive-router.service.ts`, `ModelGatewayService` |
| **Mind — Memory** | `CortexSession`, `KeyCortexMemoryService`, `AiMemory`/`AiMemoryEmbedding`, `GenomeMemoryEvent`, `CognitionMemory`, `TemporalFlowMemory` |
| **Mind — Planning** | `key-cortex-command.service.ts`, `key-cortex-executor.service.ts`, `key-autonomy` proposals |
| **Mind — Metacognition** | `trust-explanation.service.ts`, `outcome-learning.service.ts`, `genome-scoring.service.ts` |
| **Soul — Identity** | `BusinessBlueprint`, `BusinessGenome`, DNA sections, genome stage |
| **Soul — Values** | Rule-based guardrails, risk penalties, approval requirements |
| **Soul — Governance** | `BusinessConstitutionVersion`, `genome-autonomy-gate.service.ts`, `AuthorityGrant`, `AutopilotSettings` |
| **Soul — Trust** | Audit trails, `trust-explanation.service.ts`, WebSocket presence |
| **Soul — Voice** | `key-cortex-personality.service.ts` personas, Blueprint brand voice |
| **Evolution** | `outcome-learning.service.ts`, `GenomeMemoryEvent`, `CognitionMemory` |

### 3.3 Critical blockers (updated from audit)

1. **Autonomy gate is bypassed in the live path.** `KeyCortexReasoningService.processQuery` passes the wrong argument shape to `genomeBridgeService.checkAutonomy()` and treats the returned object as a boolean, so every action appears approved.
2. **Five overlapping approval/autonomy services/tables:** `AiOversightService`, `KeyCortexApprovalService`, `GenomeAutonomyGateService`, `KeyActionPolicyService`, `KeyActionGenomePolicyService`, plus tables `aiApprovalRequest`, `aiApprovalItem`, `approvalRequest`, `keyActionProposal`.
3. **Memory is fragmented and partly ephemeral.** `KeyCortexMemoryService` stores typed memory in Redis with a 10-minute TTL and no DB path.
4. **Semantic search is unpopulated and unsafe.** `SemanticMemoryService.search` uses `$queryRawUnsafe` with direct interpolation (`limit`, `sourceTypes`) and requires backfill from `AiMemory`.
5. **Reactive planning only** — no long-horizon plan generation or simulation.
6. **No automated eval harness** for autonomy verdict consistency, memory retrieval, or recommendation accuracy.
7. **Values are static** — no feedback-driven value refinement.
8. **No live knowledge ingestion** pipeline for best practices, science, or regulation.
9. **Three autonomy-level settings sources:** `BusinessBlueprint.aiPreferences.autonomyLevel`, `AutopilotSettings.autonomyLevel`, `BusinessSettings.aiAutonomyLevel`. No canonical source.
10. **Widespread `(as any)` casts** bypass compile-time checks and allowed the autonomy-call signature mismatch to slip through a passing build.

---

## 4. Target State Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        USER / UI                             │
└───────────────────────┬─────────────────────────────────────┘
                        │
┌───────────────────────▼─────────────────────────────────────┐
│              UNIFIED INTERFACE LAYER                         │
│   CopilotPanel · KeyAgent · Command Palette · Voice          │
└───────────────────────┬─────────────────────────────────────┘
                        │
┌───────────────────────▼─────────────────────────────────────┐
│                      THE MIND                                │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────────────┐   │
│  │ Perception  │ │  Reasoning  │ │  Planning / Action  │   │
│  │  Engine     │ │   Engine    │ │      Engine         │   │
│  └─────────────┘ └─────────────┘ └─────────────────────┘   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │          Unified Memory Retrieval Service           │   │
│  └─────────────────────────────────────────────────────┘   │
└───────────────────────┬─────────────────────────────────────┘
                        │ consults
┌───────────────────────▼─────────────────────────────────────┐
│                      THE SOUL                                │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────────────┐   │
│  │  Identity   │ │   Values    │ │    Governance       │   │
│  │  Kernel     │ │   Kernel    │ │    Constitution     │   │
│  └─────────────┘ └─────────────┘ └─────────────────────┘   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │        Autonomy Orchestrator Service                │   │
│  └─────────────────────────────────────────────────────┘   │
└───────────────────────┬─────────────────────────────────────┘
                        │ learns from
┌───────────────────────▼─────────────────────────────────────┐
│                   EVOLUTION ENGINE                           │
│  Eval Harness · Feedback Loops · Knowledge Ingestion ·      │
│  Value Learning · Memory Consolidation · Self-Assessment     │
└─────────────────────────────────────────────────────────────┘
                        │
┌───────────────────────▼─────────────────────────────────────┐
│              BODY (existing — not expanded)                  │
│   CRM · Commerce · Bookings · Finance · Projects · Connectors│
└─────────────────────────────────────────────────────────────┘
```

---

## 5. Strategic Pillars

### Pillar 1: Unified Mind
**Objective:** Turn fragmented cognition into one coherent brain.

**Key initiatives:**
1. **Perception unification** — build a `CognitiveEventBus` that turns every input into a normalized signal with embeddings, provenance, and confidence.
2. **Reasoning engine** — complete the Cortex↔Genome bridge; add chain-of-thought verification, tool-use validation, and uncertainty quantification.
3. **Unified memory retrieval** — build `UnifiedMemoryRetrievalService` that ranks context from conversation, Genome, cognition, and temporal memory.
4. **Planning engine** — build `PlanEngineService` for goal decomposition, simulation, execution monitoring, and replanning.
5. **Metacognition** — add calibrated confidence scores, “I don’t know” escalation, and automatic error detection.

### Pillar 2: Integrated Soul
**Objective:** Give KEY a coherent identity, value system, and governance conscience.

**Key initiatives:**
1. **Identity kernel** — formalize `BusinessBlueprint` + `BusinessGenome` as the canonical self-model; auto-update integrity scores.
2. **Values kernel** — build `ValueLearningService` that translates approvals/rejections into weighted value constraints.
3. **Autonomy orchestrator** — consolidate all approval/autonomy services into one `AutonomyOrchestratorService` used by every module.
4. **Trust & relationship** — deepen emotional context modeling and relationship-state tracking.
5. **Voice alignment** — ground personas in Blueprint values so tone never conflicts with ethics.

### Pillar 3: Evolution Engine
**Objective:** Make KEY genuinely self-improving and connected to modern knowledge.

**Key initiatives:**
1. **Eval harness** — build `EvalHarnessService` with deterministic test suites for autonomy, explanations, recommendations, and safety.
2. **Feedback-driven learning** — formalize `KeyInteractionFeedback`, `CognitionMemory`, and `GenomeMemoryEvent` into a single learning loop.
3. **Memory consolidation** — implement importance scoring, decay, conflict resolution, and cross-store consolidation.
4. **Knowledge ingestion** — build `KnowledgeIngestionService` to pull best practices, science, regulations, and convert them into Genome facts / constitution amendments.
5. **Self-assessment** — periodic “state of KEY” reports measuring drift, capability, and alignment.

---

## 6. Phase Roadmap

### Phase 0 — Stabilization (Weeks 1-4)
**Goal:** Fix the live autonomy bypass, secure memory, establish interfaces, and prevent regressions.

**Deliverables:**
| # | Deliverable | New / Modified Files | Success Criteria |
|---|---|---|---|
| 0.1 | Fix live autonomy bypass in `KeyCortexReasoningService.processQuery` | `apps/server/src/modules/key-cortex/key-cortex-reasoning.service.ts:489–496` | `checkAutonomy()` receives correct input and verdict `allowed`/`requiresApproval` is respected. |
| 0.2 | Fix `getRankedRecommendations` call signature | `apps/server/src/modules/key-cortex/key-cortex-reasoning.service.ts:526–529` | No silent signature misuse; returns recommendations correctly. |
| 0.3 | Add `AutonomyOrchestratorService` interface + register in `KeyAutonomyModule` | `apps/server/src/modules/key-autonomy/autonomy-orchestrator.service.ts`, `key-autonomy.module.ts` | Service exists and is injectable; initial implementation delegates to existing providers. |
| 0.4 | Add `UnifiedMemoryRetrievalService` interface + register in `KeyCortexModule` | `apps/server/src/modules/key-cortex/unified-memory-retrieval.service.ts`, `key-cortex.module.ts` | Service exists and is injectable. |
| 0.5 | Add `EvalHarnessService` skeleton | `apps/server/src/modules/key-cortex/eval-harness.service.ts` | CI runs two suites: autonomy consistency + memory retrieval precision. |
| 0.6 | Fix `SemanticMemoryService.search` SQL injection | `apps/server/src/modules/ai/semantic-memory.service.ts:81–90` | Parameters are parameterized; no `$queryRawUnsafe` interpolation. |
| 0.7 | Add vector similarity index on `ai_memory_embeddings` | `packages/db/prisma/schema.prisma`, migration | Semantic search is performant at scale. |
| 0.8 | Backfill `AiMemory` → `AiMemoryEmbedding` | `apps/server/src/modules/ai/semantic-memory.service.ts` | Existing tenants have searchable embeddings. |
| 0.9 | Deprecate or DB-back `KeyCortexMemoryService` | `apps/server/src/modules/key-cortex/key-cortex-memory.service.ts`, `key-cortex-conversation.service.ts` | No business memory can evaporate on cache eviction. |
| 0.10 | Implement `buildReadinessWarning` stub | `apps/server/src/modules/key-autonomy/genome-recommendation-action-bridge.service.ts:379–384` | Returns actionable readiness warnings. |
| 0.11 | Document approval-table consolidation plan | `docs/KEY_APPROVAL_TABLE_SUNSET_PLAN.md` | Team agrees on canonical pending-state table. |
| 0.12 | Freeze Body scope | Team comms + architecture board | No new connectors/commerce modules during this plan. |

**Success metric:** All existing tests pass; zero known stubbed functions on the critical path; eval harness runs green.

---

### Phase 1 — Foundation: One Mind, One Soul (Weeks 5-14)
**Goal:** Create the central integration points: autonomy oracle and unified memory.

**Deliverables:**
| # | Deliverable | New / Modified Files | Owner |
|---|---|---|---|
| 1.1 | `AutonomyOrchestratorService` full implementation | `apps/server/src/modules/key-autonomy/autonomy-orchestrator.service.ts` | Platform |
| 1.2 | Unified autonomy schema & data model | Prisma: `AutonomyVerdict`, `AutonomyRule` migration; keep `AuthorityGrant` | Data |
| 1.3 | Refactor existing autonomy services to call orchestrator | `AiOversightService`, `GenomeAutonomyGateService`, `KeyActionPolicyService`, `KeyActionGenomePolicyService` | Platform |
| 1.4 | `UnifiedMemoryRetrievalService` full implementation | `apps/server/src/modules/key-cortex/unified-memory-retrieval.service.ts` | Mind |
| 1.5 | Memory fragment normalization | Add `MemoryFragment` shape used across `AiMemory`, `AiMemoryEmbedding`, `GenomeMemoryEvent`, `TemporalFlowMemory`, `CognitionMemory` | Data |
| 1.6 | Complete Cortex↔Genome bridge | `KeyCortexGenomeBridgeService`, `KeyCortexReasoningService` | Mind+Soul |
| 1.7 | Consolidate approval writes | `KeyCortexActionsService`, `KeyCortexApprovalService`, `KeyActionProposalService` | Platform |
| 1.8 | Canonical autonomy-level source | Pick one source (`AutopilotSettings.autonomyLevel`) with explicit fallback chain | Platform |
| 1.9 | Mind/Soul contract documentation | `docs/KEY_MIND_SOUL_CONTRACT.md` | Product |
| 1.10 | Expand eval harness | Add zero-contradictory-verdicts and memory retrieval ≥70% precision suites | Evolution |

**Success metrics:**
- 100% of autonomous actions route through `AutonomyOrchestratorService`.
- Unified memory retrieval used by `KeyCortexReasoningService`.
- Zero contradictory autonomy verdicts in synthetic test suite.
- `SemanticMemoryService.search` passes security review.

---

### Phase 2 — Cognitive Upgrade: Reasoning, Memory, Planning (Weeks 15-30)
**Goal:** Make the Mind capable of complex, context-aware, proactive cognition.

**Deliverables:**
| # | Deliverable | Description |
|---|---|---|
| 2.1 | `CognitiveEventBus` | Normalize all business events into structured signals with embeddings and provenance. |
| 2.2 | Reasoning engine v2 | Add chain-of-thought verification, tool-use validation, and calibrated confidence to Cortex reasoning. |
| 2.3 | `PlanEngineService` | Goal decomposition, plan simulation, execution monitoring, autonomous replanning. |
| 2.4 | Long-horizon memory | Implement recency/relevance/importance ranking; memory decay and consolidation. |
| 2.5 | Uncertainty quantification | Force KEY to escalate when confidence < threshold; surface confidence in UX. |
| 2.6 | Neurosymbolic guardrails | Combine LLM reasoning with deterministic rule checks for high-stakes actions. |

**Success metrics:**
- KEY can execute a 5-step plan with < 1 human escalation per 10 steps.
- Memory retrieval precision ≥ 80% on held-out relevance tests.
- Hallucination rate on action proposals reduced by 50% from baseline.

---

### Phase 3 — Soul Maturation: Values, Trust, Voice (Weeks 31-44)
**Goal:** Make the Soul dynamic, emotionally aware, and deeply aligned with the business.

**Deliverables:**
| # | Deliverable | Description |
|---|---|---|
| 3.1 | `ValueLearningService` | Convert user approvals/rejections into weighted value constraints; detect value drift. |
| 3.2 | Values dashboard | UX for users to inspect and edit KEY’s inferred values and constitution. |
| 3.3 | `EmotionalContextService` | Track relationship state, sentiment trajectory, and rapport signals per contact/user. |
| 3.4 | Persona grounding | Bind each persona to Blueprint values; add “value conflict” warnings. |
| 3.5 | Trust calibration | Surface confidence, reasoning, and uncertainty appropriately; avoid false intimacy. |
| 3.6 | Constitution amendment flow | Safe process for updating `BusinessConstitutionVersion` with audit and rollback. |

**Success metrics:**
- User-perceived alignment score ≥ 4.2 / 5 in qualitative interviews.
- Value-based rejections decrease by 40% as KEY learns user preferences.
- No persona response contradicts stated business values in eval harness.

---

### Phase 4 — Evolution Engine: Learning & Knowledge (Weeks 45-58)
**Goal:** Make KEY self-improving and connected to the latest knowledge.

**Deliverables:**
| # | Deliverable | Description |
|---|---|---|
| 4.1 | `EvalHarnessService` | Automated evals for autonomy, explanations, recommendations, memory retrieval, safety. |
| 4.2 | Continuous learning loop | Formalize feedback → memory → model/policy update → evaluation → deployment. |
| 4.3 | `KnowledgeIngestionService` | Ingest best-practice docs, research, regulations; convert to Genome facts or constitution policies. |
| 4.4 | Memory consolidation jobs | Nightly jobs that consolidate, decay, and resolve conflicts across memory stores. |
| 4.5 | Self-assessment reports | Weekly “state of KEY” report: capability drift, alignment, knowledge gaps. |
| 4.6 | Regression gates | Eval harness runs in CI; failures block merge. |

**Success metrics:**
- Eval harness covers ≥ 80% of autonomous decision paths.
- KEY demonstrably improves on held-out task accuracy month-over-month.
- New best-practice knowledge applied within 24 hours of ingestion.

---

### Phase 5 — Enterprise Autonomy: Safety, Compliance, Scale (Weeks 59-72)
**Goal:** Make KEY trustworthy enough to operate as a core employee in real businesses.

**Deliverables:**
| # | Deliverable | Description |
|---|---|---|
| 5.1 | `SafetyShellService` | Deterministic pre-conditions, post-conditions, idempotency, automatic rollback. |
| 5.2 | Compliance mapping | Map autonomy tiers to NIST AI RMF / EU AI Act / ISO 42001 risk categories. |
| 5.3 | Audit dashboard | Immutable logs of every autonomous decision, override, and value change. |
| 5.4 | Human escalation design | Graceful handoff when confidence is low or values conflict. |
| 5.5 | Performance at scale | Memory retrieval and autonomy checks < 100ms p95. |
| 5.6 | “Digital employee” acceptance test | End-to-end 1-week simulation of routine operations. |

**Success metrics:**
- Pass digital employee acceptance test with < 1 escalation per critical decision.
- Autonomy decision latency p95 < 100ms.
- Zero safety regressions in production for 30 days.

---

## 7. Execution Model

### 7.1 Team shape
| Role | Responsibility |
|---|---|
| **Mind Lead** | Reasoning, memory, planning, perception unification. |
| **Soul Lead** | Identity, values, governance, trust, autonomy orchestrator. |
| **Evolution Lead** | Eval harness, learning loops, knowledge ingestion, self-assessment. |
| **AI Safety Engineer** | Guardrails, compliance, safety shell, red-teaming. |
| **Product / UX** | Personas, trust UI, values dashboard, escalation flows. |
| **Platform / Data** | Prisma migrations, vector store, event bus, CI eval gates. |

### 7.2 Rituals
- **Weekly Mind/Soul sync:** review autonomy verdict consistency, memory retrieval quality, and eval results.
- **Bi-weekly red-team session:** attempt to make KEY take harmful, inconsistent, or unethical actions.
- **Monthly evolution review:** measure capability drift, value alignment, and knowledge gaps.
- **Quarterly external review:** invite domain experts (AI safety, business operations, legal) to stress-test.

### 7.3 Definition of ready for each deliverable
- Clear user story and acceptance criteria.
- Eval test cases written before implementation.
- Data model impact reviewed.
- Safety and rollback plan documented.

---

## 8. Success Metrics & KPIs

### 8.1 Capability metrics
| Metric | Baseline | Phase 1 | Phase 3 | Phase 5 |
|---|---|---|---|---|
| Autonomy verdict consistency | Low | 100% | 100% | 100% |
| Memory retrieval precision | N/A | 70% | 80% | 90% |
| Plan completion without escalation | N/A | 50% | 75% | 90% |
| Explanation quality score (human) | 3.0/5 | 3.5/5 | 4.2/5 | 4.7/5 |
| Hallucination rate on action proposals | Baseline | -30% | -50% | -80% |
| Value alignment score (human) | N/A | 3.5/5 | 4.2/5 | 4.7/5 |

### 8.2 Business metrics
- **Task automation rate:** % of routine business tasks completed without human involvement.
- **Time-to-decision:** average time from business event to executed action.
- **Escalation rate:** human overrides per 100 autonomous decisions.
- **User trust score:** “I would let KEY act on my behalf” — % agreeing.
- **Operational cost reduction:** measured against hiring equivalent office staff.

---

## 9. Risk Register

| Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|
| Live autonomy bypass causes unsafe autonomous actions | **Critical** | **Now** | Phase 0.1 fix before any autonomy expansion. |
| Overlapping autonomy services cause inconsistent behavior | High | High | Phase 1 consolidation into `AutonomyOrchestratorService`. |
| Unified memory retrieval is slow or inaccurate | High | Medium | Start with simple ranking; add vector search incrementally; benchmark. |
| Users reject autonomous actions due to lack of trust | High | Medium | Invest heavily in trust explanations, confidence scores, and gradual authority grants. |
| Value learning drifts away from user intent | High | Low | Human-reviewed value dashboard; sandbox value updates; rollback. |
| `KeyCortexMemoryService` Redis TTL causes data loss | High | Now | Phase 0.9 deprecate or DB-back. |
| `SemanticMemoryService.search` SQL injection | High | Now | Phase 0.6 parameterize query. |
| Real-time knowledge ingestion introduces bad advice | Medium | Medium | Source allowlisting, confidence scoring, human curation of constitution amendments. |
| Phase scope creep into Body/tools | Medium | High | Explicit Body freeze; architecture review board; tie every PR to Mind/Soul/Evolution. |
| Regulatory / liability concerns | High | Medium | Compliance mapping in Phase 5; immutable audit logs; human escalation design. |
| Team burnout from too many parallel pillars | Medium | Medium | Sequential phases; one pillar lead per phase; clear milestones. |

---

## 10. Appendix A: Existing Code → Plan Mapping

| Existing asset | Role in plan |
|---|---|
| `key-cortex-reasoning.service.ts` | Becomes the reasoning orchestrator; consumes unified memory and autonomy verdicts. |
| `adaptive-router.service.ts` | Remains the meta-controller; extended with confidence and safety signals. |
| `ModelGatewayService` / `AiUsageService` | Remains the LLM router; augmented with eval logging and prompt versioning. |
| `KeyCortexMemoryService` | **Deprecate / rewrite** — either migrate to DB-backed store or replace usage with `AiMemoryService`. |
| `AiMemory` / `AiMemoryEmbedding` | Core semantic memory tables; enhance with memory fragment abstraction and vector index. |
| `GenomeMemoryEvent` / `CognitionMemory` / `TemporalFlowMemory` | Sources for unified retrieval and consolidation. |
| `BusinessBlueprint` / `BusinessGenome` | Identity kernel; auto-updating integrity and stage logic. |
| `BusinessConstitutionVersion` | Immutable governance document; amendment flow in Phase 3. |
| `genome-autonomy-gate.service.ts` | Refactored into `AutonomyOrchestratorService` rule provider. |
| `AiOversightService` | Refactored to settings/authority provider for orchestrator. |
| `KeyActionPolicyService` | Refactored to action metadata only; no final verdicts. |
| `KeyActionGenomePolicyService` | Merged into orchestrator as module-readiness rule provider. |
| `KeyCortexApprovalService` | **Deprecate** — superseded by unified `AutonomyVerdict` / `KeyActionProposal`. |
| `trust-explanation.service.ts` | Core trust surface; extended with confidence calibration. |
| `outcome-learning.service.ts` | Core learning loop; formalized into Evolution Engine. |
| `key-cortex-personality.service.ts` | Grounded in Blueprint values in Phase 3. |

---

## 11. Appendix B: Stub Registry (from audit)

| File | Line | Symbol | Impact | Plan fix |
|---|---|---|---|---|
| `key-cortex/key-cortex-reasoning.service.ts` | 489–496 | `processQuery` autonomy call | **Critical** | Phase 0.1 |
| `key-cortex/key-cortex-reasoning.service.ts` | 526–529 | `getRankedRecommendations` call | **Critical** | Phase 0.2 |
| `key-cortex/key-cortex-memory.service.ts` | 91–121, 229–232 | `store`, `persistMemory` | **Critical** | Phase 0.9 |
| `key-cortex/key-cortex-actions.service.ts` | 241–299 | `requestApproval` | **Critical** | Phase 1.7 |
| `ai/semantic-memory.service.ts` | 81–90 | `search` SQL injection | **Critical** | Phase 0.6 |
| `key-cortex/key-cortex-connector.service.ts` | 4205–4229 | Genome DNA placeholders | Medium | Phase 2 |
| `key-autonomy/genome-recommendation-action-bridge.service.ts` | 379–384 | `buildReadinessWarning` | Medium | Phase 0.10 |
| `key-cortex/key-cortex-insight.service.ts` | 1293, 1301 | `getActiveBusinessIds`, `getBusinessHealth` | Low | Phase 2+ |
| `ai/key-command.service.ts` | 517–530 | `enqueue`, `execute` | Low | Deprecate |
| `ai/key-tool.registry.ts` | 244 | `procurement.generateBrief` | Low | Body-related, freeze |
| `ai/flow-orchestrator.service.ts` | 2575 | `generate_content_brief` | Low | Body-related, freeze |
| `key-cortex/key-cortex-document.service.ts` | 1202–1204 | `uploadFile` | Low | Body-related, freeze |
| `key-cortex/key-cortex-voice.service.ts` | 647–651 | audio upload | Low | Body-related, freeze |
| `key-cortex/key-cortex-context.service.ts` | ~200 | conversion rate | Low | Body-related, freeze |

---

## 12. Immediate Next Steps (This Week)

1. **Approve the updated plan** and confirm Body freeze.
2. **Implement Phase 0.1–0.6** (autonomy bypass fix, ranked-rec fix, orchestrator interface, memory interface, eval skeleton, SQL injection fix).
3. **Run `pnpm test:ci` and `pnpm build`** after each change.
4. **Create Prisma migration** for `AutonomyVerdict`/`AutonomyRule` + vector index.
5. **Backfill `AiMemory` → `AiMemoryEmbedding`** so semantic search is usable.
6. **Schedule Phase 0.9** (deprecate Redis-only `KeyCortexMemoryService`) for the following week.

---

## 13. Final Note

This plan deliberately avoids building more Body. The Body of KEYFLOWOS — CRM, commerce, bookings, finance, projects, connectors — is already large. The risk is not that the Body is too weak; it is that the Mind and Soul are not yet coherent enough to direct it. By focusing every engineering cycle on **one autonomy oracle, one memory layer, one reasoning loop, one value model, and one evolution engine**, KEYFLOWOS can become the autonomous business partner the vision demands.
