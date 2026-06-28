# KEYFLOWOS — Mind / Soul / Evolution Master Plan

**Subtitle:** From AI Co-Pilot to Autonomous Digital Employee  
**Scope:** Mind, Soul, and Evolution capabilities only. Body / tools / new connectors are explicitly out of scope.  
**Date:** 2026-06-26  
**Status:** Draft — ready for review and sequencing  

---

## 1. Vision & Definition of Done

### 1.1 The goal
KEYFLOWOS should feel like the best business partner and employee a user could hire:  
- It **remembers** the business like an institutional veteran.  
- It **reasons** across functions like a senior operator.  
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

## 3. Current State Baseline

### 3.1 What already exists
| Layer | Existing assets | Maturity |
|---|---|---|
| **Mind — Perception** | `key-inbox-*`, `temporal-flow`, connectors, event listeners | L2-L3 |
| **Mind — Reasoning** | `key-cortex-reasoning.service.ts`, `adaptive-router.service.ts`, `ModelGatewayService` | L3 |
| **Mind — Memory** | `CortexSession`, `KeyCortexMemoryService`, `AiMemory`, `GenomeMemoryEvent`, `CognitionMemory`, `TemporalFlowMemory` | L2 (fragmented) |
| **Mind — Planning** | `key-cortex-command.service.ts`, `key-cortex-executor.service.ts`, `key-autonomy` | L2 (reactive) |
| **Mind — Metacognition** | `trust-explanation.service.ts`, `outcome-learning.service.ts`, `genome-scoring.service.ts` | L3 |
| **Soul — Identity** | `BusinessBlueprint`, `BusinessGenome`, DNA sections, genome stage | L4 |
| **Soul — Values** | Rule-based guardrails, risk penalties, approval requirements | L2 |
| **Soul — Governance** | `BusinessConstitutionVersion`, `genome-autonomy-gate.service.ts`, `AuthorityGrant`, `AutopilotSettings` | L3-L4 |
| **Soul — Trust** | Audit trails, `trust-explanation.service.ts`, WebSocket presence | L3 |
| **Soul — Voice** | `key-cortex-personality.service.ts` personas, Blueprint brand voice | L2 |
| **Evolution** | `outcome-learning.service.ts`, `GenomeMemoryEvent`, `CognitionMemory` | L2 |

### 3.2 Critical blockers
1. `KeyCortexGenomeBridgeService.checkAutonomy()` is **stubbed** — Mind cannot consult Soul live.
2. **Five+ memory stores** with no unified retrieval layer.
3. **Multiple overlapping approval/autonomy services** (`AiOversightService`, `KeyCortexApprovalService`, `GenomeAutonomyGateService`, `KeyActionPolicyService`, `KeyActionGenomePolicyService`).
4. **Reactive planning only** — no long-horizon plan generation or simulation.
5. **No automated eval harness** for autonomy, explanation quality, or recommendation accuracy.
6. **Values are static** — no feedback-driven value refinement.
7. **No live knowledge ingestion** pipeline for best practices, science, or regulation.

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
1. **Perception unification** — build a `CognitiveEventBus` that turns every input (message, event, connector sync, user action) into a normalized signal with embeddings, provenance, and confidence.
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
**Goal:** Clean up the foundation so we can build without regressions.

**Deliverables:**
- [ ] Merge and validate all current Mind/Soul stubs (especially `KeyCortexGenomeBridgeService.checkAutonomy()`).
- [ ] Resolve duplicate approval/autonomy symbols.
- [ ] Complete import cleanup and package normalization.
- [ ] Establish baseline eval metrics for current recommendation/explanation quality.
- [ ] Lock Body scope: no new connectors or operational modules during this plan.

**Success metric:** All existing tests pass; zero known stubbed functions on the critical path.

---

### Phase 1 — Foundation: One Mind, One Soul (Weeks 5-14)
**Goal:** Create the central integration points: autonomy oracle and unified memory.

**Deliverables:**
| # | Deliverable | New / Modified Files | Owner |
|---|---|---|---|
| 1.1 | `AutonomyOrchestratorService` | `apps/server/src/modules/key-autonomy/autonomy-orchestrator.service.ts` | Platform |
| 1.2 | Unified autonomy schema & data model | Prisma: `AutonomyVerdict`, `AutonomyRule`, `AuthorityGrant` migration | Data |
| 1.3 | Refactor existing autonomy services to call orchestrator | `AiOversightService`, `GenomeAutonomyGateService`, `KeyActionPolicyService`, `KeyCortexApprovalService` | Platform |
| 1.4 | `UnifiedMemoryRetrievalService` | `apps/server/src/modules/key-cortex/unified-memory-retrieval.service.ts` | Mind |
| 1.5 | Memory indexing strategy | Add vector/embedding retrieval to `AiMemoryEmbedding` or introduce `MemoryFragment` model | Data |
| 1.6 | Complete Cortex↔Genome bridge | `KeyCortexGenomeBridgeService` | Mind+Soul |
| 1.7 | Mind/Soul contract documentation | `docs/KEY_MIND_SOUL_CONTRACT.md` | Product |

**Success metrics:**
- 100% of autonomous actions route through `AutonomyOrchestratorService`.
- Unified memory retrieval used by `key-cortex-reasoning.service.ts`.
- Zero contradictory autonomy verdicts in synthetic test suite.

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
- KEY can execute a 5-step plan (e.g., “follow up on overdue invoice → send reminder → schedule call → create task → update CRM”) with < 1 human escalation per 10 steps.
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
| Overlapping autonomy services cause inconsistent behavior | High | High | Phase 1 consolidation into `AutonomyOrchestratorService`. |
| Unified memory retrieval is slow or inaccurate | High | Medium | Start with simple ranking; add vector search incrementally; benchmark. |
| Users reject autonomous actions due to lack of trust | High | Medium | Invest heavily in trust explanations, confidence scores, and gradual authority grants. |
| Value learning drifts away from user intent | High | Low | Human-reviewed value dashboard; sandbox value updates; rollback. |
| Real-time knowledge ingestion introduces bad advice | Medium | Medium | Source allowlisting, confidence scoring, human curation of constitution amendments. |
| Phase scope creep into Body/tools | Medium | High | Explicit Body freeze; architecture review board; tie every PR to Mind/Soul/Evolution. |
| Regulatory / liability concerns | High | Medium | Compliance mapping in Phase 5; immutable audit logs; human escalation design. |
| Team burnout from too many parallel pillars | Medium | Medium | Sequential phases; one pillar lead per phase; clear milestones. |

---

## 10. Appendix: Existing Code → Plan Mapping

| Existing asset | Role in plan |
|---|---|
| `key-cortex-reasoning.service.ts` | Becomes the reasoning orchestrator; consumes unified memory and autonomy verdicts. |
| `adaptive-router.service.ts` | Remains the meta-controller; extended with confidence and safety signals. |
| `ModelGatewayService` / `AiUsageService` | Remains the LLM router; augmented with eval logging and prompt versioning. |
| `KeyCortexMemoryService` | Refactored into the memory storage backend; unified retrieval built on top. |
| `AiMemory` / `AiMemoryEmbedding` | Core semantic memory tables; enhance with memory fragment abstraction. |
| `GenomeMemoryEvent` / `CognitionMemory` / `TemporalFlowMemory` | Sources for unified retrieval and consolidation. |
| `BusinessBlueprint` / `BusinessGenome` | Identity kernel; auto-updating integrity and stage logic. |
| `BusinessConstitutionVersion` | Immutable governance document; amendment flow in Phase 3. |
| `genome-autonomy-gate.service.ts` | Refactored into `AutonomyOrchestratorService` rule provider. |
| `AiOversightService` / `KeyCortexApprovalService` / `KeyActionPolicyService` | Refactored to call orchestrator; duplicated logic removed. |
| `trust-explanation.service.ts` | Core trust surface; extended with confidence calibration. |
| `outcome-learning.service.ts` | Core learning loop; formalized into Evolution Engine. |
| `key-cortex-personality.service.ts` | Grounded in Blueprint values in Phase 3. |

---

## 11. Immediate Next Steps (This Week)

1. **Review and approve this plan.** Identify the three highest-priority deliverables for the next sprint.
2. **Create the `AutonomyOrchestratorService` interface** before implementation so all existing services can migrate toward it.
3. **Inventory every stub in the Mind/Soul path** and schedule fixes in Phase 0.
4. **Set up eval harness skeleton** (`EvalHarnessService`) now, even with basic tests, so every future PR can be measured.
5. **Communicate Body freeze** to the team: no new connectors, commerce features, or operational modules unless they are required to feed Mind/Soul/Evolution.

---

## 12. Final Note

This plan deliberately avoids building more Body. The Body of KEYFLOWOS — CRM, commerce, bookings, finance, projects, connectors — is already large. The risk is not that the Body is too weak; it is that the Mind and Soul are not yet coherent enough to direct it. By focusing every engineering cycle on **one autonomy oracle, one memory layer, one reasoning loop, one value model, and one evolution engine**, KEYFLOWOS can become the autonomous business partner the vision demands.
