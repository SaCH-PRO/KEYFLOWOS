# Finding Register Supplement — J12 Document Evidence Promotion Integrity

Status: CANONICAL
Last updated: 2026-09-07
Implementation evidence: `main@8f173bfe79f1418159cf4099ea18b0d60d203ec2`
Production implementation: READ-ONLY / UNAUTHORIZED

## F219 — Transient document assertions can become successful payment evidence without an explicit evidence-admission decision

### Owner

- Primary journey: `KF-JOURNEY-012 — Document / Evidence Lifecycle`
- Primary kernel: `K8 — Evidence & Outcome`
- Adjacent kernels/journeys: K4 Business Knowledge, K10 Financial Truth, K6 State Transition, J7 Financial Truth, J18 Recovery

### Reachable implementation path

```text
authenticated commerce payment-evidence request
→ CommerceController
→ PaymentEvidenceService.processEvidence()
→ DocumentIntelligenceService.extractFromDocument(...)
   OR raw-text fallback extraction
→ transient extracted payment-like assertion
→ no observed consumer-specific evidence-admission / verification gate
→ CommerceService.recordPayment(...)
→ Payment(status=SUCCESSFUL, providerId=MANUAL)
→ Invoice paidAmount/status mutation
→ revenue/ledger posting reconciliation
```

The fallback path can explicitly return `confidence: 0.3`, yet `processEvidence()` does not apply an observed confidence/verification/governance threshold before invoking `recordPayment()`.

### Why this is material

The extraction result is an inference/assertion about a source document. Parseability, field presence, or a confidence value does not itself prove that the asserted amount/reference/date represents qualifying payment-completion evidence for the target Invoice.

The reachable path can therefore produce a stronger durable financial claim than the source evidence has been shown to justify:

```text
DOCUMENT ASSERTION
→ Payment SUCCESSFUL
→ Invoice PARTIALLY_PAID / PAID
→ financial posting consequences
```

without a durable decision proving why that assertion was admissible for this consumer and this claimed state.

### Canonical law

> An extracted document assertion must not become qualifying payment-completion evidence merely because it contains parseable payment-like fields. Promotion must be explicit, consumer-specific, provenance-bearing, revision-bound and evidence-strength-aware.

The target does not require one universal document runtime. A bounded `EvidenceAdmissionDecision`/equivalent at the domain boundary is sufficient if it binds:

```text
source document identity + exact source revision
extraction/assertion occurrence + provenance/model/confidence
consumer + target business object
admission predicate/policy version
accepted/rejected asserted values
review/authority evidence when required
resulting domain effect identity
```

### Anti-duplication verdict

`RELATED DISTINCT` — allocate F219.

- `F175/F176` + `KF-REC-049` own generic epistemic/provenance eligibility and consumer-specific knowledge admission. They establish that inference/assertion is not authoritative truth, but do not themselves define this payment-evidence boundary manifestation.
- `F194` + `KF-REC-052` own the strength and downstream semantics of financial truth once payment evidence is consumed. They require financial state not to exceed its evidence, but do not make a transient document extraction a qualifying payment-evidence decision.
- `KF-REC-048` owns retry/replay certainty and stable effect identity, not whether an assertion is epistemically admissible in the first place.

F219 therefore owns only the cross-domain document/evidence **admission boundary**. It delegates generic epistemics to KF-REC-049, financial claim strength to KF-REC-052, and replay/effect identity to KF-REC-048.

### Replay note — no F220 allocation from this seam

The same payment evidence can be resubmitted while the Invoice remains non-terminal, and `recordPayment()` creates a fresh random manual `providerPaymentId`. That can create another `SUCCESSFUL` Payment and another financial consequence for the same semantic evidence.

This is a `SPECIALIZATION` of J18/KF-REC-048, whose recovery contract requires retry to preserve `WorkOccurrenceId + EffectId`, increments only `AttemptId`, and states that successful effect evidence prevents duplicate effect. Record this as cross-journey reinforcement; do not allocate F220 from the replay manifestation unless later evidence proves a distinct semantic owner.

### Failure / correction pressure

F219 must remain valid under:

- low-confidence extraction;
- false-positive regex fallback;
- ambiguous or multi-payment documents;
- corrected/replaced source documents;
- reprocessing with a different model/parser;
- source revision change;
- human correction/override;
- replay/retry;
- downstream invoice/ledger correction.

### Proof obligations for eventual implementation

- low-confidence or ambiguous assertions cannot silently become `SUCCESSFUL` payment evidence;
- accepted payment evidence is attributable to an exact source revision and extraction/assertion occurrence;
- admission/rejection is durable enough to explain the resulting financial state;
- correction/replacement can identify which domain effects depended on superseded evidence;
- retries/replays converge on one semantic effect identity rather than creating another payment.

No runtime proof was executed in this forensic pass.
