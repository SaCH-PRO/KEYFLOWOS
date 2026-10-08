# KEY Intelligence Genome v0.1 — Repository Pressure Test

Status: RESEARCH_ONLY
Programme: KIGP-001
Repository reality sampled: current default branch visible 2026-10-06
Purpose: compare converged organs against live code/docs and identify ALREADY_PRESENT, PARTIAL, MISSING, DUPLICATE_RISK and CONTRADICTION.

## O1 Context / Epistemic Genome — PARTIAL, strong existing owners
Evidence:
- UnifiedMemoryWriterService is the canonical structured-memory writer.
- UnifiedMemoryRetrievalService normalizes AiMemory, GenomeMemoryEvent, TemporalFlowMemory and CognitionMemory, and applies recency/relevance/source weighting.
- Business Genome VerificationStatus already includes INFERRED, USER_VERIFIED, UNVERIFIED_IMPORTED, STALE and DISPUTED.
- GenomeEvidence and generic Evidence already exist.

Pressure-test result:
Do NOT create a second memory/world-graph store.
Gaps to test through PR #148's planned truth audit/semantic contract:
- challenge/supersession lineage instead of destructive replacement;
- source/channel independence and corroboration;
- contradiction as first-class state;
- per-domain freshness rather than one global recency heuristic;
- commitment/decision/exception semantics;
- compression-loss accounting.

## O2 Identity / Self Model — PARTIAL / NEEDS_EVIDENCE
Existing identity, tenant, authority, session and worker concepts exist, but no single proven canonical KEY self-model was established in this pressure test.

Ruling:
Do not allocate a new Identity service yet.
Run a read-only identity/self-model ownership audit across user/business identity, Cortex sessions, workers, devices/connectors and agent-control identities.

## O3 Goal / Commitment / Decision Graph — PARTIAL
Evidence:
- AiGoal/AiPlan exist.
- KeyCortexPlannerService creates goals/plans, decomposes goals, simulates simple risk/complexity and replans after failed steps.
- Approval/action/contract entities exist elsewhere.

Gaps:
- goal provenance/authority/conflict/expiry semantics not proven canonical;
- durable commitment semantics not proven;
- decision rationale/precedent/exception lineage not proven.

Ruling:
Audit existing goal/command/approval/contract seams before schema work.

## O4 Cognitive Fabric — PARTIAL, substantial runtime exists
Evidence:
- KeyCortexPlannerService performs decomposition, simple simulation and replanning.
- Unified retrieval feeds reasoning paths.
- EvalHarnessService references autonomy, constitution, memory and planner.
- current Cortex contains reasoning/reflection/intuition/homeostasis-related components.

Gaps:
- model-class-aware uncertainty and explicit hypothesis lifecycle are not proven as canonical contracts;
- current planner simulation is heuristic, not a general causal simulator;
- contradiction-driven model revision is not proven.

Ruling:
Strengthen contracts/evals before adding another brain service.

## O5 Social / Relationship Intelligence — PARTIAL / DUPLICATE_RISK
Existing contacts, CRM, business entities, user context and emotion/personality services exist. No universal Relationship Graph ownership is proven.

Ruling:
Treat relationship semantics as a Context Genome pressure-test dimension, not a new graph/table by default.

## O6 Capability Fabric — PARTIAL, real semantic foothold exists
Evidence:
- CapabilityContract identity is consumed by the current action boundary.
- Flow tools and other registries exist; repository docs already acknowledge multiple registries and ongoing consolidation.
- current action boundary denies unknown capabilities.

Gaps:
- one canonical semantic capability lineage across tools/skills/agents/connectors is not proven;
- compatibility, derivation, synthesis, genealogy and runtime health are not canonical.

Ruling:
High duplicate risk. Inventory/ownership audit first; do not create another registry.

## O7 Constitutional Authority / Governance — STRONG PARTIAL
Evidence:
- current Capability -> Control -> Clearance path explicitly separates ControlRequirement, ControlEvidence and Clearance.
- clearance is recomputed on locked/fresh rows inside the claim transaction.
- unknown capabilities and untrusted tenant surfaces fail closed.
- KEY autonomy is explicitly not treated as a substitute for human authority.
- ConstitutionValuesService exists, but is intentionally lightweight keyword/score matching.

Gaps:
- action-boundary adoption is currently bounded rather than universal;
- ConstitutionValuesService is not a full plural-value/legal/institutional reasoning system;
- non-transitive delegation and authority-conflict semantics require pressure testing.

Ruling:
Extend existing authority owners. Do not build parallel governance.

## O8 Action / Effect / Intervention — PARTIAL, strong execution-boundary foundation
Evidence:
- current action boundary uses frozen envelopes/fingerprints, server-issued evidence, clearance and outcome evidence.
- saga/idempotency/effect-certainty work exists elsewhere in the programme.

Gaps:
- intervention ladder and reversibility classification are not proven general contracts;
- not all tools run through the new boundary.

Ruling:
Route candidate laws through the existing action-boundary rollout.

## O9 Learning / R&D / Meta-Learning — PARTIAL
Evidence:
- Genome experiments, ToolOutcomeScore and learning structures exist.
- current R&D corpus provides a manual/agent-assisted hypothesis-convergence pipeline.

Gaps:
- no proof yet that runtime KEY has one canonical hypothesis/experiment/belief-revision loop;
- autonomous meta-learning boundaries are not proven.

Ruling:
First encode the R&D lineage into existing development/research control; runtime autonomy comes later.

## O10 Multi-Agent / Collective Cognition — PLANNED / PARTIAL
Evidence:
- agent-control worker and durable issue-80 control-plane exist.
- PR #149 is an open draft plan for packet-owned parallel workers with claims/conflict detection and serialized admission.

Gaps:
- structured claim exchange, disagreement protocol and evidence-weighted merge are not implemented as a proven general runtime.

Ruling:
Extend PR #149 design rather than spawning a new multi-agent framework in the current stack.

## O11 Attention / Cognitive Resource Manager — PARTIAL / NEEDS_EVIDENCE
Existing proactive, reflection, circadian, endocrine and routing mechanisms suggest pieces of attention/resource control. No single canonical attention budget contract was proven in this pass.

Ruling:
Characterize current routing/proactive/interruption behavior before creating a resource-manager service.

## O12 Homeostasis / Resilience / Recovery — STRONG PARTIAL
Evidence:
- KeyCortexHomeostasisService exists and measures execution integrity, response latency and body integrity on a 30-minute loop.
- it intentionally affects deliberation/caution rather than directly acting on business state.
- measurement failure is treated as unmeasurable rather than bad.

Gaps:
- health state is not yet proven to gate autonomy/action admission;
- explicit SAFE_MODE/circuit-breaker/recovery-before-resumption contract is not proven;
- model/provider failover equivalence/privacy semantics need dedicated validation.

Ruling:
This is an existing semantic owner candidate. Extend carefully; do not create another homeostasis system.

## Current PR mapping
- PR #148: O1 primary; pressure-test O2/O3/O5 memory/world-model semantics.
- PR #149: O10 primary; future bounded specialist lifecycle and structured claim exchange.
- PR #152: cross-cutting R&D lineage/value/unlock/proof metadata candidate.
- PR #155: O7 concrete fail-closed authority correction; does not by itself universalize the action boundary.
- PR #157: cross-stream continuity/convergence owner; should reference KIGP as research input, not convert it directly into canonical runtime.
- Connector Fabric stream: O8 external embodiment/effects.
- Business Genome: O1/O3 institutional knowledge/evidence pattern.
- issue #80/control plane: development-side O7/O10 authority/admission pattern.

## Highest-confidence genuine gaps
1. explicit contradiction/challenge/supersession semantics across memory/claims;
2. structured goal/commitment/decision provenance across existing seams;
3. safe-mode/degraded-autonomy contract tied to existing homeostasis/authority;
4. structured multi-agent claim/disagreement/merge protocol;
5. per-domain freshness and memory-lifecycle policy;
6. repository-visible R&D -> primitive -> PR -> proof lineage.

## Highest duplicate-risk candidates
1. new memory/world graph;
2. new tool/capability registry;
3. new policy/authority engine;
4. new multi-agent runtime;
5. new homeostasis service;
6. new universal relationship graph.

## Contradictions surfaced
- KIGP wants lineage-preserving belief revision, while current Context Genome planning already notes destructive memory consolidation as a gap; this is a convergence point, not a new subsystem.
- KIGP wants degraded cognition to reduce autonomy; current homeostasis adjusts caution/deliberation, but this pressure test did not prove a hard coupling to action admission.
- KIGP wants one semantic capability fabric; repository reality contains multiple registries, so adding another would worsen the problem.
- KIGP wants plural-value reasoning; current ConstitutionValuesService explicitly describes itself as lightweight keyword/score matching, so naming it "constitution" must not be mistaken for full value reasoning.
