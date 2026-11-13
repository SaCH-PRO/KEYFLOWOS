# J5 Conversation → Business Action — Voice / Recovery Pressure Trace 003

Status: DURABLE INVESTIGATION / J5 ACTIVE
Last updated: 2026-09-09
Implementation evidence baseline: `main@8f173bfe79f1418159cf4099ea18b0d60d203ec2`
Production implementation authorized: **NO**
Runtime proof executed: **NO**

Purpose: preserve the post-F225 J5 pressure test against generalized ingestion recovery and J22 KEY Voice without duplicating mature J18/J14/J15 roots.

---

## 1. MessageIntake error-state recovery

Legacy MessageIntake execution can enter `error` after partial effects or governance-resolution failure.

The live `MessageIntakeQueue` fetches only `status=reviewing` and exposes approve/reject only for reviewing items. Therefore an errored item disappears from the ordinary approval surface and no explicit retry/reconcile control is present there.

Classification:

```text
new root? NO
owner: J18 / KF-REC-048 recovery pressure
```

Seeing an error row is not the same as owning a safe recovery occurrence.

---

## 2. Generalized IngestionOrchestrator is a partial recovery seam

The newer generalized ingestion fabric allows `execute()` from both `reviewing` and `error`, which is stronger than the legacy MessageIntake state gate.

However the Data Inbox approve route calls execution directly. The ingestion plan creates an `AiApprovalItem`, but the observed Data Inbox execution path does not resolve that pending approval/authority as the pre-effect authorization boundary.

Classification:

```text
error-state retry ability          = favorable partial seam
pre-effect approval/authority      = still absent in observed route
canonical root                     = strengthens F224/C174
new finding                        = NO
```

---

## 3. Aggregate child failure vs parent success

Both intake fabrics contain child actions that may return `success:false` without throwing.

The parent execution lifecycle can nevertheless progress to an approved/executed state when the outer loop itself does not throw.

Anti-duplication against J18:

- F152 already establishes `handler returned != inverse effect confirmed`;
- F155 establishes `effect dedupe != consequence completeness`;
- F157 establishes parent re-execution cannot mean replay every child;
- KF-REC-048 owns certainty-aware original/recovery outcome and consequence-completeness semantics.

Decision:

```text
F227/C177 allocated? NO
classification: J18 consequence-completeness / recovery-contract reuse
```

J5 should require explicit aggregate outcome semantics in its target contract but should not create a parallel recovery architecture.

---

## 4. J22 KEY Voice pressure test — authenticated HTTP ingress, weaker realtime stream

Positive seam:

`PhoneVoiceController` authenticates the initial Twilio HTTP voice webhook using Twilio signature verification and fails closed unless an explicit development bypass is enabled. Existing test source explicitly guards against leaking a stream URL for an arbitrary business ID to an unverified caller.

Distinct downstream seam:

`PhoneVoiceService` registers a raw WebSocket upgrade handler at `/api/voice/stream` and reads:

```text
businessId = URL.searchParams.get('businessId')
```

No equivalent stream-level Twilio signature, signed stream capability/token, provider account/phone mapping, or durable VoiceSession claim was observed before upgrade.

The realtime session exposes booking/helpdesk tools and can call Flow tool execution using that businessId.

This is canonicalized as:

```text
F226 / C176
```

Runtime exploitability has not been reproduced; network/proxy/provider constraints remain proof questions.

---

## 5. Voice evidence/session split

The active `PhoneVoiceService` collects an in-memory transcript and on stop/close calls:

```text
keyCallSession.updateMany(where: { callSid }, transcript, endedAt)
```

It does not create a `KeyCallSession` in the inspected active realtime service.

A separate `KeyCortexPhoneService` contains richer session lifecycle logic:

- inbound tenant resolution from the called number;
- `KeyCallSession.create()`;
- outbound call creation with status callbacks;
- history, transcript, summary/outcome fields.

But repository search in this pass found no production caller/controller for `KeyCortexPhoneService.handleIncomingCall()`. Therefore this older/richer service is not yet treated as an equally reachable competing owner.

Decision:

```text
parallel voice lifecycle finding allocated? NO
active service session persistence gap       = pressure F226/J22 + J18 evidence
older KeyCortexPhoneService                  = reachability unresolved / do not assume active
```

---

## 6. Current J5 canonical roots after Trace 003

```text
F222/C172  canonical conversation occurrence / processing ownership
F223/C173  model confidence is not control evidence
F224/C174  approval authority/control must precede effects
F225/C175  provider acceptance is not delivery/read/business outcome
F226/C176  consequential realtime voice transport needs authenticated session + trusted tenant binding
```

Reused mature contracts:

```text
J14 / KF-REC-035 → authenticated ingress occurrence / trusted tenant binding direction
J15 / K3         → exact-action governance / clearance
J18 / KF-REC-048 → recovery certainty / consequence completeness / reconcile-first
F043/F054        → generic direct Flow reachability outside universal governance choke point
F149             → rejection vs ambiguous transport outcome
F159             → provider-success/local-persistence-failure retry hazard
```

---

## 7. Next pre-pooling work

```text
1. pressure-test J13 connector lifecycle against conversation occurrence identity, provider callback registration and deauthorization/disconnect semantics;
2. trace active PhoneVoice session occurrence/evidence lifecycle far enough to decide whether F226 is sufficient or whether a distinct durable-session root exists;
3. trace J5 outcome convergence into CRM / Timeline / Business Graph / Genome;
4. decide whether the five stable J5 roots can pool under KF-REC-057 without inventing a parallel ingress, governance, evidence or recovery kernel;
5. if pooling, explicitly delegate generic ingress to KF-REC-035, governance to J15/K3, recovery to KF-REC-048 and business knowledge to KF-REC-049;
6. production stays untouched and runtime proof remains unexecuted.
```
