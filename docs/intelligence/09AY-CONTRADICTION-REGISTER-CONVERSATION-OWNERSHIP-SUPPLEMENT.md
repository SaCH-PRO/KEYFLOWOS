# KeyFlowOS Contradiction Register — Conversation Ownership Supplement

Status: CANONICAL CONTINUATION OF the KeyFlowOS contradiction register after C171.

Implementation evidence baseline: `main@8f173bfe79f1418159cf4099ea18b0d60d203ec2`.

Canonical sequence continues after C171.

---

## C172 — one inbound message has contradictory processing-state semantics across live conversation fabrics

**Status:** VERIFIED CROSS-COMPONENT CONTRADICTION

The current system can treat the same external conversational occurrence as all of the following at once:

```text
A. already durably persisted and AI-analyzed in KeyInbox
B. not yet written to the inbox because MessageIntake is waiting for human approval
C. eligible for an independent ConversationalAI reasoning / auto-action pass
```

Concrete contradiction:

- `WhatsAppService.receiveInbound()` emits `message.intake.received` when MessageIntake is enabled **and still always writes the message to KeyInbox**.
- `MessageIntakeOrchestrator` documents that the message is not written to the inbox until the proposed plan is approved, and its approved plan begins with `create_thread_and_message`.
- legacy Meta DM rows can additionally be selected by `ConnectorIntelligenceService` and passed directly into `ConversationalAIService`, which can independently evaluate and execute business actions.

These are not merely different projections of one state. They assign incompatible ownership and lifecycle meaning to the same occurrence:

```text
PERSISTED / ANALYZED
vs
PENDING APPROVAL BEFORE PERSISTENCE
vs
AUTONOMOUSLY PROCESSABLE
```

This contradiction makes user-visible and recovery semantics dependent on which fabric observes the occurrence rather than on one canonical processing policy.

Target reconciliation:

```text
canonical ConversationOccurrence
+ explicit processing policy
+ consumer-specific claims/states
```

The canonical durable message may exist immediately while approval is pending; what must remain pending is the governed **business action/effect**, not whether the external message exists. Conversely, autonomous processing must be an explicit policy branch over the same occurrence identity rather than an independent second interpretation of the message lifecycle.

Canonical finding root: F222.

Affected kernels: K3, K5, K6, K7, K8, K9, K11.
Affected journeys: J2, J5, J6, J14, J15, J18, J22.

No production implementation is authorized by this supplement.
