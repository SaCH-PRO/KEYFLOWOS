# KEY Intelligence Genome v0.1 — Bounded Candidate Routing

Status: RESEARCH_ONLY
Programme: KIGP-001
Rule: no candidate below is implementation-authorized by this document.

## C1 — KF-MEMORY-SEMANTIC-CONTRACT-001
Owner: existing PR #148 Context Genome programme
Disposition: ADOPT into existing planned work
Scope:
- Source/Observation/Claim/Entity/Relation/Event/Projection semantics;
- contradiction/challenge/supersession;
- provenance/freshness;
- compression as projection;
- unresolved alternatives.
No new store.

## C2 — KF-GOAL-COMMITMENT-TRUTH-AUDIT-001
Owner candidate: Context Genome + existing planner/command/approval/contract owners
Disposition: CANDIDATE READ-ONLY AUDIT
Scope:
inventory AiGoal/AiPlan/KeyCommand/CommandItem/KeyActionProposal/ApprovalRequest/Contract* writers/readers and identify the semantic owners of goals, commitments, decisions, exceptions and rationale.
No schema mutation.

## C3 — KF-CAPABILITY-OWNERSHIP-AUDIT-001
Owner candidate: current Flow/CapabilityContract/action-boundary owners
Disposition: CANDIDATE READ-ONLY AUDIT
Scope:
map every capability/tool/skill/agent registry, semantic identity, risk metadata, routing and execution use; classify canonical vs compatibility vs duplicate.
Goal: prevent another registry before Capability Fabric work.

## C4 — KF-AGENT-CLAIM-PROTOCOL-001
Owner: PR #149 parallel-worker programme
Disposition: ADOPT AS DESIGN EXTENSION, not runtime release
Candidate envelope:
Finding, Evidence[], Confidence, Assumptions[], Dependencies[], Contradictions[], SuggestedAction, Provenance.
Add disagreement/merge semantics and preserve serialized admission.

## C5 — KF-COGNITIVE-HEALTH-ADMISSION-AUDIT-001
Owner candidates: KeyCortexHomeostasis + autonomy/action boundary
Disposition: CANDIDATE READ-ONLY AUDIT
Question:
which health/degraded states should tighten action admission, and which existing paths already do so?
Do not wire broad safe mode before exact paths/invariants are mapped.

## C6 — KF-SAFE-MODE-CONTRACT-001
Owner: existing homeostasis + authority/action infrastructure if C5 converges
Disposition: DEFER UNTIL C5
Candidate invariant:
safe mode retains identity, authority checks, critical commitments, observability and deterministic low-risk functions while high-risk/experimental autonomy is disabled.

## C7 — KF-MEMORY-FRESHNESS-POLICY-001
Owner: PR #148 / UnifiedMemoryRetrievalService
Disposition: CANDIDATE
Question:
replace/augment global 30-day half-life and 90-day cutoff with domain/source-specific freshness where justified, while preserving old evidence and supersession semantics.
Requires measurements/evals before behavior change.

## C8 — KF-RND-LINEAGE-CONTRACT-001
Owner: PR #152 + R&D corpus
Disposition: ADOPT AS DOC/CONTROL CANDIDATE
Add optional machine-readable lineage:
research_source -> converged_primitive -> architecture_owner -> implementation_packet/PR -> proof -> live evidence.
No runtime effect.

## C9 — KF-IDENTITY-SELF-MODEL-OWNERSHIP-AUDIT-001
Owner: TBD after repo audit
Disposition: NEEDS_EVIDENCE
Map KEY identity across sessions, workers, models, devices/connectors, businesses, authority and memory. Decide whether a dedicated self-model contract is warranted without creating a new identity service prematurely.

## C10 — KF-INTERVENTION-REVERSIBILITY-CONTRACT-001
Owner candidate: existing action boundary
Disposition: DEFER UNTIL broader action-boundary adoption
Classify candidate actions by observe/recommend/ask/reversible/material/high-risk and preserve reversibility/compensation semantics.

## Ordering
Now / research-only parallel:
C1 (already planned under #148)
C2
C3
C4 design extension
C5
C8
C9

After those converge:
C7
C6
C10

## PR routing
- #148: C1, likely findings from C2/C7/C9 where they concern memory/world model.
- #149: C4.
- #152: C8.
- #155/current action-boundary lineage: evidence for C5/C10, but do not widen #155's bounded safety correction.
- #157: continuity/convergence should ingest the existence and status of KIGP v0.1, not merge all research branches or claim implementation.
