# R1-A — Goal Provenance / Goal-System Convergence Packet

Status: READY_FOR_IMPLEMENTATION_REVIEW
Programme: KIGP-001
Owner candidates: KeyCortexPlannerService / GoalTrackerService / KeyActionProposal governance
Prerequisite: R0-A complete

## Objective
Converge the disconnected `AiGoal` and `BusinessGoal` semantics without creating GoalV2, while making goal provenance explicit enough to trace why KEY is pursuing a goal and who/what authorized it.

## Current facts
- `AiGoal` is the live cognitive-goal owner used by KeyCortexPlannerService and the goals surface.
- `BusinessGoal` is independently owned by GoalTrackerService and consumed by project planning.
- repository architecture docs explicitly call these disconnected duplicate goal systems.
- KeyCommand/CommandItem and KeyActionProposal are related but distinct execution/decision state.

## Required implementation work
1. Trace every writer/reader of `AiGoal` and `BusinessGoal`.
2. Classify each semantic field and use case:
   SAME / SPECIALIZATION / RELATED_DISTINCT / HISTORICAL.
3. Produce one canonical end-state decision:
   - merge BusinessGoal behavior into AiGoal; OR
   - retain BusinessGoal only if a genuinely different domain meaning survives.
4. Define a `GoalProvenance` contract as a projection first:
   - goalId
   - sourceType: user | command | automation | agent | import | derived
   - sourceId/correlationId
   - principal/authority reference where applicable
   - createdAt
   - constraints
   - parent goal
   - status
   - expiry/target date
5. Do not add database columns unless the projection cannot be reconstructed safely from current lineage.
6. Define migration/disposal proof for whichever goal model loses canonical status.

## Hard invariants
- user/authority provenance is not inferred from text alone.
- goal status cannot erase source lineage.
- deleting/superseding a goal must not destroy required historical evidence.
- no cross-tenant parent/goal relation.
- command/proposal approval does not retroactively authorize the originating goal.

## Tests required
- writer/reader inventory snapshot test or generated architecture assertion;
- cross-tenant negative test;
- source lineage survives plan creation;
- supersession/cancel path preserves historical trace;
- surviving UI and project-planner journeys use the canonical owner;
- no dead duplicate writer remains.

## Exit condition
One canonical cognitive/business-goal contract is proven, or a documented two-owner model survives with a crisp semantic boundary. No hidden duplicate state machine.
