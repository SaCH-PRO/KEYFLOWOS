# J5 Conversation Ownership — Microscopic Trace 001

Status: DURABLE INVESTIGATION / J5 ACTIVE / NO NEW ID ALLOCATION
Last updated: 2026-09-08
Implementation evidence baseline: `main@8f173bfe79f1418159cf4099ea18b0d60d203ec2`
Production implementation authorized: **NO**
Runtime proof executed: **NO**

Purpose: preserve the first post-F222/C172 microscopic narrowing without inflating the canonical register.

---

## 1. MessageIntake approval after adapter persistence

### Reachable WhatsApp sequence

```text
WhatsApp provider message with external ID E
→ WhatsAppService.receiveInbound()
→ messageIntakeEnabled = true
→ emit message.intake.received(externalId=E)
→ always ingest same occurrence to KeyInbox
→ KeyInboxMessage externalMessageId=E exists
→ MessageIntakeOrchestrator creates reviewing intake + approval plan
→ human approves
→ executePlan()
```

The plan's first action is `create_thread_and_message`.

`executePlan()` directly:

```text
1. creates a new KeyInboxThread
2. creates a new KeyInboxMessage(externalMessageId=E)
3. only after all plan actions succeed marks MessageIntake approved
```

KeyInbox has a DB uniqueness boundary on:

```text
(business_id, channel, external_message_id)
WHERE external_message_id IS NOT NULL
```

Because the adapter already inserted E, step 2 conflicts. `executePlan()` has one outer try/catch, not a transaction around the child actions.

Code-level consequence:

```text
new thread created
→ duplicate message insert fails
→ catch marks MessageIntake status=error
→ newly-created thread is not rolled back
→ approval plan does not proceed to later child actions
```

This is a concrete F222/C172 consequence: the approval fabric attempts to re-own persistence already owned by the adapter/KeyInbox fabric.

No F223 is allocated for the orphan/error manifestation at this stage. Recovery semantics are pressure on J18/KF-REC-048; the causal root remains F222 unless later evidence proves an independently stable workflow-recovery defect that is not already covered.

---

## 2. Legacy Meta `aiHandled=false` recurrence narrowed

Legacy Meta ingestion does two things:

```text
provider external message E
→ KeyInboxMessage(externalMessageId=E)
→ SocialEngagement(id=S, externalId=E, aiHandled=false)
```

`ConnectorIntelligenceService.scanMetaMessages()` later selects `aiHandled=false` and calls:

```text
ConversationalAIService.handleInboundMessage(messageId=S)
```

`UnifiedInboxService.recordInboundMessage()` does not do application-level duplicate lookup/recovery; it directly creates a KeyInboxMessage using the supplied `messageId` as `externalMessageId`.

Therefore first scanner pass can create a second message representation:

```text
KeyInbox external identity E  — adapter representation
KeyInbox external identity S  — ConversationalAI/scanner representation
```

The scanner never writes `aiHandled=true`, but subsequent scanner passes reuse S. The KeyInbox DB uniqueness boundary then blocks another S insertion before later `handleInboundMessage()` reasoning/action steps.

Current classification:

```text
repeated autonomous action on every poll = NOT PROVEN
second semantic representation on first scanner pass = PROVEN CODE-LEVEL
later repeated scanner failure/noise = PROVEN CODE-LEVEL DIRECTION
canonical root = F222/C172 manifestation
new F223 = NOT JUSTIFIED YET
```

---

## 3. Real Meta Graph path differs from legacy path

`MetaSocialIngestionService` creates `SocialEngagement(aiHandled=false)` only for the legacy simplified payload shape. Real Meta Graph webhook payloads are written to KeyInbox but do not enter that legacy SocialEngagement scanner seam.

KeyInbox analysis builds `suggestedActions` such as:

```text
create_task
create_contact
create_invoice
create_booking
draft_reply
schedule_followup
escalate
review
```

The live KeyInbox UI requires the operator to open a confirmation flow. The controller requires `confirmed=true` before calling `KeyInboxActionExecutorService`.

Thus current processing policy can diverge by payload path:

```text
real Meta Graph
→ KeyInbox analysis
→ human-confirmed suggested action

legacy Meta
→ KeyInbox analysis
+ legacy SocialEngagement scanner
→ may additionally enter ConversationalAI autonomy evaluation
```

This strengthens F222/C172: payload shape can choose a materially different business-action policy for the same conceptual channel.

---

## 4. ConversationalAI governance seam

`ConversationalAIService` does not blindly execute model actions. It calls `AiOversightService.evaluateAutoApproval()` before direct Flow execution.

Positive seam:

```text
model action
→ role/tool allowance
→ AiOversight governance
→ direct Flow executor only when autoApproved
```

However `evaluateAutoApproval()` includes:

```text
confidence > 0.9 AND tier <= 2
→ autoApproved=true
```

and:

```text
requiresQuickConfirm AND autonomyLevel >= 2
→ autoApproved=true
```

The high-confidence branch can return `autoApproved=true` even where the underlying `evaluate()` decision required quick confirmation. This is a J2/J6/J15 governance pressure point because model confidence is epistemic confidence, not automatically authority/control satisfaction.

No new finding is allocated here yet. Mandatory next step is anti-duplication comparison with F032/F057/F058/F064 and later governance supplements before deciding whether a stable distinct root exists.

---

## 5. KeyInbox human-confirmed action seam

KeyInbox controller applies:

```text
AuthGuard
+ BusinessGuard
+ ModuleScopeGuard
+ operations:write
+ body.confirmed === true
```

before `KeyInboxActionExecutorService.execute()`.

Current executor can directly:

- create ContactTask;
- create Contact;
- schedule follow-up ContactTask;
- mutate thread priority/status;
- save AI draft reply;
- deep-link invoice/booking creation to operator UI.

This is a favorable human-control seam relative to legacy ConversationalAI autonomy, but exact capability identity/fine-grained human authority/clearance remain J2/J15 concerns. Do not duplicate those findings in J5 without a genuinely distinct conversation-specific mechanism.

---

## 6. KeyInbox outbound reply certainty

`KeyInboxReplySenderService` sends through WhatsApp or Gmail before persisting `sendStatus`/provider metadata.

Reachable crash/failure window:

```text
provider accepts send
→ persistSendResult(SENT) fails
→ catch interprets operation as send failure
→ persistSendResult(FAILED) may succeed
→ UI/operator may see FAILED and retry
→ duplicate external message possible
```

Gmail additionally captures `providerMessageId` on the happy path, but that identity is persisted only after provider acceptance.

Current classification:

- reuse F159 — provider effect succeeds, local persistence failure can authorize duplicate retry;
- reuse J18/KF-REC-048 — OUTCOME_UNKNOWN/reconcile-first semantics;
- reuse F149 where provider rejection vs ambiguous transport outcome is relevant;
- no new J5 ID.

Also:

```text
sendStatus=SENT
```

is provider-send success/acceptance evidence, not proof of recipient delivery. Preserve the existing evidence ladder; do not relabel as business outcome.

---

## 7. Anti-duplication decision after Trace 001

```text
F223 allocated?                    NO
C173 allocated?                    NO
KF-REC-057 allocated?              NO
legacy scanner recurrence          F222 manifestation
MessageIntake duplicate collision  F222 manifestation + J18 pressure
KeyInbox reply crash window        F159/J18 reuse
KeyInbox human confirmation        J2/J15 pressure
AiOversight confidence override    anti-duplication review still open
```

Canonical ranges remain:

```text
F001–F222
C001–C172
KF-REC-001–KF-REC-056
next free F223 / C173 / KF-REC-057
```

---

## 8. Next microscopic trace

```text
1. anti-duplicate AiOversight confidence-as-auto-approval against all later J15/J6 governance findings;
2. trace MessageIntake approval lifecycle itself: approval resolution vs intake `approved/error` state and whether the human approval can resolve while plan execution fails;
3. trace KeyInboxActionExecutor state mutations through canonical domain owners (Contact/ContactTask/thread state) and confirm whether bypass is already owned by K6/J2/J15 findings;
4. trace Gmail/WhatsApp provider IDs and delivery callbacks into KeyInbox/CRM evidence — provider accepted vs delivered vs read/outcome;
5. trace real Meta Graph reply support gap (`NOT_SUPPORTED`) against J22/J13 rather than forcing it into F222;
6. continue reuse-first discipline before F223/C173/KF-REC-057.
```
