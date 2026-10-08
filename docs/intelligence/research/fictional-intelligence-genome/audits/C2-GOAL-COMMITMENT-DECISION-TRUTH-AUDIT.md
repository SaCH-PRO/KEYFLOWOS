# C2 — Goal / Commitment / Decision Truth Audit

Status: RESEARCH_ONLY
Programme: KIGP-001
Audit date: 2026-10-06

## Question
Where do goals, plans, commands, approvals, proposals, contracts and commitments actually live today, and is there one semantic owner?

## Observed repository reality

### Goal / plan owner
- `KeyCortexPlannerService` is the live owner for `AiGoal -> AiPlan -> AiPlanStep`.
- `AiGoal` and `AiPlan` are tenant-scoped and covered by tenant enforcement.
- The planner decomposes high-level goals, persists plans, performs heuristic simulation, and can append recovery steps after failed plan steps.
- Existing repository documentation records a duplicate goal system: `AiGoal` and `BusinessGoal` are disconnected.

### Command / intent owner
- `KeyCommandService` owns a separate `KeyCommand` lifecycle: receive -> interpret -> ground -> plan -> classify risk -> execute approved plan.
- `CommandItem` and related command state belong to the operating-kernel/AI command path, not to `AiGoal` semantics.

### Decision / approval owner
- `KeyActionProposal` is the canonical action proposal / approval record in the current governance direction.
- `ApprovalRequestService` still exists as a multi-step approval system and is shadow-migrating toward `KeyActionProposal`.
- The action-boundary implementation enriches `KeyActionProposal` with capability identity, frozen envelope/fingerprint, control requirement/evidence, principal chain and outcome evidence for bounded capabilities.

### Contract / commitment owner
- `Contract`, `ContractParty`, `ContractTerm`, `ContractVersion` and `ContractAlert` exist under Governance & Compliance.
- This audit did not establish a single general-purpose commitment owner spanning conversational promises, operational obligations, negotiated agreements and contract obligations.

## Findings

### C2-F1 — no single goal/commitment/decision graph exists
The repository has several semantically adjacent state machines:
- `AiGoal/AiPlan/AiPlanStep`;
- `BusinessGoal`;
- `KeyCommand/CommandItem`;
- `KeyActionProposal`;
- `ApprovalRequest` and legacy approval models;
- `Contract*` models.

Disposition: TRUE GAP / CONVERGENCE NEEDED, but NOT evidence for a new generic table.

### C2-F2 — AiGoal is the strongest current cognitive-goal owner
Disposition: ADOPT EXISTING OWNER for cognitive planning.

### C2-F3 — BusinessGoal duplication must be resolved before Goal Graph work
Disposition: DUPLICATE_RISK. Do not add GoalV2 or another goal table.

### C2-F4 — action decisions are converging on KeyActionProposal
Disposition: ADOPT EXISTING OWNER for action-decision / approval lineage where applicable.

### C2-F5 — ApprovalRequest remains compatibility/legacy risk
Disposition: RELATED DISTINCT / MIGRATION LIABILITY. Need explicit end-state decision, not silent parallel permanence.

### C2-F6 — durable commitments remain semantically unresolved
Disposition: NEEDS_EVIDENCE before allocating a Commitment model.

## Candidate semantic lineage

INTENT / REQUEST
  -> GOAL (AiGoal when cognitive)
  -> PLAN (AiPlan/AiPlanStep)
  -> COMMAND / PROPOSAL where execution is requested
  -> CONTROL / CLEARANCE
  -> EFFECT / OUTCOME
  -> DECISION / EVIDENCE

Formal commercial/legal obligations remain Contract*.
Potential lightweight commitments should first be represented as a semantic contract over existing Task/Command/Contract/Event entities before schema allocation.

## Recommended next steps
1. Trace AiGoal vs BusinessGoal writers/readers and classify SAME / SPECIALIZATION / RELATED DISTINCT.
2. Trace ApprovalRequest -> KeyActionProposal shadow migration and define disposal criteria.
3. Define a minimal Goal Provenance contract using existing AiGoal fields + evidence/authority links before adding columns.
4. Test whether operational commitments can be represented by Task/Command/Contract/TemporalFlow/Event lineage.
5. Keep decision rationale as an artifact/contract first; do not expose private chain-of-thought.
