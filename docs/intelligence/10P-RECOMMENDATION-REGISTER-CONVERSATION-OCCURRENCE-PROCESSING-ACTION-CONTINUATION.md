# KeyFlowOS Recommendation Register — Conversation Occurrence, Processing & Action Continuation

Status: CANONICAL TARGET RECOMMENDATION
Date: 2026-09-10
Implementation evidence baseline: `main@8f173bfe79f1418159cf4099ea18b0d60d203ec2`
Production implementation remains READ-ONLY / UNAUTHORIZED.
Runtime proof has NOT been executed.

---

## KF-REC-057 — Conversation Occurrence, Processing & Action Contract

### Decision

KeyFlowOS should represent every externally-originating conversational occurrence as one canonical business-scoped occurrence whose processing policy, consumer claims, proposed actions, governance, execution and evidence remain causally linked without requiring one monolithic conversation engine.

The target contract is:

```text
AUTHENTICATED / TRUSTED CHANNEL OCCURRENCE
→ CURRENT TENANT-SCOPED CHANNEL BINDING
→ ConversationOccurrence
→ ConversationProcessingPolicyDecision
→ consumer-specific durable claims
→ interpretation / classification / suggestions
→ exact proposed business action(s)
→ generic authority + governance / Clearance
→ generic ExecutionClaim
→ domain/provider effects
→ EffectEvidence / ProviderEvidence
→ Delivery / Read / Rejection / Unknown evidence as actually supported
→ BusinessOutcome remains distinct
→ Business Graph / Genome consumes only evidence admitted under its own contract
```

### 1. ConversationOccurrence

A conversation occurrence is the canonical J5 boundary identity for an inbound or outbound conversational event.

Minimum identity should bind, where available:

```text
businessId
channel
current channel/connector binding generation
provider account / destination identity
provider occurrence/message id
direction
participant/contact resolution reference
conversation/thread reference
received/observed time
raw occurrence evidence reference
```

The same provider occurrence must not become separate semantic owners merely because KeyInbox, MessageIntake, legacy ConversationalAI, Temporal Flow, CRM or another consumer needs a projection.

Multiple projections are valid. Multiple uncoordinated effect owners are not.

### 2. ConversationProcessingPolicyDecision

For each canonical occurrence, KeyFlowOS should durably decide how that occurrence may be processed.

Candidate policy dimensions:

```text
persist/index only
analyze/classify
surface to human
propose actions
autonomous handling eligible
reply eligible
create CRM/work artifacts
ignore/quarantine/spam
consumer claim owner(s)
policy version + reason
```

This decision must be derived from current channel binding, tenant policy, source/channel, occurrence type and relevant product policy. It must not be inferred independently by each consumer.

### 3. Consumer-specific claims

Consumers may independently claim bounded responsibilities such as:

```text
analysis claim
classification claim
human-review claim
reply-planning claim
action-proposal claim
autonomous-handling claim
provider-send claim
```

Claims must bind to the canonical occurrence/action identity and be idempotent/recoverable through the generic execution/recovery kernel.

### 4. Governance remains external and authoritative

J5 must not create its own authorization semantics.

Conversation interpretation, model confidence, urgency, sentiment or classification confidence may affect recommendation/ranking but cannot satisfy a human/control requirement.

Before any material business action:

```text
exact action
→ effective human/KEY authority
→ required ControlEvidence
→ current Clearance
→ ExecutionClaim
→ effect
```

Conversation-specific services must consume the generic governance contract rather than reinterpret `autoApproved`, confidence or UI approval locally.

### 5. Connector/channel lifecycle is load-bearing

A provider-authenticated callback is not automatically process-authorized.

Every new normal occurrence/effect must also bind to a currently valid tenant-scoped channel/connector binding generation.

```text
CONNECTED generation N → may process under generation N
DISCONNECTED / REVOKED generation N → no new normal processing/effects under N
RECONNECTED → generation N+1 or equivalent new grant
```

Residual callbacks after revocation may be retained as audit/quarantine evidence but must not silently re-enter normal business processing.

Generic connector lifecycle mechanics remain owned by J13/K9/K7.

### 6. Conversation evidence vocabulary must be truthful

Do not collapse provider acceptance, delivery, reading and business outcome.

Recommended evidence ladder:

```text
PROPOSED
CLEARANCE_GRANTED
CLAIMED
SEND_ATTEMPTED
PROVIDER_ACCEPTED
DELIVERED      only with provider evidence
READ           only with provider evidence
REJECTED / BOUNCED / UNDELIVERABLE
UNKNOWN        when outcome certainty is lost
CUSTOMER_RESPONDED
BUSINESS_OUTCOME
```

Not every channel supports every state. Unsupported evidence must remain absent/unknown rather than invented.

### 7. Parent conversation action state must derive from child truth

Composite plans must not be `approved/executed/successful` merely because the orchestration function returned normally.

Parent state should derive from exact child outcomes under the generic recovery contract:

```text
all required children succeeded → SUCCEEDED
optional child failed           → PARTIAL / policy-defined result
required child failed           → FAILED / RECOVERY_REQUIRED
certainty lost                  → UNKNOWN / RECONCILE
```

J18/KF-REC-048 owns generic recovery semantics; J5 consumes them.

### 8. Outcome learning must preserve causal lineage

Conversation analytics may infer trends and signals, but Business Graph/Genome learning should be able to distinguish:

```text
customer said/requested X
KEY inferred X
KEY proposed action Y
human/KEY authorized Y
Y executed
provider accepted Y
customer received/responded
business outcome Z occurred
```

A conversation signal is not automatically a canonical business fact. Generic provenance and fact resolution remain owned by KF-REC-049/K4.

### 9. Target ownership boundary

KF-REC-057 owns only the J5 orchestration/boundary semantics:

```text
ConversationOccurrence identity
ConversationProcessingPolicyDecision
consumer-specific occurrence/action claims
conversation action causal linkage
conversation-facing provider/delivery evidence vocabulary
reference to current channel/session binding generation
```

It explicitly delegates:

```text
generic ingress authenticity/dedup/replay/acknowledgement → KF-REC-035 / J14
tenant and principal identity                              → K1 / K2
human authority / action governance / clearance           → J15 / K3
generic capability contracts                              → K5
domain state transitions                                  → K6
temporal/work/event primitives                            → K7
generic evidence/outcome model                            → K8 / KF-CONCEPT-042
connector lifecycle/runtime                               → J13 / K9
recovery/idempotency/execution claim                      → KF-REC-048 / J18 / K11
voice-specific transport/session security                 → J22
Business Graph / Genome resolution                        → KF-REC-049 / K4
operator attention                                        → KF-REC-051 / J17
```

### Findings pooled / pressure-tested

```text
F222 / C172 — contradictory conversation ownership/lifecycle semantics
F223 / C173 — model confidence used as control evidence
F224 / C174 — approval authority resolved after material effects
F225 / C175 — provider acceptance collapsed into SENT
F226 / C176 — execution-capable voice stream tenant binding weakness
F227 / C177 — connector disconnect not load-bearing revocation
```

Additional reuse pressure:

```text
F043/F054          direct Flow reachability
F149               provider rejection vs ambiguous transport
F152               non-throwing work is not proof of consequence success
F159               provider success/local persistence failure
KF-REC-035         ingress occurrence direction
KF-REC-048         certainty-aware recovery
KF-REC-049         knowledge provenance/fact resolution
KF-REC-051         operator attention
```

### Migration direction

Prefer incremental convergence:

1. establish canonical occurrence identity/adapters around current KeyInbox;
2. make processing policy explicit and durable;
3. convert MessageIntake/ConversationalAI paths into bounded consumers rather than parallel owners;
4. require generic Clearance + ExecutionClaim before material actions;
5. introduce truthful provider evidence states without falsely upgrading historical `SENT` rows;
6. bind occurrence/effect processing to current connector/channel lifecycle generation;
7. preserve existing domain services as effect owners where they are already authoritative;
8. add causal outcome linkage before using conversation results for autonomous learning.

Do not begin with a wholesale rewrite.

### Convergence status

`KF-REC-057` is **ALLOCATED / TARGET-CONTRACT CANDIDATE PENDING BACKWARD RE-AUDIT**.

J5 must remain ACTIVE / NOT YET PROVISIONALLY CONVERGED until backward re-audit against J14, J15, J18, J13, J22, J2, J16/K4, J17 and affected kernels verifies that this contract does not duplicate or contradict their ownership.

No production implementation is authorized by this recommendation.
