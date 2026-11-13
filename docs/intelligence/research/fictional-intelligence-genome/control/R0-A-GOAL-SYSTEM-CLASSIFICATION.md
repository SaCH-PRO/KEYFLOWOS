# R0-A — Goal-System Classification

Status: RESEARCH_ONLY / CONTROL
Date: 2026-10-06

## Evidence
Current repository maps explicitly identify `AiGoal` and `BusinessGoal` as two disconnected goal systems. The Flow tool catalogue changes `aiGoal` for the goals surface. `KeyCortexPlannerService` owns the cognitive `AiGoal -> AiPlan -> AiPlanStep` path.

## Classification
| Concept | Current owner | Classification | Direction |
|---|---|---|---|
| KEY cognitive objective | AiGoal | CANONICAL_CANDIDATE | preserve |
| cognitive decomposition | AiPlan/AiPlanStep | SPECIALIZATION | preserve |
| BusinessGoal | separate model | DUPLICATE / UNRESOLVED | trace writers/readers before disposal |
| command intent | KeyCommand/CommandItem | RELATED_DISTINCT | preserve as execution-intent lineage |
| action decision | KeyActionProposal | CANONICAL_CANDIDATE | strengthen |
| ApprovalRequest | approvals module | LEGACY_COMPATIBILITY | shadow-migrates; define disposal |
| formal obligation | Contract* | RELATED_DISTINCT | preserve |

## Approval convergence evidence
`ApprovalRequestService` shadow-migrates pending requests to `KeyActionProposal`; baseline/system maps describe the orchestrator + proposal service as canonical direction.

## Disposal proof required
ApprovalRequest cannot be removed until:
1. all callers are enumerated;
2. multi-step approval semantics have equivalents;
3. historical read paths remain valid;
4. events/API consumers are migrated;
5. negative tests prove no bypass;
6. rollback plan exists.

## Decision
No Goal Graph schema work is admitted yet. First converge duplicate owners and add provenance as a semantic contract where possible.
