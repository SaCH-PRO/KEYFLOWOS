# R1-A — Goal System Exact Convergence Matrix

Status: CHARACTERIZED / IMPLEMENTATION_DECISION_REQUIRED
Programme: KIGP-001
Source packet: R1-A-GOAL-PROVENANCE-CONVERGENCE-PACKET.md

## Repository truth

The repository has two live goal owners.

| Concern | AiGoal / KeyCortexPlannerService | BusinessGoal / GoalTrackerService | Classification |
|---|---|---|---|
| tenant | businessId | businessId | SAME |
| title | title | title | SAME |
| description | description | description | SAME |
| ordering | priority | priority | SAME |
| target time | targetDate | deadline | IMPLEMENTATION_ALIAS |
| lifecycle | status | status | SAME concept, vocabulary audit required |
| hierarchy | parentGoalId | absent | AiGoal SPECIALIZATION |
| plans | AiPlan relation | absent | AiGoal SPECIALIZATION |
| quantitative target | absent | targetValue + unit + currentValue | BusinessGoal SPECIALIZATION |
| category | absent | category | BusinessGoal SPECIALIZATION |
| role | absent | role | BusinessGoal SPECIALIZATION |
| auto-actions | absent | autoActions + actions | BusinessGoal SPECIALIZATION |
| progress computation | absent | revenue/leads/retention progress | BusinessGoal SPECIALIZATION |
| action suggestions | plan generation | heuristic GoalAction suggestions | RELATED_DISTINCT behavior |
| create owner | KeyCortexPlannerService | GoalTrackerService | DUPLICATE OWNER |
| direct consumer | goals surface / tools / triggers / query pipeline | AI controller / project planner | SPLIT JOURNEY |

## Writer/read inventory

### AiGoal
Writers:
- KeyCortexPlannerService.createGoal
- KeyCortexPlannerService.deleteGoal
- trigger/query/tool paths delegate into the planner.

Readers:
- KeyCortexPlannerService.listGoals/getGoal/createPlanFromGoal/deleteGoal
- goals controller and canonical FLOW_TOOLS goal handlers through the planner.

### BusinessGoal
Writers:
- GoalTrackerService.createGoal/updateGoal/deleteGoal/updateProgress/suggestActions.

Readers:
- GoalTrackerService get/list/active-with-actions.
- AI controller exposes GoalTrackerService.
- ProjectPlannerService directly reads active BusinessGoal rows.

## Important defect found during convergence characterization

GoalTrackerService scopes the initial BusinessGoal read in updateProgress, but subsequent singular updates use only goalId. suggestActions also performs a singular update using only goalId. These paths require a tenancy proof/fix before BusinessGoal semantics can be migrated or retained.

This is not evidence that AiGoal is automatically safe or complete; it is a concrete blocker to treating BusinessGoal as a canonical owner.

## Convergence decision

Do not create GoalV2.

Preferred end-state:
1. AiGoal remains the canonical identity/lifecycle/planning owner because the live goals surface and canonical goals tools already route through KeyCortexPlannerService.
2. Preserve BusinessGoal's unique quantitative-progress semantics by migrating them into a bounded extension/projection attached to canonical goal identity, rather than keeping a second independent goal identity.
3. ProjectPlannerService must consume the canonical goal projection after migration.
4. GoalTrackerService should become either:
   - a progress/projection service over canonical goals, or
   - be retired after its unique calculation/action behavior is relocated.
5. BusinessGoal storage can only be retired after data migration/backfill, read/write cutover, and rollback evidence.

## Provenance contract

Before persistence changes, introduce a read/write contract around canonical goal creation:
- sourceType: user | command | automation | agent | import | derived
- sourceId/correlationId where present
- principal/user where present
- parentGoalId
- createdAt
- targetDate
- status
- constraints/metadata where authoritative

A derived goal must never silently inherit authority from the agent that proposed it.

## Migration proof obligations

- inventory every production BusinessGoal row before destructive migration;
- deterministic mapping to canonical goal identity;
- quantitative progress fields preserved;
- active ProjectPlanner behavior preserved;
- no duplicate create path after cutover;
- cross-tenant negative tests on every migrated mutation;
- rollback or reversible migration until post-merge verification;
- old model cannot be called canonical until all live writers are gone.

## Implementation order

A1. Fix/characterize BusinessGoal tenant-scoping defects.
A2. Add canonical goal projection/provenance contract without schema proliferation.
A3. Adapt project planner and progress calculation to the canonical identity.
A4. Backfill/migrate unique BusinessGoal state.
A5. Remove duplicate writer/API path.
A6. Retire BusinessGoal only after exact-head + runtime proof.
