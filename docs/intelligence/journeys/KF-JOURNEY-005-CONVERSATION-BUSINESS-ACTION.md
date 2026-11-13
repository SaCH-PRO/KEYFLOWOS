# KF-JOURNEY-005 — Conversation → Business Action

Status: **ACTIVE FIRST-PASS / MICROSCOPIC TRACE IN PROGRESS**

Implementation evidence baseline: `main@8f173bfe79f1418159cf4099ea18b0d60d203ec2`.

Production implementation remains **READ-ONLY / UNAUTHORIZED**.
Runtime proof has **NOT** been executed.

J5 was activated after J12 provisional convergence by comparing the remaining dossierless journeys for reachable native implementation footprint and cross-kernel leverage. It is currently the highest-leverage unpooled frontier because conversation intake reaches tenant binding, contact resolution, inbox state, AI analysis, approval/governance, direct capability execution, external messaging effects, evidence, events and recovery.

---

## A. Definition

J5 models how an external or operator conversation becomes business understanding and, where authorized, business action.

The target journey is not merely "receive a message" or "send a reply". It is:

```text
external conversational occurrence
→ authenticate / bind tenant / identify occurrence
→ resolve participant/contact/thread
→ durably represent the conversation once
→ analyze / classify / derive proposed action
→ select the declared processing policy
→ govern exact material business actions
→ claim execution where an effect is authorized
→ perform domain/provider effects
→ record outcome/evidence with causal identity
→ update the Business Graph / operator surface
```

J5 must preserve the distinction between:

```text
message persisted
!= message analyzed
!= action suggested
!= action approved
!= action claimed
!= action executed
!= provider accepted
!= delivered
!= business outcome
```

---

## B. Frontier-selection result

Dossierless candidates after J12 were J5, J8, J9, J13, J20, J21, J22 and J24.

J5 won the next-frontier comparison because its current reachable footprint crosses more already-mature kernels in one user-visible journey:

- K1/K2 tenant and participant identity;
- K3 governance/clearance;
- K5 capability execution;
- K6 state ownership;
- K7 event/workflow coordination;
- K8 evidence/outcome;
- K9 external integration;
- K11 recovery/idempotency;
- CRM / Business Graph / KEY reasoning surfaces.

J13 remains important, but much of generic connector ingress/recovery is already pooled through J14/J18. J22 is a specialized conversational transport and should pressure-test J5 later rather than define the conversation semantics first. J8/J9/J20/J21/J24 remain queued.

---

## C. First microscopic trace — current conversation fabrics

### 1. WhatsApp inbound

`WhatsAppService.receiveInbound()` currently:

```text
staff-position routing first
→ resolve CRM contact
→ emit entity.resolved
→ if messageIntakeEnabled:
     emit message.intake.received
  else:
     emit message.received
→ always ingest the same customer message to KeyInbox
→ also record WhatsApp-specific conversation history
```

Therefore enabling MessageIntake does not make MessageIntake the sole durable owner of the inbound occurrence. KeyInbox still persists/analyzes the message immediately.

### 2. MessageIntake approval fabric

`MessageIntakeOrchestrator.receive()`:

- dedupes by `(businessId, sourceChannel, externalId)` when external identity exists;
- resolves contact;
- creates `MessageIntake`;
- classifies the message;
- constructs a proposed multi-action plan;
- creates an `AiApprovalItem` using synthetic tool identity `message_intake_action`;
- stores the plan for later execution.

Its own contract states that the message is **not written to the inbox until a user approves the plan**.

However the first action in the approved plan is `create_thread_and_message`, while WhatsApp and Meta ingestion can already have written the same inbound occurrence to KeyInbox before approval.

### 3. KeyInbox fabric

`KeyInboxService.addMessage()` is a strong partial seam:

- canonical omnichannel thread/message store;
- lookup by `(businessId, channel, externalMessageId)`;
- DB-unique-conflict recovery for duplicate message insertion;
- transactional message + thread timestamp update;
- message/thread AI analysis;
- suggested actions and temporal events.

KeyInbox therefore already behaves like a candidate canonical conversational state owner, but current intake/action fabrics do not uniformly consume it as their single source occurrence.

### 4. Meta social inbound

`MetaSocialIngestionService.receiveInbound()`:

- parses real Meta Graph and legacy simplified payloads;
- checks KeyInbox external-message identity;
- resolves contact;
- writes KeyInbox;
- creates `SocialEngagement(aiHandled=false)` only for the legacy payload shape.

The shared Meta webhook authenticates the request, resolves tenant by connected page ID, and calls this ingestion service.

### 5. ConnectorIntelligence legacy Meta sweep

Every five minutes `ConnectorIntelligenceService.scanMetaMessages()` selects recent `SocialEngagement` rows with `aiHandled=false`.

For each matching DM it can independently:

- emit `message.intake.received` when MessageIntake is enabled;
- emit social engagement events;
- publish an agent-bus event;
- call `ConversationalAIService.handleInboundMessage()` fire-and-forget.

No transition to `aiHandled=true` is present in this scanner. Repository search found writers of `aiHandled=true` for other social-reply paths, but not for these scanned DMs.

This scanner-replay mechanism is currently held as a **candidate specialization** of the broader conversation-ownership root. It is not yet allocated a separate finding ID.

### 6. ConversationalAI auto-action fabric

`ConversationalAIService.handleInboundMessage()` independently:

- resolves/creates Contact;
- records inbound conversation history;
- detects a role;
- analyzes the customer message with an LLM;
- accepts model-supplied action/tool payloads;
- checks RoleEngine allowance;
- calls `AiOversightService.evaluateAutoApproval()`;
- for auto-approved actions above confidence 0.75, invokes `FlowOrchestratorService.executeToolDirectly()`;
- records conversation execution summary/outbound reply state;
- emits `conversation.handled`.

This means a conversational occurrence can reach real domain mutations without going through the MessageIntake approval workflow when this fabric is selected.

### 7. Operator/KEY outbound action fabric

`send_message_with_approval` in `FlowOrchestratorService`:

```text
resolve tenant-scoped Contact
→ AiMessageSenderService.sendMessage()
→ write CRM note
→ write activity log
→ return sent/failed status
```

`AiMessageSenderService` performs real Gmail/Resend/WhatsApp provider effects and records timeline/event evidence afterward.

The provider-effect / local-persistence crash window is already owned by recovery finding F159 and must not be duplicated in J5.

---

## D. Canonical first J5 root

### F222 / C172 — parallel conversation-processing ownership

One inbound conversational occurrence can currently be owned/processed by multiple independent fabrics depending channel, configuration and payload shape:

```text
Inbound occurrence
├─ KeyInbox persistence + analysis + suggestions
├─ MessageIntake classification + approval plan
└─ ConversationalAI direct auto-action path
```

Concrete pressure cases:

- WhatsApp with `messageIntakeEnabled=true` emits MessageIntake work **and** always persists to KeyInbox.
- the approved MessageIntake plan's first action intends to create the thread/message that the adapter already persisted;
- legacy Meta DM can be represented in KeyInbox, emitted to MessageIntake and independently processed by ConversationalAI through the scanner;
- real Meta Graph payloads do not create the legacy `SocialEngagement` row, so their downstream conversational behavior differs from the legacy path.

The defect is not "too many tables" by itself. The root is lack of one canonical occurrence owner plus one declared processing-policy boundary.

Target law:

```text
one external conversational occurrence
→ one canonical durable ConversationOccurrence / Message identity
→ one explicit processing-policy decision
→ consumer-specific durable claims for analysis / approval / autonomous action / reply
→ projections may multiply, effect ownership may not
```

Allocated homes:

- finding: `08AY-FINDING-REGISTER-CONVERSATION-OWNERSHIP-SUPPLEMENT.md`
- contradiction: `09AY-CONTRADICTION-REGISTER-CONVERSATION-OWNERSHIP-SUPPLEMENT.md`

No recommendation is allocated yet. J5 is not pooled or target-converged.

---

## E. Reused canonical findings / owners

J5 must reuse rather than recreate:

- F090 — false communication execution/sent evidence without provider effect;
- F099/F100 — outbound email effect ownership / queue replay weaknesses;
- F107 — duplicate source-event delivery can create independent plans;
- F131 — inbound WhatsApp replay ownership can occur after consequence branches;
- F136 — Chatwoot acknowledgement before durable acceptance / replay claim;
- F159 — provider effect succeeds but local persistence failure can authorize duplicate retry;
- J15 / K3 — exact-action control, approval and clearance semantics;
- J18 / KF-REC-048 — outcome certainty, retry and reconciliation semantics;
- J14 / KF-REC-035 direction — canonical ingress occurrence identity/processing.

F222 is **related but distinct**: it concerns multiple processors claiming different semantics over one already accepted conversational occurrence, not duplicate provider delivery, duplicate event delivery or post-provider retry ambiguity.

---

## F. Positive seams to preserve

- KeyInbox has a real external-message uniqueness boundary and conflict recovery.
- MessageIntake has a stable external-message uniqueness key when `externalId` exists.
- shared Meta webhook tenant routing by connected page identity is stronger than caller-declared tenant routing.
- `GraphActionsController.executeAction()` evaluates governance before calling the direct Flow executor; the direct executor is not inherently a bypass when the caller supplies the required gate.
- `AiMessageSenderService` performs real provider sends rather than merely fabricating local success state.

---

## G. Current contradiction / risk matrix

| Area | Current evidence | Current classification |
|---|---|---|
| canonical message identity | KeyInbox + MessageIntake each recognize external identity | partial strength |
| processing ownership | KeyInbox, MessageIntake, ConversationalAI may all process one occurrence | F222/C172 |
| approval-gated persistence | MessageIntake says inbox write waits for approval, adapters already persist | F222/C172 manifestation |
| legacy Meta consumption | scanner reads `aiHandled=false` repeatedly and does not consume it | candidate specialization; continue trace |
| real Meta action path | real Graph payload persists to KeyInbox but bypasses legacy SocialEngagement scanner | continue reachability trace |
| auto-action governance | `evaluateAutoApproval()` gates ConversationalAI direct executor | pressure J2/J6/J15; do not duplicate yet |
| outbound effect ownership | provider send precedes some local evidence writes | reuse F159 / F099 / F100 as applicable |
| runtime proof | not executed | OPEN |

---

## H. Immediate next microscopic work

```text
1. finish the exact legacy-Meta `aiHandled=false` recurrence trace and decide whether it is a specialization of F222 or a distinct F223 root;
2. trace real Meta Graph DM from KeyInbox analysis/suggested actions to any executable action/reply consumer;
3. trace MessageIntake approval -> executePlan under an already-persisted KeyInbox message, including transaction/error/state behavior;
4. inspect AiOversight.evaluateAutoApproval() and bind its semantics to J2/J6/J15 control findings;
5. trace outbound reply effect identity/provider certainty across Gmail, Resend, WhatsApp and KeyInbox reply sending;
6. reuse F001-F222 / C001-C172 / KF-REC-001-056 before any new allocation;
7. keep production code untouched and do not claim runtime proof.
```

J5 remains **ACTIVE / NOT CONVERGED**.
