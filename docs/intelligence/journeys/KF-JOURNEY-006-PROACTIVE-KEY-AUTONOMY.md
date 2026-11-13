# KF-JOURNEY-006 — Proactive KEY / Autonomy

Status: **SCOPING / ACTIVE STRESS TEST**

Implementation evidence baseline: `main@d7c5b86cfa276d75ffa42d5f1707c43704dc9f21`

Production implementation remains unauthorized.

J6 is admitted because J15 has reached L4 semantic reconciliation. J6 exists to challenge—not silently redefine—the current K2/K3/K5/K7/K8/K11 architecture.

Active backward edges:

```text
J6
↔ J15 Approval / Governance
↔ J2 Governed Action
↔ J25 Human Authority
↔ J1 Business Birth
```

---

## A. Definition

J6 models business actions that KEY/system machinery initiates **without a fresh human command for that exact action**.

It includes:

- standing delegation/autonomy;
- scheduled/background business agency;
- event-triggered proactive work;
- recommendations/tasks that may later become execution;
- autonomous external communication or mutation;
- learning that changes future autonomy behavior.

It excludes ordinary infrastructure maintenance merely because it runs on a scheduler.

Core distinction:

```text
BACKGROUND SYSTEM AUTOMATION
!=
PROACTIVE BUSINESS AGENCY
```

---

## B. Product Intent

Historical product intent is an Observe → Plan → Create → Act → Learn AI operating loop.

Target J6 product behavior:

```text
KEY notices something important
→ knows why it matters
→ knows what capability could improve the state
→ knows whether it has standing authority
→ applies proportionate control
→ acts once when cleared
→ observes the real outcome
→ learns without silently increasing its own authority
```

The user should feel that KEY is proactive, useful and low-friction while remaining explainable, stoppable and bounded.

---

## C. Actors / Origins

Working origin classes:

- `DIRECT_HUMAN` — fresh command; primarily J2, useful comparison baseline;
- `SCHEDULED_DELEGATION` — enabled recurring loop;
- `EVENT_TRIGGERED` — business event causes proactive consideration;
- `KEY_RECOMMENDATION` — intelligence creates a proposed next action;
- `POLICY_AUTOMATION` — deterministic standing automation;
- `SYSTEM_MAINTENANCE` — excluded unless it creates business-agency effects.

Proactive lineage must identify:

```text
standing authority source
configuredBy / delegatedBy
observed trigger
proposedBy KEY/system
executedFor business/principal
claimantExecutor
executedBy
```

`actor = system` alone is insufficient.

---

## D. Initial Entry-Surface Inventory

### DelegationLoopService

Five current loop definitions:

- payment_recovery — Tier 2;
- lead_reactivation — Tier 2;
- post_purchase — Tier 1;
- booking_prep — Tier 1;
- weekly_hygiene — Tier 1.

Scheduler checks due loops every 5 minutes.

### AutopilotController

Mounted under:

`autopilot/businesses/:businessId`

Class guards:

```text
AuthGuard + BusinessGuard
```

Surface includes:

- task create/status/approve/deny;
- action draft/execute;
- Autopilot settings;
- loop list/update/manual run;
- natural-language `key/interpret`, `key/build`, `key/execute`, `key/talk`.

### Key Cortex monitor v2

Can create, update, enable/disable and inspect DelegationLoops. It persists loop configuration directly or delegates to DelegationLoopService.

### Additional proactive surface still to map

- morning/evening briefings;
- proactive Cortex priorities/monitors;
- event listeners producing suggestions/actions;
- momentum sweeps;
- finance/commerce intelligence jobs that create business work;
- connector/reconciliation-triggered business agency;
- temporal long-running proactive flows.

---

## E. Initial Current-State Machine

Current Autopilot semantics are not one coherent state machine yet.

Observed concepts include:

```text
DelegationLoop
  disabled / enabled
  nextRunAt

DelegationLoopRun
  running / completed / failed

AutopilotTask
  PENDING
  IN_PROGRESS
  AWAITING_APPROVAL
  COMPLETED
  AUTO_EXECUTED
  SKIPPED
```

But those task states mix:

- recommendation/work item;
- approval state;
- execution state;
- claimed outcome.

Target J6 must separate:

```text
OBSERVATION
→ ACTION_CANDIDATE
→ GOVERNANCE
→ CONTROL/APPROVAL
→ CLEARANCE
→ EXECUTION CLAIM
→ REAL EFFECT
→ OUTCOME EVIDENCE
→ LEARNING
```

---

## F. Frontend Path

To be mapped after backend agency producers are classified.

Required questions:

- how user enables/disables Autopilot/loops;
- whether enabling communicates standing authority being granted;
- whether pause/kill controls cover every proactive path;
- what tasks are recommendations vs actions already taken;
- whether UI claims success where only a task/timeline record exists;
- whether user can inspect why KEY acted and under which policy/delegation.

---

## G. API Path — Initial Findings

`AutopilotController` is protected only by Business access in the inspected controller.

No `ModuleScopeGuard` / capability-level control was observed on task authority, settings, loop enablement or KEY delegation builder/executor routes.

This is a J6-specific extension of the control-plane problem already seen in J15.

---

## H. Backend Chain — DelegationLoop

Current scheduled loop chain:

```text
every 5 min
→ find enabled loop with nextRunAt <= now
→ create DelegationLoopRun(running)
→ governance.evaluate(businessId, `delegation_${loopType}`)
→ blocked
   OR create AiApprovalItem for formal/admin approval
   OR run loop body with requiresQuickConfirm boolean
→ domain/task/email effects
→ mark DelegationLoopRun completed
→ update loop stats/nextRunAt
→ execution log
→ memory pattern write
→ adaptGovernanceFromHistory()
```

Important: governance is evaluated once against the aggregate **loop tool identity**, while the loop body may produce multiple materially different child actions across distinct entities.

---

## I. Data Mutation Ledger — Initial

Observed DelegationLoop side effects include:

### payment_recovery

- Invoice `SENT -> OVERDUE`;
- AutopilotTask create/update;
- CRM timeline evidence;
- external email via TransactionalEmailService for some no-confirm cases;
- execution logs/events/memory.

### lead_reactivation

- Contact lifecycleStage -> `STALE`;
- AutopilotTask create;
- CRM timeline/event.

### post_purchase / booking_prep / weekly_hygiene

Initial evidence shows substantial task/recommendation creation. Full real-side-effect consumer proof remains open.

---

## J. Tenant / Identity

Business scoping is generally explicit through `businessId` in current Autopilot records.

J6's harder identity question is principal lineage:

```text
Who granted standing authority for this proactive action?
Who does KEY execute for?
What human authority/policy version created that delegation?
```

Current run logs commonly use `actor: system`, which is not enough to reconstruct delegation provenance.

---

## K. Events / Coordination

DelegationLoop emits:

- `delegation_loop.started`;
- `delegation_loop.blocked`;
- `delegation_loop.approval_required`;
- `delegation_loop.completed`;
- `delegation_loop.failed`;
- `autopilot.task.created`;
- `autopilot.task.auto_executed`;
- domain events such as `invoice.overdue`, contact lifecycle changes.

J7/K8 question:

Do event names reflect an actual real-world effect, or only a local record/state claim?

---

## L. KEY / AI

J6 directly stresses F084 / KF-REC-032:

DelegationLoop adaptation can raise `maxAutoTier` from historical approval rates.

Target law:

```text
learning signal
→ recommendation/confidence
!=
standing authority grant
```

Automatic tightening may be allowed where intentionally designed. Expansion of standing authority should require an independently authorized transition.

---

## M. Capability Mapping

Delegation loops have Flow-tool identities such as:

```text
delegation_payment_recovery
...
```

Current issue:

One aggregate loop capability can contain distinct material child capabilities:

```text
mark invoice overdue
send payment reminder
create recovery task
change contact lifecycle stage
create follow-up task
...
```

J6 target question:

> Is approval/standing authority granted to the loop as a bounded composite capability, or must each child become its own ActionEnvelope/clearance?

Likely answer is hierarchical/bounded clearance analogous to J15 plans:

```text
standing delegation/loop clearance
→ permits only child actions inside explicit capability/parameter/resource bounds
→ each concrete child still gets exact identity and execution claim
```

---

## N. Authority / Governance

J6 consumes two independent axes:

```text
human grantable authority
+
standing KEY autonomy/delegation
```

A proactive origin should generally be stricter than an equivalent explicit human direct command because there is no fresh user intent for the exact action.

Current control planes include:

- Business `autopilotEnabled` / metadata settings;
- DelegationLoop enabled/config;
- AiOversight AutopilotSettings;
- BusinessAutonomyProfile;
- AuthorityGrant;
- JobRole/KEY-role ceilings;
- learned adaptation.

Their precedence is not yet canonical.

---

## O. Knowledge / Genome / Readiness

J6 must prove that proactive actions only use sufficiently trusted/current business state.

Example questions:

- Is an invoice really overdue or merely locally stale?
- Is contact communication permitted now?
- Has external provider state changed?
- Is a recommended action based on canonical knowledge or heuristic memory?

Readiness cannot stand in for authority and vice versa.

---

## P. Initial J6 Invariants

1. A proactive business effect has explicit origin and standing-authority provenance.
2. Enabling a recurring autonomous loop is a control-plane authority transition.
3. A loop/plan may provide bounded parent authority but does not erase exact child-action identity.
4. Every material child action has one canonical CapabilityContract/ActionEnvelope.
5. Governance applies to the real action, not only an aggregate scheduler label.
6. Required human control gates the material action before its side effect.
7. Approval evidence is not outcome evidence.
8. Task completion/executed state cannot be asserted before the real business effect is proven.
9. External side effects produce durable outcome evidence/reconciliation.
10. Proactive execution obtains atomic ExecutionClaim before side effects.
11. Pause/kill/revocation reaches all dependent unconsumed proactive authority.
12. Learned history may recommend expanded autonomy but cannot silently self-grant it.
13. Business/contact communication policy is evaluated at send time.
14. Background infrastructure work is not confused with KEY business agency.

---

## Q. Initial Failure Matrix

- loop enabled by insufficiently authorized member;
- aggregate loop governance hides higher-impact child;
- quick-confirm required but child mutation occurs before confirmation;
- task marked approved/completed without real effect;
- action recorded as sent/executed without provider call;
- duplicate scheduler workers run same loop;
- same concrete child acted twice across sweeps;
- loop policy changed while deferred task retains old semantics;
- business pauses Autopilot but another proactive path continues;
- provider send succeeds but local record fails;
- local record claims success but provider never called;
- stale business knowledge triggers proactive action;
- approval history expands autonomy without human grant;
- cost/spend estimate omitted or zero at safety boundary;
- contact communication occurs outside allowed window/consent policy;
- external event retry creates duplicate proactive action.

---

## R. Idempotency / Transactions / Concurrency

Initial favorable behavior:

Payment recovery uses:

- milestone-level task dedupe;
- provider email `dedupeKey`;
- send-time contact-window recheck.

But J6 still lacks proof of a universal ExecutionClaim around proactive child actions.

Scheduler process-local maps/intervals are not a distributed execution claim.

---

## S. Security / Privacy

J6 inherits current standards floor:

- least privilege;
- complete mediation;
- proportional human control for high-impact actions;
- replay/idempotency safety;
- communication consent and quiet-hour enforcement;
- explicit authorization for standing automation/control-plane changes.

Proactive origin should be a first-class control input.

---

## T. Observability / Evidence

Target proactive trace:

```text
trigger observation/event
→ why KEY considered action
→ standing authority/delegation source
→ exact capability + ActionEnvelope
→ control decision
→ ControlEvidence / parent coverage
→ Clearance
→ ExecutionClaim
→ provider/domain result
→ reconciliation/outcome
→ learning signal
```

---

## U. Proof / Tests

No current test is treated as passing unless actually executed.

Future J6 proof must include:

- two scheduler workers racing the same due loop;
- pause/revoke between scan and send;
- communication window closes between task creation and send;
- duplicate provider/email attempt;
- approval required then task resumed;
- approval does not mark outcome before effect;
- provider timeout / outcome unknown;
- action caps/spend caps enforced with actual estimated impact;
- learning cannot expand standing authority without authorized transition;
- child action outside parent loop bounds is blocked/re-approved.

---

## V. Reachability

Initial:

- DelegationLoop scheduler: runtime-reachable on module initialization;
- AutopilotController: mounted API surface under AuthGuard+BusinessGuard;
- payment recovery direct external email: reachable when loop enabled + governance permits + invoice/contact conditions match;
- Key Cortex monitor/adapter: current integration surface into DelegationLoop;
- `autoExecutable` consumer: **SEARCH-SCOPED NOT FOUND** in production code so far; field is written in several places.

---

## W. Duplication

Potential overlapping proactive control planes:

- Business autopilot metadata;
- DelegationLoop enabled/config;
- AiOversight AutopilotSettings;
- BusinessAutonomyProfile;
- AuthorityGrant;
- Cortex monitor enablement;
- AutopilotTask flags;
- learned governance adaptation.

J6 must determine ownership/precedence rather than merge them reflexively.

---

## X. Architecture Alignment

Current J15 target stack remains the hypothesis J6 must stress:

```text
Trigger/Observation
→ CapabilityContract
→ ActionEnvelope
→ Effective Human Authority + standing KEY autonomy/delegation
→ readiness/policy
→ ControlRequirement
→ ControlEvidence / bounded parent coverage
→ Clearance
→ ExecutionClaim
→ ActionDispatcher/domain/provider
→ OutcomeEvidence
→ learning
```

---

## Y. Contradictions — Initial

Candidate contradictions from first J6 slice:

- standing loop-level governance vs heterogeneous child actions;
- approval/task status vs real business effect;
- Autopilot execution API naming vs timeline-only behavior;
- broad Business access vs standing automation authority mutation;
- `autoExecutable` semantic promise vs absent runtime consumer;
- loop descriptions promising sends vs task-only behavior for some loops.

These require evidence consolidation before assigning canonical contradiction IDs.

---

## Z. Open Questions

1. Which proactive producers actually execute business effects versus create recommendations/tasks?
2. Which consumers, if any, execute `autoExecutable` tasks?
3. How do Business autopilot metadata, AutopilotSettings and BusinessAutonomyProfile interact in every path?
4. Does disabling/pausing Autopilot stop DelegationLoop scheduler execution?
5. Which proactive paths consume AuthorityGrant?
6. Which paths pass ActionDispatcher versus direct services?
7. Is estimated cost/spend provided before every financially material proactive action?
8. Which event-triggered proactive producers exist outside DelegationLoop?
9. How are proactive outcomes reconciled with external providers?
10. What UI grants/communicates standing authority when a loop is enabled?

---

## AA. Initial Findings

### F090 — Autopilot `executeAction()` can record execution/sent evidence without performing an external send

**Status:** VERIFIED CODE-LEVEL / EVIDENCE-INTEGRITY FINDING

`AutopilotService.executeAction()`:

- logs a CRM timeline event whose event type may be `WHATSAPP_SENT` / `EMAIL_SENT`;
- includes message/channel/executedAt metadata;
- marks a corresponding task `AUTO_EXECUTED` when possible;
- returns `{ success: true, eventLogged: ... }`.

No email/WhatsApp/provider/domain sender is called by this method.

Therefore local evidence can claim a communication/execution occurred when this path only recorded that claim.

This is a direct K8 Evidence/Outcome integrity violation.

### F091 — Autopilot task approval conflates approval with completion/execution

**Status:** VERIFIED CODE-LEVEL / STATE-SEMANTIC FINDING

`AutopilotService.approveTask()` sets:

```text
status = COMPLETED
approvedAt = now
approvedBy = caller-supplied value
executedAt = now
executedBy = SYSTEM
```

but performs no associated business side effect.

Repository search in this pass did not find a post-approval listener consuming that task approval to perform the action.

Thus control satisfaction and outcome state are conflated.

### F092 — Autopilot control/action surface is guarded only by broad Business access

**Status:** VERIFIED CODE-LEVEL AUTHORITY FINDING

`AutopilotController` uses class-level:

```text
AuthGuard + BusinessGuard
```

without observed capability/module-scope guards on routes that can:

- create tasks with caller-chosen `autoExecutable` / `requiresApproval`;
- mutate status / caller-supplied executedBy;
- approve with caller-supplied approvedBy;
- mutate Autopilot settings;
- enable/configure/run DelegationLoops;
- use KEY delegation build/talk/autoExecute routes.

This extends F083 from one hard-profile endpoint to a broader proactive control plane.

### F093 — loop-level governance is not exact child-action governance

**Status:** VERIFIED ARCHITECTURAL / CODE-LEVEL FINDING

DelegationLoop evaluates governance once using:

```text
delegation_<loopType>
```

then executes a loop body that may:

- mutate Invoice status;
- mutate Contact lifecycle;
- create work items;
- send external email;
- emit events/evidence.

For quick-confirm decisions, the loop passes a boolean into child logic. Some domain mutations (e.g. Invoice `SENT -> OVERDUE`, Contact lifecycle -> `STALE`) occur regardless of whether the subsequent outreach/task requires confirmation.

Therefore a composite proactive loop currently lacks explicit child ActionEnvelope/clearance semantics.

Target may use bounded parent/standing clearance, but material children must remain exact identifiable actions.

### F094 — `AutopilotTask.autoExecutable` has no production consumer found in current search

**Status:** PROVISIONAL / SEARCH-SCOPED

Current repository search found the field written by Autopilot/DelegationLoop and referenced in tests/docs, but no production branch that reads it to execute tasks.

Do not upgrade to universal absence until broader consumer search is complete.

---

## AB. Working Journey Graph

```text
Business state / event / timer
→ proactive observation
→ candidate business action
→ standing delegation / human authority provenance
→ exact CapabilityContract
→ child ActionEnvelope
→ readiness + policy + KEY autonomy
→ ControlRequirement
→ ControlEvidence / bounded parent coverage
→ Clearance
→ atomic ExecutionClaim
→ real domain/provider effect
→ OutcomeEvidence / reconciliation
→ learning
→ recommendation to change policy if warranted
```

---

## AC. Machine-readable Record

```yaml
journey_id: KF-JOURNEY-006
name: Proactive KEY / Autonomy
maturity: SCOPING
role: governance_stress_test
implementation_evidence:
  branch: main
  commit: d7c5b86cfa276d75ffa42d5f1707c43704dc9f21
active_kernels:
  - KF-KERNEL-002
  - KF-KERNEL-003
  - KF-KERNEL-005
  - KF-KERNEL-006
  - KF-KERNEL-007
  - KF-KERNEL-008
  - KF-KERNEL-011
core_questions:
  - proactive_origin
  - standing_authority_provenance
  - composite_vs_child_capability
  - pause_kill_revocation
  - spend_and_action_limits
  - exact_execution_claim
  - outcome_truth
  - learning_without_self_grant
initial_findings:
  - F090
  - F091
  - F092
  - F093
  - F094
implementation_authorized: false
reopen_prior_journeys: true
```
