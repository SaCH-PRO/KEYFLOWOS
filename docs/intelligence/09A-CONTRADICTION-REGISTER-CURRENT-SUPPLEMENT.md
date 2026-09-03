# KeyFlowOS Contradiction Register — Current Supplement

Status: CANONICAL CONTINUATION OF `09-CONTRADICTION-REGISTER.md`

Purpose: preserve newly pooled contradictions without risking whole-file truncation of the large canonical register through connector replacement. This file is part of the canonical contradiction register until the next safe compaction/export pass.

Canonical sequence continues after C047.

---

## C048 — direct authority editor vs alternate authority constructors

**Status:** VERIFIED ACTIVE CONTRADICTION

Direct Membership permission editing requires `team:admin`, while semantically equivalent or stronger authority can be constructed through `team:write` paths such as promotion to ADMIN, creation/assignment of a powerful JobRole, and creation of DelegationRule.

Target resolution: capability-level authority mutation semantics + Effective Authority Resolver + grantability checks, not strengthening one route in isolation.

---

## C049 — backend-significant payload vs human-visible approval data

**Status:** VERIFIED ACTIVE CONTRADICTION

ApprovalRequest and AiPlan carry structured fields that materially affect policy/execution, while primary approval screens omit some of those fields from the authorization moment.

Target resolution: `ControlPresentation` derived from the same exact ActionEnvelope/normalized data consumed by policy and execution.

---

## C050 — canonical proposal direction vs visible KEY Actions regime

**Status:** VERIFIED ACTIVE CONTRADICTION

KeyActionProposal is the intended convergence/canonical proposal direction, while the primary `/app/approvals -> KEY Actions` product UI directly lists and resolves live AiApprovalItem records.

Proposal migration is therefore a user-facing compatibility problem, not only backend cleanup.

---

## C051 — significant detail availability vs authorization-moment acknowledgement

**Status:** VERIFIED ACTIVE CONTRADICTION

AiApprovalItem significant fields are available in an optional SideSheet, but the user can approve from the list and the final dialog repeats only the title.

Target resolution: concise significant-action summary at the authorization moment, with optional raw detail.

---

## C052 — schedule record vs execution ownership

**Status:** VERIFIED ACTIVE CONTRADICTION

A due `DelegationLoop` row represents scheduled work, but current due-row discovery does not give one process exclusive ownership of the logical occurrence.

Multiple runtime replicas can therefore treat the same scheduled state as permission to execute independently.

Target resolution: explicit ScheduleOccurrence identity + durable occurrence claim/lease + overlap policy.

Affected kernels: K7, K11.
Affected journeys: J6, J18, J23.

---

## C053 — dedupe key vs atomic external-effect claim

**Status:** VERIFIED ACTIVE CONTRADICTION

`TransactionalEmailService` exposes a `dedupeKey` and callers treat it as duplicate protection, while current implementation checks prior notification logs before provider call without an atomic uniqueness/claim boundary.

Target resolution: preserve dedupe identity, but distinguish advisory duplicate lookup from durable ExecutionClaim and provider-specific idempotency.

Affected kernels: K8, K9, K11.
Affected journeys: J5, J6, J13, J18.

---

## C054 — task execution status vs provider/effect evidence

**Status:** VERIFIED ACTIVE CONTRADICTION

`AUTO_EXECUTED` currently has incompatible meanings across Autopilot paths: it can mean no provider was called, provider-capable work was merely eligible, a send was queued/failed by return value, or a provider accepted a request.

Target resolution: separate intent, control, claim, attempt, provider acceptance, delivery, reconciliation and business consequence states.

Affected kernels: K6, K8, K9, K11.
Affected journeys: J6, J18.

---

## C055 — canonical Invoice transition owner vs proactive raw mutation

**Status:** VERIFIED ACTIVE CONTRADICTION

`InvoiceWorkflowService` declares itself the single owner of Invoice lifecycle transitions, while DelegationLoop writes `Invoice.status='OVERDUE'` directly.

Target resolution: proactive systems request canonical domain transitions; they do not create alternate state ownership.

Affected kernels: K6, K10.
Affected journeys: J3, J6, J7.

---

## C056 — canonical event name vs incompatible producer schema

**Status:** VERIFIED ACTIVE CONTRADICTION

Canonical `invoice.overdue` consumers expect typed `InvoiceStatusPayload` containing `payload.invoice`. DelegationLoop emits the same event name with a narrower private payload lacking that canonical object.

Target resolution: event names become versioned contracts with schema ownership; incompatible private events must use distinct names or compile into the canonical contract.

Affected kernels: K7, K8, K9, K11.
Affected journeys: J3, J6, J7, J14, J18.

---

## C057 — loop-local learning evidence vs business-wide authority mutation

**Status:** VERIFIED ACTIVE CONTRADICTION

`adaptGovernanceFromHistory()` gathers human approval evidence for one `loopType`, but can mutate business-wide `maxAutoTier`, which `AiOversightService` then applies to unrelated tools subject to its other restrictions.

Target resolution: learning may produce confidence/trust evidence; expansion of standing authority requires an independently authorized, capability/bounds-specific policy transition.

Affected kernels: K3, K5, K8.
Affected journeys: J2, J6, J15, J16.

---

## C058 — configurable custom loop vs fixed executable loop vocabulary

**Status:** VERIFIED ACTIVE CONTRADICTION

Cortex exposes `create_loop` and can persist active `custom_<timestamp>` DelegationLoop rows. The scheduler executor only has implementations for five fixed loop types, yet unknown custom types can still reach completed/success state.

Target resolution: a recurring delegation is enable-able only after its executable contract compiles to registered capabilities; otherwise fail closed as invalid/not executable.

Affected kernels: K5, K6, K7, K8, K11.
Affected journeys: J6, J16, J23.

---

## C059 — Build/configure UX vs standing-authority semantics

**Status:** VERIFIED ACTIVE CONTRADICTION

Talk-to-KEY presents `Build it` as the configuration step and `Execute Now` as an optional later action. But building an Autopilot delegation calls the backend with `enabled:true`, thereby granting future recurring agency immediately. `autoExecute:false` only suppresses the immediate manual run.

Target resolution: UX must distinguish creating a draft configuration from granting/enabling standing authority, or explicitly communicate that build-and-enable is the authority transition.

Affected kernels: K2, K3, K7.
Affected journeys: J6, J15, J25.

---

## C060 — visual toggle vs authority-bearing accessible state

**Status:** VERIFIED UX / ACCESSIBILITY CONTRADICTION

The Autopilot loop enable control is a custom visual `<button>` controlling standing agency, but no explicit programmatic name/state contract such as an accessible switch role/state was observed in the inspected component.

Target resolution: authority-bearing controls must expose programmatically determinable name, role and state while remaining concise and keyboard-operable.

Affected journeys: J6, J21 indirectly through platform accessibility standards.

---

# Priority linkage

C048 feeds K2/K3 grantability and control-plane authority convergence.

C049–C051 feed K3/K5/K8 exact-action ControlPresentation/ControlEvidence convergence and J15/J2/J23.

C052–C060 establish the next shared convergence cluster:

```text
Standing Authority
→ ScheduleOccurrence
→ OccurrenceClaim
→ exact child Capability/ActionEnvelope
→ canonical StateTransition
→ typed Event Contract
→ ExecutionClaim
→ truthful OutcomeEvidence
→ bounded Feedback
```

They particularly activate K7 Temporal/Event/Workflow and K9 Integration/External Reality alongside K3/K5/K6/K8/K11.

No production implementation is authorized by this supplement.
