# KeyFlowOS Finding Register — Current Supplement

Status: CANONICAL CONTINUATION OF `08-FINDING-REGISTER.md`

Purpose: preserve newly pooled findings without risking whole-file truncation of the large canonical register through connector replacement. This file is part of the canonical finding register until the next safe compaction/export pass.

Implementation baseline: `main@d7c5b86cfa276d75ffa42d5f1707c43704dc9f21`

Canonical sequence continues after F084.

---

## F085 — `team:write` can construct authority stronger than the caller through multiple paths

**Status:** VERIFIED CODE-LEVEL / SYSTEMIC AUTHORITY FINDING

Multiple authority constructors are guarded by coarse `team:write` without central grantability comparison:

- `inviteTeamMember()` can create ADMIN/STAFF Membership with caller-selected valid permission scopes and `maxApprovalTier` up to 4;
- Membership role mutation can promote a non-owner member to ADMIN;
- JobRole creation/update accepts arbitrary record-shaped permissions and integer approval tier;
- OrgAssignment can bind that role and copy its authority into Membership;
- DelegationRule can be created between active assignments without proving caller/delegator grantability.

The root defect is not that `team:write` is always wrong. It is that organizational management and authority minting/escalation are conflated.

Target law:

```text
requestedGrantedAuthority <= caller.grantableAuthority
OR
caller possesses an explicit, separately governed escalation/grant capability
```

External working-model property: Kubernetes RBAC separates ordinary role/binding management from explicit `escalate`/`bind` privileges and prevents a user from granting permissions they do not already possess unless separately authorized.

Affected kernels: K2, K3, K6.
Affected journeys: J1, J2, J15, J25.

---

## F086 — ending/deleting OrgAssignment does not revoke copied Membership authority

**Status:** VERIFIED CODE-LEVEL / AUTHORITY-LIFECYCLE FINDING

Assignment creation / JobRole changes copy:

```text
JobRole.permissions -> Membership.permissionScopes
JobRole.defaultApprovalTier -> Membership.maxApprovalTier
```

But setting `endedAt` or deleting the OrgAssignment does not recompute/clear those copied fields.

Therefore position-derived authority can survive after the organizational relationship that created it no longer exists.

This strengthens F044 and C023.

Target is not more ad-hoc synchronization callbacks. Effective authority should be resolved from authoritative live inputs; any retained projection/cache should be explicitly derived/versioned.

Affected kernels: K2, K6.
Affected journeys: J25, J15, J2.

---

## F087 — KEY Action approval can occur without the human viewing significant structured action data

**Status:** VERIFIED UX / CONTROL-EVIDENCE FINDING

The `/app/approvals` KEY Actions panel is a live AiApprovalItem consumer.

Its optional SideSheet exposes useful evidence including rationale, expected benefit, risks, full `inputPayload`, and `affectedEntities`. However the user can press Approve directly from the list row without opening that detail. The final confirmation dialog restates only the title.

Thus approval can be collected without acknowledgement of the material data that distinguishes one action from another.

Target: authorization-moment `ControlPresentation` derived from the exact ActionEnvelope, showing concise significant business data with expandable technical detail.

Affected kernels: K3, K5, K8.
Affected journeys: J15, J2.

---

## F088 — ApprovalRequest payload is available to the client but not rendered to the approver

**Status:** VERIFIED UX / CONTROL-EVIDENCE FINDING

The client `ApprovalRequest` type includes `payload`, but `/app/approvals/[id]` renders title/type/threshold/requester/description/steps and never renders the payload.

Backend workflow/policy logic can inspect payload subject/amount-like data, while the human approval surface omits that same structured transaction data.

Affected kernels: K3, K8.
Affected journeys: J15 plus domain journeys using ApprovalRequest.

---

## F089 — AI Plan approval omits exact tool and parameter data already available to the browser

**Status:** VERIFIED UX / HIERARCHICAL-CLEARANCE FINDING

Browser `PlanStep` already includes `toolName`, `inputPayload`, `riskTier`, `requiresApproval`, dependencies, and expected benefit. The `/app/plans/:planId` approval page shows human action/description and T3/T4 badges, but does not show `toolName` or `inputPayload` before the single-click `Approve & Execute` action.

Therefore current plan approval cannot establish strong hierarchical clearance over exact child capabilities/parameters.

Target: a bounded plan approval summary derived from exact child ActionEnvelopes, bound to a plan version/fingerprint.

Affected kernels: K3, K5, K7, K8.
Affected journeys: J15, J2, J23.

---

## F090 — Autopilot `executeAction()` can record execution/sent evidence without performing an external send

**Status:** VERIFIED CODE-LEVEL / EVIDENCE-INTEGRITY FINDING

`AutopilotService.executeAction()` logs CRM timeline events that may be typed as `WHATSAPP_SENT` / `EMAIL_SENT`, marks a corresponding task `AUTO_EXECUTED` when possible, and returns success. No email/WhatsApp/provider sender is called by that method.

Therefore local evidence can claim communication/execution occurred when the path only recorded that claim.

Affected kernels: K6, K8, K11.
Affected journeys: J6, J3, J5.

---

## F091 — Autopilot task approval conflates approval with completion/execution

**Status:** VERIFIED CODE-LEVEL / STATE-SEMANTIC FINDING

`AutopilotService.approveTask()` sets `COMPLETED`, `approvedAt`, `approvedBy`, `executedAt`, and `executedBy=SYSTEM` without performing the underlying business action. No post-approval execution consumer was found in the inspected path.

Control satisfaction and business outcome are therefore conflated.

Affected kernels: K3, K6, K8.
Affected journeys: J6, J15.

---

## F092 — Autopilot control/action surface is guarded only by broad Business access

**Status:** VERIFIED CODE-LEVEL / AUTHORITY FINDING

`AutopilotController` uses class-level `AuthGuard + BusinessGuard` without observed capability/module-scope guards on routes that can create authority-bearing task metadata, mutate task execution state, approve tasks, mutate Autopilot settings, enable/configure/run DelegationLoops, and invoke KEY delegation build/talk/execute routes.

This extends F083 into the broader proactive control plane.

Affected kernels: K2, K3, K6.
Affected journeys: J6, J15, J25.

---

## F093 — loop-level governance is not exact child-action governance

**Status:** VERIFIED ARCHITECTURAL / CODE-LEVEL FINDING

DelegationLoop evaluates governance once using `delegation_<loopType>` and then executes a body that may mutate Invoice state, mutate Contact lifecycle, create work items, send external email, or emit domain/evidence events.

A composite loop may legitimately receive bounded parent authority, but exact material child actions must remain identifiable, bounded, and governable.

Affected kernels: K3, K5, K6, K7.
Affected journeys: J6, J2, J15, J23.

---

## F094 — `AutopilotTask.autoExecutable` has no production consumer found in current search

**Status:** VERIFIED SEARCH-SCOPED / SEMANTIC-REACHABILITY FINDING

Repository-wide current search found `autoExecutable` written by Autopilot/DelegationLoop and referenced by tests/docs, but no production execution branch that consumes it to execute tasks. The repository capability map independently flags it as written-never-read.

This is not proof that all Autopilot execution is absent; payment recovery has a separate direct-email path. It means `AutopilotTask` itself is not currently a coherent generic execution engine.

Affected kernels: K5, K6, K8.
Affected journey: J6.

---

## F095 — Autopilot pause/disable does not stop DelegationLoop business mutations/task generation

**Status:** VERIFIED CODE-LEVEL / CONTROL-SEMANTIC FINDING

`autopilotEnabled` and `pausedUntil` are enforced by Payment Recovery `contactWindow()` at direct email send time, not as a universal gate over due DelegationLoop execution. An enabled loop can still scan, mutate local lifecycle state and create business work while the broader Autopilot setting is disabled/paused.

Target must distinguish pause-new-actions, pause-external-contact, disable-specific-delegation and global-autonomous-effect kill semantics.

Affected kernels: K3, K6, K7, K11.
Affected journeys: J6, J18, J23.

---

## F096 — Cortex autonomous spend cap is bypassed by zero cost estimates

**Status:** VERIFIED CODE-LEVEL / POLICY-ENFORCEMENT FINDING

`KeyAutonomySafetyService` checks the daily spend ceiling only when `estimatedCostTtd > 0`. Inspected Cortex production callers pass `estimatedCostTtd: 0`, so the pre-effect spend block is skipped even when actual cost may later be recorded.

Unknown/unbounded exposure must not silently become zero. Capability/ActionEnvelope metadata should carry deterministic amount, conservative upper bound, reservation, or explicit no-monetary-exposure semantics.

Affected kernels: K3, K5, K10.
Affected journeys: J6, J7, J20.

---

## F097 — DelegationLoop scheduled occurrences have no durable execution claim

**Status:** VERIFIED CODE-LEVEL / DISTRIBUTED-RELIABILITY FINDING

`processDueLoops()` reads due enabled loops, then `executeLoop()` unconditionally creates a running history row. `nextRunAt` advances only after the completion path. No atomic occurrence claim/lease/expected-schedule CAS was found before child effects begin.

Two application instances can therefore both acquire the same logical scheduled occurrence.

Target law: a scheduled business-agency occurrence must acquire durable execution ownership before producing child effects.

Affected kernels: K7, K11.
Affected journeys: J6, J18, J23.

---

## F098 — proactive child-task dedupe is predominantly read-before-create

**Status:** VERIFIED CODE-PATTERN / CONCURRENCY FINDING

Payment recovery, lead reactivation, post-purchase and booking-prep inspect for a semantically matching task before creating one. This suppresses duplicates during serial sweeps but is not an atomic uniqueness boundary under concurrent workers.

Where duplicate intent is invalid, target identity should include business + capability/effect + entity + milestone/window/version and use a durable uniqueness/claim property.

Affected kernels: K6, K7, K11.
Affected journey: J6.

---

## F099 — TransactionalEmail dedupe is advisory read-before-send, not atomic effect ownership

**Status:** VERIFIED CODE-LEVEL / EXTERNAL-EFFECT FINDING

When a `dedupeKey` is supplied, `TransactionalEmailService.send()` checks `CustomerNotificationLog`, calls Gmail if absent, and persists the log only after provider acceptance. `CustomerNotificationLog.messageId` is not an observed unique execution boundary.

Two concurrent workers can therefore both pass the absence check before either records success.

Application dedupe lookup, atomic ExecutionClaim and provider idempotency are distinct concepts.

Affected kernels: K8, K9, K11.
Affected journeys: J5, J6, J13, J18.

---

## F100 — queued notification draining has no per-row claim and does not preserve original dedupe identity into resend

**Status:** VERIFIED CODE-LEVEL / RECOVERY FINDING

`TransactionalEmailService.drainQueue()` fetches QUEUED rows, invokes `send()`, and marks the original row DRAINED after success. No `QUEUED -> CLAIMED/SENDING` expected-state transition or lease was observed before provider send. The resend call also does not pass the queued row's original `messageId` as `dedupeKey`.

Two instances can drain the same row. Retry/recovery therefore lacks durable effect ownership.

Affected kernels: K7, K8, K9, K11.
Affected journeys: J5, J6, J13, J18, J23.

---

## F101 — payment recovery marks execution from eligibility instead of actual send result

**Status:** VERIFIED CODE-LEVEL / EVIDENCE-INTEGRITY FINDING

Payment recovery calls `TransactionalEmailService.send()` but does not inspect its `SENT | QUEUED | FAILED` return status. It then marks the task `AUTO_EXECUTED` and emits an auto-executed event. Its run result can also report `autoExecuted=true` when the send was deferred by the contact window.

Evidence ladder:

```text
ELIGIBLE_TO_EXECUTE
!= CLAIMED_FOR_EXECUTION
!= EXECUTION_ATTEMPTED
!= PROVIDER_ACCEPTED
!= DELIVERED
!= BUSINESS_OUTCOME
```

Affected kernels: K6, K8, K9, K11.
Affected journeys: J6, J18.

---

## F102 — DelegationLoop bypasses the canonical Invoice state owner and publishes an incompatible canonical event

**Status:** VERIFIED CODE-LEVEL / CROSS-JOURNEY STATE + INTEGRATION FINDING

The dedicated `InvoiceOverdueScheduler` routes overdue detection through `InvoiceWorkflowService.transition(invoiceId,'OVERDUE')`. `InvoiceWorkflowService` declares itself the single owner of invoice status transitions and provides allowed-transition validation, transactional financial semantics, and canonical lifecycle events.

DelegationLoop instead performs a raw `invoice.update({status:'OVERDUE'})` and independently emits `invoice.overdue` with a narrower private payload lacking the canonical `invoice` object expected by typed consumers.

This violates both canonical state ownership and event-contract consistency.

Affected kernels: K6, K8, K9, K10, K11.
Affected journeys: J3, J6, J7, J14, J18.

---

## F103 — loop-local human approval history can expand a business-wide autonomy ceiling

**Status:** VERIFIED IMPLEMENTATION + TEST-SOURCE / FEEDBACK-CONTROL FINDING

The current implementation correctly excludes AI `AUTO_EXECUTED` rows from the human approval signal. Current test source explicitly pins that enough genuine human `COMPLETED` approvals may promote `maxAutoTier` from 1 to 2. **No test was executed during this investigation.**

The evidence query is scoped to one loop type, but it writes business-wide `AiOversight AutonomySettings.maxAutoTier`. `AiOversightService.evaluate()` uses that ceiling across arbitrary tools subject to other restrictions.

Thus trust evidence from capability family A can lower friction for unrelated capability family B.

Target: learning creates trust/confidence recommendations; expansion of standing authority crosses an independently authorized, capability/bounds-specific policy transition.

Affected kernels: K3, K5, K8.
Affected journeys: J2, J6, J15, J16.

---

## F104 — Cortex can create a scheduled custom DelegationLoop that completes successfully without an actuator

**Status:** VERIFIED CODE-LEVEL / FALSE-FEEDBACK FINDING

`AutopilotAdapterService.createLoop()` can create an active `custom_<timestamp>` DelegationLoop. Cortex exposes `create_loop` with `requiresApproval:false`.

`DelegationLoopService.executeLoop()` only implements the five fixed canonical loop types and has no fail-closed default. An unknown custom type therefore falls through, after which the service still marks the run completed, advances the schedule, emits completion, writes `success:true`, and invokes feedback adaptation.

Closed-loop failure:

```text
CONFIGURATION EXISTS
-> SCHEDULER RUNS
-> NO ACTUATOR
-> SUCCESS SENSOR FIRES
-> SUCCESS EVIDENCE PERSISTS
-> FEEDBACK CONSUMES HISTORY
```

Affected kernels: K5, K6, K7, K8, K11.
Affected journeys: J6, J16, J23.

---

## F105 — standing-delegation UX does not faithfully communicate the authority/effects being granted

**Status:** VERIFIED UX / ACCESSIBILITY / AUTHORITY FINDING

`/app/automations` describes DelegationLoops as scanning, matching and creating tasks, while current payment recovery also mutates Invoice state and can send external email and lead reactivation mutates Contact lifecycle state. Some stored descriptions conversely promise direct sends while current bodies only create tasks.

The loop enable control is a custom visual button without an observed explicit programmatic switch name/state contract.

In Talk-to-KEY Autopilot mode, review shows loop type/configuration and the CTA says `Build it`; `handleBuild()` immediately calls `keyBuildDelegation(... enabled:true)`. The later `Execute Now` only triggers an immediate manual run. Thus building already grants future recurring agency even though the UX frames configuration and execution as separate stages.

Affected kernels: K2, K3, K5, K7.
Affected journeys: J6, J15, J25.

---

## F106 — canonical Invoice overdue scheduling also lacks occurrence/state claim sufficient to prevent duplicate lifecycle events

**Status:** VERIFIED CODE-LEVEL / CROSS-JOURNEY RELIABILITY FINDING

Backward re-audit found that the canonical `InvoiceOverdueScheduler` is itself process-local scheduled work. Multiple instances can load the same `SENT` invoice. `InvoiceWorkflowService.transition()` loads current state and updates by id without an observed expected-state compare-and-set on the final transition. Multiple workers can therefore race and produce duplicate `invoice.overdue` event consequences.

The inspected Flow overdue-notification handler also does not supply an explicit dedupe key.

The target is therefore shared K6/K7/K11 occurrence ownership + transition CAS/idempotency + effect identity, not an Autopilot-only lock.

Affected kernels: K6, K7, K8, K9, K10, K11.
Affected journeys: J3, J6, J7, J18, J23.

---

# Finding lifecycle corrections

## Invitation placeholder identity conclusion

Earlier historical interpretation that placeholder identity necessarily ends in an unrecoverable same-email collision is **NARROWED / PARTIALLY SUPERSEDED**. Current `bootstrapUser()` detects verified-email ID mismatch and uses transactional `reconcileUserId()` to create/re-point the authenticated user identity and Membership references.

Remaining defects concern invitation-as-claim semantics, authority revalidation, owner-first bootstrap/workspace selection and Membership-first business discovery.

## F067 — Flow quick-confirm

Current lifecycle status: `RE-ANALYZED / NARROWED`.

The shipped client displays the same action description/risk and expandable arguments it returns on confirmation. The remaining defect is server binding: confirmation submits reconstructed `toolName/toolArgs` rather than consuming an immutable server-side pending ActionEnvelope by reference.

---

# Pool impact

F085–F106 now strengthen a shared target chain:

```text
EffectiveAuthority
-> StandingDelegation / exact human intent
-> ScheduleOccurrence
-> durable OccurrenceClaim
-> CapabilityContract
-> ActionEnvelope
-> ControlRequirement
-> ControlPresentation
-> ControlEvidence
-> Clearance
-> atomic ExecutionClaim
-> canonical domain/provider effect
-> typed Event/OutcomeEvidence
-> reconciliation
-> bounded feedback
-> separately authorized policy evolution
```

Shared emerging law:

> Every autonomous business effect must be traceable from valid standing authority through a uniquely owned occurrence and exact child action to truthful outcome evidence and bounded feedback.

No production implementation is authorized by this supplement.
