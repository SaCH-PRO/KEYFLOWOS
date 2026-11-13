# KIGP v0.1 — Four-Audit Convergence Result

Status: RESEARCH_ONLY
Programme: KIGP-001
Audit date: 2026-10-06

## Audits completed
- C2 Goal / Commitment / Decision Truth Audit
- C3 Capability Ownership Audit
- C5 Cognitive Health -> Action Admission Audit
- C9 KEY Identity / Self-Model Ownership Audit

## Existing owners to strengthen
- Cognitive goals/plans: KeyCortexPlannerService + AiGoal/AiPlan/AiPlanStep.
- Executable capability catalogue: FLOW_TOOLS.
- Capability semantic projection: CapabilityContractService.
- Cortex execution projection: KeyCortexToolRegistryService.
- Action governance: Capability -> Control -> Clearance -> ExecutionClaim -> OutcomeEvidence / KeyActionProposal.
- Memory retrieval/writing: UnifiedMemory*.
- Business epistemics: GenomeFact/GenomeEvidence + VerificationStatus.
- Homeostasis: KeyCortexHomeostasisService.
- Human/business authority: User/Business/Membership + autonomy/action-boundary layers.

## Genuine gaps
1. Goal provenance / commitment / decision lineage across existing state machines.
2. AiGoal vs BusinessGoal duplication.
3. ApprovalRequest migration/disposal clarity.
4. KeyToolRegistryService duplicate/fallback path.
5. hard coupling between relevant degraded health and action admission.
6. canonical SAFE_MODE contract.
7. canonical KEY self-model projection.
8. terminology separation between business self-model and KEY self-model.

## Do not build
- no GoalV2 table;
- no CapabilityRegistryV2;
- no HomeostasisV2;
- no separate Identity database;
- no universal brain service.

## First evidence-backed implementation DAG

### Wave R0 — documentation/control only, parallel-safe
- R0-A: C2 goal-system classification.
- R0-B: C3 exact capability-registry equivalence inventory.
- R0-C: C5 health-signal-to-action-surface matrix.
- R0-D: C9 self-model source-of-truth matrix.
- R0-E: C8 R&D-lineage metadata proposal for PR #152.

### Wave R1 — bounded contract changes after R0
- R1-A: Goal provenance contract on existing owners, only if R0 proves missing fields cannot be projected.
- R1-B: KeyCommand/KeyToolRegistry fallback disposal or explicit compatibility boundary.
- R1-C: health-to-control pure decision contract, no direct effects.
- R1-D: KEY self-model read projection over existing owners.
- R1-E: PR #149 structured agent claim envelope.

### Wave R2 — behavioral adoption
- R2-A: apply health-to-control contract to one bounded action capability.
- R2-B: domain-specific memory freshness experiment/eval under #148.
- R2-C: one goal/commitment lineage journey end-to-end.
- R2-D: one structured disagreement/merge journey in parallel-worker programme.

### Wave R3 — generalization only after proof
- broader action-boundary adoption;
- SAFE_MODE composition;
- capability-registry consolidation;
- wider commitment semantics;
- runtime R&D/meta-learning.

## No-fake-green exit criteria
Each Wave R1/R2 change must prove semantic owner, reachable path, negative control, authority behavior, persistence/effect lineage, retry/recovery behavior where applicable, and disposal of superseded paths.
