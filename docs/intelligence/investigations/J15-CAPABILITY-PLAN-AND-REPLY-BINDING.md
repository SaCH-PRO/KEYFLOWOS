# J15 — Capability, Plan and Reply Binding Forensics

Status: ACTIVE FORENSICS / POOLED KERNEL INPUT

Implementation baseline: `main@d7c5b86cfa276d75ffa42d5f1707c43704dc9f21`

The baseline commit is audit-only relative to the previously inspected code-bearing baseline; implementation semantics in this slice are unchanged.

Affected journeys:

- J2 — KEY Request → Governed Action
- J6 — Proactive KEY / Autonomy
- J15 — Approval / Governance Lifecycle
- J23 — Temporal Flow / Long-Running Workflow
- J25 — Human Authority Lifecycle

Affected kernels:

- K2 Human Authority & Organization
- K3 KEY Authority & Governance
- K5 Capability Fabric
- K6 State Transition
- K7 Temporal / Event / Workflow
- K8 Evidence & Outcome
- K11 Recovery & Reliability

---

## 1. Exact capability identity is split across proposal representations

Current `KeyActionProposal` carries several partially overlapping representations:

```text
actionType
  = proposal/governance choreography label

toolName
  = optional top-level field

payload.toolName
  = actual EXECUTE_TOOL identity consumed by KeyCortexActionExecutorPlugin

inputPayload
  = optional parameter projection

payload.inputPayload / payload.parameters
  = execution parameters consumed by EXECUTE_TOOL plugin
```

This means the thing a policy layer evaluates and the thing an executor consumes are not guaranteed to be the same field.

For `EXECUTE_TOOL`, `KeyActionExecutorService` invokes `SafetyShellService.check()` using `proposal.actionType`, while `KeyCortexActionExecutorPlugin` later unwraps `proposal.payload.toolName` and, for bare Flow names, calls `FlowOrchestratorService.executeToolDirectly()`.

Target implication:

> Capability identity must be normalized once into a canonical ActionEnvelope and remain identical from policy evaluation through control evidence, clearance, execution and outcome.

`actionType` may remain a workflow/proposal type, but must not substitute for exact CapabilityContract identity.

---

## F076 — Plan step risk is discarded when creating canonical proposal

**Status:** VERIFIED CODE-LEVEL FINDING

`PlanExecutorService.createStepProposal()` computes:

```text
riskLevel = mapRiskTier(step.riskTier)
```

but never writes that value into the proposal creation input.

It instead creates:

```text
actionType = EXECUTE_TOOL
payload.toolName = actual tool
```

`KeyActionProposalService.create()` derives proposal risk exclusively from `KeyActionPolicyService.riskLevel(actionType)`.

`KeyActionPolicyService` currently defines `EXECUTE_TOOL` as `MEDIUM`.

Therefore:

```text
real plan step Tier 3 or Tier 4
        ↓
EXECUTE_TOOL wrapper
        ↓
KeyActionProposal.riskLevel = MEDIUM
```

The computed plan-step risk exists but is discarded at the proposal boundary.

### Architectural implication

Impact/risk must derive from the exact CapabilityContract + normalized invocation, not from proposal choreography type.

This strengthens F033, F034 and F037.

---

## F077 — Approved EXECUTE_TOOL proposal is re-evaluated without reconstructing exact capability

**Status:** VERIFIED CODE-LEVEL FINDING

`KeyActionProposalService.execute()` re-evaluates autonomy using:

```text
actionKey = key_autonomy.EXECUTE_TOOL
parameters = proposal.payload
```

The exact underlying tool is not promoted back into the evaluated action identity.

`AutonomyOrchestratorService.toExecutableActionType()` does not include `EXECUTE_TOOL`, so its static action-policy and per-module Genome-policy branches do not apply as an executable action.

`KeyActionProposalService` then separately calls `KeyActionGenomePolicyService.evaluateExecution()` with `proposal.actionType`; `ACTION_MODULE_MAP` has no `EXECUTE_TOOL`, so the service reports that no KEY Genome module gate applies.

Only after these proposal-level checks does the executor unwrap `payload.toolName` and invoke the real tool.

For bare Flow tool names the executor calls `FlowOrchestratorService.executeToolDirectly()`.

### Architectural implication

The post-approval execution boundary cannot prove that the **same exact capability invocation** evaluated by governance is the invocation that executes.

Target chain:

```text
CapabilityContract
→ canonical ActionEnvelope
→ fingerprint
→ control evaluation
→ ControlEvidence
→ Clearance
→ execution claim
→ dispatcher
```

The capability identity must not be reconstructed from wrapper payload after clearance-like decisions have already occurred.

---

## F039 revalidation — Canonical plan-step proposal approval can re-enter approval

**Status:** RE-ANALYZED / STRENGTHENED

`PlanExecutorService.onProposalApproved()` does not consume an approval as durable child clearance.

It performs:

```text
KeyActionProposal APPROVED
→ set AiPlanStep.status = pending
→ enqueuePlanSteps()
→ evaluateStep(real tool)
→ if tool still requires formal/admin approval
   → createStepProposal() again
```

No portable preapproval/clearance marker was found on this path.

The only inspected `@OnEvent('key.action.approved')` consumer is the PlanExecutor path above.

### Architectural implication

A proposal decision is not currently a portable authorization artifact for the child action.

This is live evidence for the target distinction:

```text
approval evidence != exact-action clearance
```

---

## F078 — Approved plan child set is mutable during execution

**Status:** VERIFIED CODE-LEVEL FINDING

Search did not find an ordinary path that mutates an existing plan step's `toolName`, `inputPayload` or `riskTier` after creation in the inspected slice.

However, `FeedbackLoopService.applyFeedbackToPlan()` can insert a **new** `AiPlanStep` into an already executing plan from AI feedback:

- new toolName;
- new action;
- new inputPayload;
- inferred riskTier;
- dependency on current step;
- status `pending`.

If `shouldReplan` is false but `suggestedNextStep` exists, the parent plan remains executing.

Therefore a previously approved plan does not represent an immutable approved child-action set.

A new child can be created after plan approval and then enter ordinary step governance. If the child falls into a low-friction control class, it may execute despite not existing in the original approved plan snapshot.

### Supporting semantic evidence

`MorningBriefingService` also creates `AiPlan` with `status: 'approved'` directly and emits `plan.approved`, showing that the plan status `approved` does not necessarily mean a human approved a frozen plan snapshot.

### Architectural implication

`AiPlan.status = approved` is coordination state, not sufficient hierarchical clearance.

A parent clearance must bind:

```text
plan version/fingerprint
+ child capability set
+ material parameter bounds
+ authority/policy version
```

New or materially changed children require independent evaluation unless explicitly permitted by immutable approved bounds.

---

## 2. Reply-channel principal model

`StaffChatBridgeService` permits a full-account or contact-only active `OrgAssignment` to interact with KEY over WhatsApp/SMS.

Principal resolution is:

```text
verified inbound transport
→ businessId
→ normalized fromPhone
→ active OrgAssignment.contactPhone
→ position-bound principal
```

For approval:

- assignment must have `autoApprovalViaReply`;
- the pending `AiApprovalItem` must be routed to `approverAssignmentId = assignment.id`;
- `resolveApprovalByAssignment()` checks the active JobRole's `defaultApprovalTier`;
- Membership/User is not required.

This confirms the earlier position-bound-human-principal model.

### Transport authenticity

The inspected WhatsApp controller verifies Twilio/Meta webhook authenticity and fails closed when required secrets/signatures are unavailable or invalid.

The generic inbound SMS controller validates `x-keyflow-signature` HMAC over the raw request body and fails closed when the secret/signature is absent or invalid.

Therefore this is **not** classified as generic webhook spoofing in the inspected paths.

### Principal assurance limitation

The human assurance is essentially possession/control of the registered messaging endpoint as represented by the provider-originated phone number. There is no stronger per-approval step-up or device-bound authentication proof attached to the control evidence.

`JobRole.defaultApprovalTier` is also only integer-validated in `CreateJobRoleDto`; no observed 0–4 bounds are expressed there.

---

## F079 — Reply approval is not bound to an explicit approval/action identifier

**Status:** VERIFIED CODE-LEVEL FINDING

A reply such as `YES` or `NO` does not carry an approval identifier, nonce or action fingerprint.

When `autoApprovalViaReply` is enabled, `StaffChatBridgeService` selects:

```text
oldest pending AiApprovalItem
where businessId = B
and approverAssignmentId = current assignment
```

and applies the parsed decision to that item.

Therefore the semantic meaning of:

```text
YES
```

is approximately:

> resolve whichever routed approval is oldest at processing time

rather than:

> approve exact action X / challenge Y

### Architectural implication

Conversational approval must bind a reply to a server-generated approval challenge / ControlEvidence candidate containing exact action identity.

At minimum the response correlation must be specific to one pending control request.

---

## F080 — Staff reply approval is processed before inbound event deduplication

**Status:** VERIFIED CODE-LEVEL FINDING

This is stronger than F079.

### WhatsApp

`WhatsAppService.receiveInbound()` calls `StaffChatBridgeService.routeInboundMessage()` **before** entity resolution, KEY Inbox external-message dedupe and WhatsApp message persistence.

If the staff bridge handles the message it returns immediately, so the normal `externalMessageId` dedupe path is never reached.

### Generic SMS

`InboundCommunicationsService.receiveSms()` similarly calls the staff bridge before ordinary message resolution/emission, and no external-id dedupe precedes that call.

### Consequence

A provider retry or duplicate delivery of the same authentic `YES` can be interpreted more than once.

If two approvals A and B are pending for the same routed assignment:

```text
same provider event YES — delivery #1
→ oldest pending = A
→ approve A

same provider event YES — duplicate delivery #2
→ A no longer pending
→ oldest pending = B
→ approve B
```

Transport signature verification does not prevent this because the repeated event is authentic.

### Classification

Verified code-level replay/idempotency weakness. No runtime reproduction performed.

### Architectural implication

Inbound events that can mutate authority/governance state require atomic event-consumption dedupe **before** business side effects.

The approval challenge itself must also be one-time consumable and exact-action-bound.

---

## 3. External standards cross-reference

Research date: 2026-09-03.

### OWASP Transaction Authorization

Applicable properties extracted from current OWASP Transaction Authorization guidance:

- the user should identify and acknowledge significant transaction data;
- transaction authorization should be server-side;
- verification data should be server-generated/stored;
- material transaction-data change should invalidate/restart authorization;
- each operation should use unique authorization credentials;
- authorization should be time-limited;
- final execution should verify the transaction was properly authorized;
- state transitions must not allow authorization steps to be skipped or reordered.

Transferability to KeyFlowOS: **ADOPT / ADAPT**.

KeyFlow mapping:

```text
transaction
→ governed ActionEnvelope

transaction verification data
→ action fingerprint + control challenge

transaction authorization
→ typed ControlEvidence

final execution check
→ Clearance verification before ExecutionClaim
```

### NIST SP 800-63B-4

Current final publication: July 2025.

Relevant properties:

- out-of-band authentication uses a short-term secret to bind the operation across channels;
- out-of-band approval must be associated with the specific transaction/authentication operation rather than a free-floating approval;
- authentication secrets are one-time and replay-resistant;
- PSTN/SMS is a restricted authenticator and warrants risk consideration such as SIM/number changes;
- current guidance removed simple compare-and-approve patterns because of authentication-fatigue risk.

Transferability to KeyFlowOS: **ADAPT**, not literal compliance mapping.

KeyFlow implication:

A contact-only phone-bound approver may remain a legitimate principal class, but high-impact approval should use proportional assurance. Bare `YES` against an implicit queue position is not a sufficient exact-action control-evidence primitive.

### Twilio webhook retry/idempotency guidance

Twilio documents webhook retries and exposes an `I-Twilio-Idempotency-Token` to distinguish retry attempts for applicable callbacks.

Transferability: **ADOPT PROPERTY**.

KeyFlow should treat duplicate webhook delivery as normal transport behavior and make side-effecting inbound handlers idempotent using provider event identity or an internally normalized event-consumption claim.

---

## 4. Candidate target for conversational approval

Do not remove low-friction conversational approval. Strengthen its binding.

```text
ControlRequest
  id
  businessId
  actionFingerprint
  capabilityName/version
  significantDisplayData
  requestedFromPrincipal/Assignment
  controlRequirement
  challengeNonce
  expiresAt
  authorityVersion
  policyVersion

send via channel
  “Approve refund TT$500 to ••1234? Reply YES 4821 or NO 4821.”

verified provider event
→ atomic event dedupe
→ resolve position-bound principal
→ match challenge/ControlRequest
→ re-check authority freshness + challenge validity
→ atomically consume challenge once
→ create ControlEvidence
→ evaluate exact-action Clearance
```

For selected higher-impact actions, the target may require step-up authentication rather than chat reply alone.

The UX goal remains low friction; sophisticated internal governance should not require user-hostile repeated approvals.

---

## 5. New contradiction candidates

### C040 — Real plan-step risk vs proposal wrapper risk

A plan step can be Tier 3/4 while its `EXECUTE_TOOL` proposal becomes `MEDIUM`.

### C041 — Approved plan semantics vs mutable child set

The product/state label `approved` suggests bounded authorization, while an executing plan can acquire new AI-generated child steps.

### C042 — Conversational approval intent vs oldest-pending selection

A human's `YES` is conversationally understood as approval of a presented action, while implementation selects the oldest routed pending item at processing time.

### C043 — Authenticated webhook vs replay-safe authorization

Inbound signature verification proves transport/provider authenticity but does not prove a governance event has not already been consumed.

---

## 6. Kernel laws strengthened by this slice

### K3 Governance

```text
ControlEvidence must be exact-action-bound, typed, time-bounded and single-consumption where appropriate.
```

### K5 Capability

```text
Workflow/actionType identity cannot replace exact CapabilityContract identity.
```

### K6 State Transition

```text
APPROVED is not a generic writable status; the transition must preserve what was approved and by whom.
```

### K7 Temporal / Workflow

```text
A mutable workflow plan and an immutable authorization envelope are separate concepts.
```

### K11 Recovery / Reliability

```text
Authentic event delivery != unique event consumption.
Event dedupe must occur before irreversible/authority-sensitive side effects.
```

---

## 7. Next forensic loops

1. expiration/revocation/authority-version invalidation across proposals, grants, routing and plan execution;
2. control-plane mutation authority for autonomy, JobRole, assignment, delegation and AuthorityGrant changes;
3. frontend evidence: what exact action data approvers see and whether stale tabs/version drift are detectable;
4. pool current findings/contradictions into canonical registers;
5. cross-reference these laws backward through J2/J25 and forward into J6/J23.

Production implementation remains unauthorized.
