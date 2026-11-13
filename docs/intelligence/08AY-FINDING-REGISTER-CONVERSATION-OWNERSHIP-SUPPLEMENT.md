# KeyFlowOS Finding Register — Conversation Ownership Supplement

Status: CANONICAL CONTINUATION OF the KeyFlowOS finding register after F221.

Implementation evidence baseline: `main@8f173bfe79f1418159cf4099ea18b0d60d203ec2`.

Canonical sequence continues after F221.

---

## F222 — one conversational occurrence can be processed by multiple independent conversation-action fabrics without one canonical processing owner

**Status:** VERIFIED CROSS-COMPONENT / CONVERSATION-OWNERSHIP FINDING

J5 tracing found that a single external conversational occurrence can enter several semantically independent processing fabrics.

### WhatsApp path

`WhatsAppService.receiveInbound()` currently:

```text
resolve staff/customer identity
→ emit message.intake.received when messageIntakeEnabled
→ always persist the same customer message into KeyInbox
→ also persist WhatsApp-specific conversation history
```

Thus MessageIntake opt-in does not transfer ownership of the occurrence away from KeyInbox.

### MessageIntake path

`MessageIntakeOrchestrator.receive()`:

```text
external-id dedupe
→ resolve contact
→ MessageIntake row
→ classify
→ build proposed action plan
→ create AiApprovalItem
```

Its documented contract says the message is not written to the inbox until the user approves the plan. Yet the approved plan's first action is `create_thread_and_message`, while the channel adapter may already have persisted the inbound occurrence to KeyInbox before approval.

### Meta / ConversationalAI path

For legacy Meta DM-shaped `SocialEngagement` rows, `ConnectorIntelligenceService.scanMetaMessages()` can independently:

```text
emit message.intake.received
→ emit social events
→ publish agent-bus work
→ invoke ConversationalAIService.handleInboundMessage()
```

`ConversationalAIService` itself performs contact resolution, conversation recording, AI analysis and optional auto-approved tool execution through the Flow orchestrator.

Therefore one durable external occurrence can be:

```text
persisted/analyzed by KeyInbox
+ classified/held for approval by MessageIntake
+ independently reasoned/acted on by ConversationalAI
```

The defect is not the existence of multiple projections or specialist services. The defect is the absence of one canonical durable occurrence owner plus one explicit processing-policy/consumer-claim boundary.

### Target law

```text
ONE EXTERNAL CONVERSATIONAL OCCURRENCE
→ ONE CANONICAL DURABLE MESSAGE / OCCURRENCE IDENTITY
→ ONE EXPLICIT PROCESSING-POLICY DECISION
→ CONSUMER-SPECIFIC DURABLE CLAIMS
   - analysis
   - approval workflow
   - autonomous reasoning/action
   - reply/effect
→ projections may multiply
→ effect ownership may not
```

This finding is intentionally distinct from:

- F107: duplicate source-event delivery creating independent plans;
- F131: inbound provider replay crossing consequence branches before dedupe dominance;
- F159: provider effect succeeds but local persistence failure permits duplicate retry;
- F090: local evidence falsely claiming a send that never happened.

F222 concerns **parallel semantic processors over one already accepted conversational occurrence**.

Affected kernels: K3, K5, K6, K7, K8, K9, K11.
Affected journeys: J2, J5, J6, J14, J15, J18, J22.

No production implementation is authorized by this supplement.
