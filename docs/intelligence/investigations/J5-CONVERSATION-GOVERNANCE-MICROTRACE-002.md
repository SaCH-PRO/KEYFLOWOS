# J5 Conversation Governance — Microscopic Trace 002

Status: DURABLE INVESTIGATION / J5 ACTIVE / F223–F224 ALLOCATED
Last updated: 2026-09-09
Implementation evidence baseline: `main@8f173bfe79f1418159cf4099ea18b0d60d203ec2`
Production implementation authorized: **NO**
Runtime proof executed: **NO**

Purpose: preserve the post-F222 governance and approval-order trace, including anti-duplication decisions and the next evidence-layer seam.

---

## 1. Anti-duplication result for AiOversight confidence override

Relevant existing governance roots were re-read before allocation:

- F032 parallel governance regimes;
- F057 control requirement over-coupled to risk;
- F058 preapproval without exact immutable binding;
- F064 stale low-tier approvals becoming timeout approvals;
- F067 quick-confirm not bound to an immutable server-side action;
- F068 no universal exact-action fingerprint binding;
- F084 historical approval learning increasing standing autonomy.

None of these owns the exact mechanism below.

### Reachable conversational sequence

`ConversationalAIService.analyzeMessage()` instructs the model to return action JSON containing:

```text
toolName
payload
confidence
requiresConfirmation
```

The parsed action is mapped directly into `ConversationalAction`. No independent confidence calibration/range-validation boundary is observed in this path.

For each action:

```text
role allowance
→ AiOversight.evaluateAutoApproval(
     businessId,
     toolName,
     { confidence: action.confidence, role }
   )
```

`AiOversight.evaluate()` can return:

```text
allowed=true
requiresQuickConfirm=true
```

for Tier-2 actions beyond the current automatic threshold.

`evaluateAutoApproval()` then applies:

```text
if confidence > 0.9 && tier <= 2
→ return autoApproved=true
```

while spreading the prior decision, so `requiresQuickConfirm=true` can remain present.

`ConversationalAIService` executes when:

```text
decision.autoApproved == true
AND
action.confidence > 0.75
```

It does not require actual quick-confirm evidence, and the model-provided `requiresConfirmation` field is not consulted as an execution gate.

### Canonical classification

Allocated:

```text
F223 / C173
```

Root semantics:

```text
model confidence is accepted as control evidence
```

Target law:

```text
confidence may inform epistemic quality/readiness
!= evidence that human confirmation occurred
```

---

## 2. MessageIntake approval-order inversion

`MessageIntakeOrchestrator.buildPlan()` creates a pending `AiApprovalItem` and stores a multi-action plan.

Authenticated route:

```text
POST /communications/businesses/:businessId/message-intake/:intakeId/approve
```

calls:

```text
executePlan(businessId, intakeId, userId)
```

`executePlan()` first loops through child actions. Reachable children include:

```text
create KeyInbox thread/message
send email/WhatsApp/SMS reply
create command
create CRM follow-up task
assign task
write CRM note
```

Only after all child processing finishes does it do:

```text
messageIntake.status = approved
resolvePendingApproval(... approved, userId)
```

`resolvePendingApproval()` invokes `AiOversight.resolveApproval()`, where Membership and approval-tier authority are actually enforced.

Therefore a logged-in business member who passes only `AuthGuard + BusinessGuard` can trigger material plan effects before the system proves that member may approve the pending item.

Example:

```text
STAFF/default approval tier 0
→ call MessageIntake /approve
→ child effects execute
→ pending AiApprovalItem risk tier 2 is resolved afterward
→ resolver throws ForbiddenException
→ executePlan catch marks intake error
→ completed child effects remain
```

### Canonical classification

Allocated:

```text
F224 / C174
```

Root semantics:

```text
approval authority is validated post-effect
```

This is not merely a missing controller scope. It is an ordering defect in the approval/execution protocol.

---

## 3. Interaction with the earlier duplicate-KeyInbox collision

For adapter-persisted WhatsApp with external ID E:

```text
adapter writes KeyInboxMessage(E)
→ MessageIntake approve
→ executePlan creates new KeyInboxThread
→ attempts duplicate KeyInboxMessage(E)
→ DB uniqueness conflict
→ intake status=error
```

In this branch the failure happens before `resolvePendingApproval()`, so the pending `AiApprovalItem` remains unresolved.

The route has still semantically received an “approve” request, but durable states become:

```text
MessageIntake = error
AiApprovalItem = pending
orphan KeyInboxThread = exists
original KeyInbox message = exists
```

Current classification:

- causal duplicate ownership remains F222/C172;
- post-effect authorization inversion is F224/C174 generally;
- partial/orphan recovery remains J18/KF-REC-048 pressure;
- no additional finding allocated solely for this state combination yet.

---

## 4. KeyInbox suggested-action executor ownership trace

`KeyInboxActionExecutorService` has a positive operator-confirmation seam upstream, but its implementations directly mutate several domain tables:

```text
contactTask.create
contact.create
keyInboxThread.update
```

rather than consistently routing through CRM/domain services.

`draft_reply` does use `KeyInboxService.addMessage()`.

Current classification:

```text
raw Contact / ContactTask writes = existing K6/state-owner + J2/J15 capability-governance pressure
new J5 root = NOT YET JUSTIFIED
```

A new allocation would require proof that the direct writes violate a conversation-specific invariant not already owned by the state/governance findings.

---

## 5. WhatsApp provider-status evidence trace

The inspected `WhatsAppController` webhook body/parser recognizes:

```text
Twilio inbound: From / Body / SmsMessageSid
Meta inbound:   entry[].changes[].value.messages[] + contacts[]
```

The Meta parser only returns a `ParsedInbound` when a `message.from` exists.

No branch in the inspected controller parses Meta `statuses[]` delivery callbacks.

Consequently a status-only Meta webhook reaches:

```text
parseInboundPayload() → null
```

and the shared endpoint returns:

```text
{ success: false, error: 'Unrecognized WhatsApp webhook payload' }
```

Current conclusion is deliberately narrow:

```text
this controller does not advance outbound WhatsApp messages from provider accepted/sent into delivered/read evidence
```

This is evidence-layer pressure, not yet a canonical F225. Repository-wide provider callback search must complete first.

---

## 6. Current ranges after Trace 002

```text
F001–F224
C001–C174
KF-REC-001–KF-REC-056
next free F225 / C175 / KF-REC-057
```

J5 remains **ACTIVE / NOT CONVERGED**.

---

## 7. Exact next microscopic trace

```text
1. complete repository-wide WhatsApp/Twilio/Meta status-callback search before deciding whether missing delivery-evidence handling is a new root;
2. trace Gmail send/providerMessageId and any delivery/open/bounce ingestion path;
3. trace how KeyInbox outbound messages model SENT/FAILED versus DELIVERED/READ and whether UI/retry logic distinguishes them;
4. inspect MessageIntake UI/state transitions after executePlan returns success=false: can an error intake be retried, rejected, or reconciled while its AiApprovalItem remains pending?;
5. inspect whether resolvePendingApproval can itself fail after all plan effects and after intake.status='approved', creating approved/error/approval-state divergence;
6. continue reuse-first discipline before F225/C175/KF-REC-057.
```
