# J5 Conversation → Business Action — Pre-Pooling Convergence Trace

Status: PRE-POOLING CONVERGENCE TRACE
Date: 2026-09-10
Implementation evidence baseline: `main@8f173bfe79f1418159cf4099ea18b0d60d203ec2`
Production implementation remains READ-ONLY / UNAUTHORIZED.
Runtime proof has NOT been executed.

## Purpose

Determine whether J5 has accumulated enough stable, non-duplicative architecture roots to pool into one conversation-specific target contract without creating parallel ingress, governance, connector-lifecycle, recovery, evidence or knowledge systems.

## Canonical J5 roots entering pooling

1. **F222 / C172 — conversation occurrence ownership**
   - KeyInbox, MessageIntake and ConversationalAI can process one external conversational occurrence under contradictory lifecycle/effect semantics.
   - Stable root: canonical occurrence identity + explicit processing policy + consumer-specific claims.

2. **F223 / C173 — model confidence substituted for control evidence**
   - ConversationalAI can execute after `evaluateAutoApproval()` returns autoApproved from model confidence even where the underlying decision still requires quick-confirm.
   - Stable root is governance-semantic, delegated to K3/J15; J5 must never reinterpret confidence as authority.

3. **F224 / C174 — approval authority resolved after effects**
   - MessageIntake can perform child effects before resolving the pending approval item and human approval tier.
   - Generalized Ingestion exhibits the same architectural pressure by creating an approval item yet permitting execution through its approval route without consuming that approval as a pre-effect clearance.
   - Stable root delegated to K3/J15; J5 must require clearance before material action.

4. **F225 / C175 — provider acceptance collapsed into SENT**
   - WhatsApp/Twilio/Meta and Gmail paths persist provider-accepted sends under `SENT`; no canonical delivery/read/rejection reconciliation was found in inspected paths.
   - Stable J5 evidence-state root: conversation UI/state must express the strongest evidence actually held.

5. **F226 / C176 — voice stream tenant/governance boundary**
   - Initial Twilio HTTP webhook has a positive fail-closed signature seam.
   - Downstream execution-capable WebSocket independently accepts URL `businessId` without observed equivalent stream-level authentication/trusted tenant derivation.
   - Stable specialization delegated to J22/J14/K1/K3/K9; J5 requires every consequential channel session to enter through authenticated, tenant-bound occurrence/session identity.

6. **F227 / C177 — connector disconnect is not load-bearing revocation**
   - WhatsApp disconnect flips ConnectorStatus to disconnected but retained routing/config can still admit a later valid callback into normal processing.
   - Stable lifecycle root delegated to J13/K7/K9; J5 must require a currently valid connector/channel binding generation before accepting new normal processing/effects.

## Recovery / aggregate-result re-audit

Observed:

- KeyInboxActionExecutor can return `{ success:false }` without throwing for unresolved contacts, empty drafts and unsupported actions.
- IngestionOrchestrator and legacy MessageIntake can aggregate per-child results under a parent workflow state.
- MessageIntake can record `message_intake.approved` with child success booleans.
- Error-state operator recovery is inconsistent; generalized Ingestion has a service-level error retry seam while legacy MessageIntake reviewing UI does not.

Classification:

```text
non-throwing child failure != successful parent consequence
```

This is already owned by J18 recovery/consequence-completeness lineage, especially F152 and KF-REC-048. No F228 is allocated.

## Outcome / learning loop re-audit

Positive evidence:

- KeyInbox emits durable BusinessEvents for message received/analyzed/action suggested and intelligence/genome-signal occurrences.
- `key_inbox.action_executed` / `key_inbox.action_failed` are emitted by the action controller.
- Conversation-derived material actions also mutate their owning domain state, which is available to broader business-state readers.
- KeyInbox intelligence aggregates message/thread behavior and can create Genome signal previews and Temporal occurrences.

Narrowing evidence:

- architecture event inventory reports `key_inbox.action_executed` with zero direct listeners.
- KeyInbox Genome signals are generated from periodic/report interpretation of conversation metrics/evidence, not a universal exact action→provider outcome→business outcome causal chain.
- MessageIntake timeline approval records are local audit projection and may coexist with partial child failure.

Verdict:

This is architecture pressure on K8 Evidence & Outcome and J18/KF-REC-048, but the inspected evidence does not justify a distinct F228. J5 target should require causal linkage from occurrence → processing decision → proposed action → clearance → execution claim → effect evidence → provider/delivery evidence → business outcome, while delegating generic evidence mechanics to K8.

## Connector lifecycle pressure verdict

F227 is genuinely distinct and remains stable. Connector authentication, tenant routing and lifecycle authority are separate predicates. J5 must not admit a new conversational occurrence merely because a provider signature and tenant mapping are valid if the connector binding generation has been revoked.

## Pooling decision

**READY TO ALLOCATE KF-REC-057**, subject to backward re-audit.

Candidate contract name:

`KF-REC-057 — Conversation Occurrence, Processing & Action Contract`

### Contract should own

```text
ConversationOccurrence identity at the J5 boundary
ConversationProcessingPolicyDecision
consumer-specific processing/effect claims for the occurrence
conversation action causal linkage
conversation-facing evidence vocabulary (accepted/delivered/read/rejected/unknown)
channel/session binding reference used by the occurrence
```

### Contract must delegate

```text
generic external ingress occurrence/authenticity/replay/ack → KF-REC-035 / J14
human authority / exact action governance / clearance       → J15 / K2 / K3
generic capability identity and execution                   → K5 / K6
generic execution claims / retry / certainty recovery       → KF-REC-048 / J18 / K11
connector connect/disconnect/reconnect lifecycle             → J13 / K9 / K7
voice transport/session authentication                       → J22 / K1 / K9
generic evidence/provenance/business outcome semantics       → K8 / KF-CONCEPT-042
Business Graph / Genome fact resolution                      → KF-REC-049 / K4
operator attention                                           → KF-REC-051 / J17
```

The J5 contract must be an orchestration/boundary contract, not a second governance engine, connector runtime, event store, recovery runtime, Business Graph or Genome.

## Next gate

Allocate KF-REC-057, then backward re-audit it against J14, J15, J18, J13, J22, J2, J16/K4, J17 and K1/K3/K5/K7/K8/K9/K11 before declaring J5 provisionally converged.
