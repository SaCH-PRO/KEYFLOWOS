# KeyFlowOS Canonical ID Allocation Ledger

Status: CANONICAL — OVERRIDES LEGACY COLLIDING ALLOCATIONS
Last updated: 2026-09-06

Purpose: provide one unambiguous allocator for Finding (`F###`), Contradiction (`C###`) and Recommendation (`KF-REC-###`) identities.

## Governing rule

If any historical supplement still says `CANONICAL` for a colliding ID, **this ledger wins**. Historical evidence remains valuable; the old numeric heading is not a canonical allocation.

Never delete or reuse an allocated identity. Historical collisions resolve as REMAP or ALIAS/SUPERSEDED.

## Preserved mature lineage

```text
F145–F160 temporal/external/recovery lineage
F161–F166 initial J16/K4 epistemic-integrity findings
F167–F174 recovered historical collision-band findings
F175–F178 J16/K4 knowledge-consumption/learning/correction findings
F179–F184 J17 Command Center / operator-control findings
F185–F196 J7 Financial Truth findings
F197–F204 J3/J4 commercial-to-cash findings
```

```text
C096–C110 temporal/external/recovery lineage
C111–C116 initial J16/K4 contradictions
C117–C124 recovered historical collision-band contradictions
C125–C128 J16/K4 knowledge-consumption/learning/correction contradictions
C129–C134 J17 Command Center / operator-control contradictions
C135–C146 J7 Financial Truth contradictions
C147–C154 J3/J4 commercial-to-cash contradictions
```

```text
KF-REC-045 missed-schedule/lateness policy
KF-REC-046 workflow-definition versioning
KF-REC-047 Temporal Work Projection
KF-REC-048 certainty-aware Recovery Contract
KF-REC-049 provenance/revision-aware Business Knowledge Contract
KF-REC-050 load-bearing WorkDefinition control contract
KF-REC-051 Operator Attention & Priority Contract
KF-REC-052 Financial Truth & Valuation Contract
```

## Historical collision reconciliation

Governed by:
- `08O-FINDING-REGISTER-TAXONOMY-RECONCILIATION-SUPPLEMENT.md` — F167–F174;
- `09O-CONTRADICTION-REGISTER-TAXONOMY-RECONCILIATION-SUPPLEMENT.md` — C117–C124;
- `10I-RECOMMENDATION-REGISTER-TAXONOMY-RECONCILIATION-CONTINUATION.md` — KF-REC-050.

## J16 allocations

- F175 / C125 — epistemic readiness eligibility.
- F176 / C126 — epistemic prompt eligibility.
- F177 / C127 — causal learning attribution.
- F178 / C128 — knowledge correction lineage.

## J17 allocations

- F179 / C129 — Command Center projection completeness (`08S`/`09S`).
- F180 / C130 — Command spine false-terminal execution semantics (`08T`/`09T`).
- F181 / C131 — Temporal priority materialization reachability (`08U`/`09U`).
- F182 / C132 — CommandItem source-state convergence (`08V`/`09V`).
- F183 / C133 — Command Queue lifecycle visibility (`08W`/`09W`).
- F184 / C134 — priority semantic compression (`08X`/`09X`).

### KF-REC-051 — Operator Attention & Priority Contract
Home: `10J-RECOMMENDATION-REGISTER-OPERATOR-PRIORITY-CONTINUATION.md`.

## J7 allocations

### F185 / C135 — live cash ownership
Home: `08Y` / `09Y`.

### F186 / C136 — multi-currency valuation
Home: `08Y` / `09Y`.

### F187 / C137 — payroll financial outcome
Home: `08Y` / `09Y`.

### F188 / C138 — PayPal capture financial consequence completeness
Home: `08Z` / `09Z`.

### F189 / C139 — canonical financial source identity / CreditNote reversal reachability
Home: `08Z` / `09Z`.

### F190 / C140 — provider webhook receipt vs financial consumption completeness
Home: `08AA` / `09AA`.

### F191 / C141 — closed-period immutability vs later corrective consequence
Home: `08AA` / `09AA`.

### F192 / C142 — AccountingPeriod closure is not load-bearing at the ledger write door
Home: `08AB` / `09AB`.

### F193 / C143 — Expense void bypasses the canonical ledger/reversal writer
Home: `08AC` / `09AC`.

### F194 / C144 — gross-successful payment projection vs canonical net payment balance
Home: `08AD` / `09AD`.

### F195 / C145 — applied CreditNote VOID without descendant financial convergence
Home: `08AE` / `09AE`.

### F196 / C146 — parallel Invoice state machine introduced by CreditNoteService
Home: `08AE` / `09AE`.

### Reused J7 recovery root — F155

`PaymentsOpsService.refundCharge()` remains an instance of mature F155 and does not receive another J7 ID.

### KF-REC-052 — Financial Truth & Valuation Contract
Home: `10K-RECOMMENDATION-REGISTER-FINANCIAL-TRUTH-CONTINUATION.md`.

## J3 / J4 commercial-to-cash allocations

### F197 / C147 — commercial customer reality vs Contact lifecycle convergence
Home:
- `08AF-FINDING-REGISTER-CUSTOMER-LIFECYCLE-AND-VALUE-SUPPLEMENT.md`
- `09AF-CONTRADICTION-REGISTER-CUSTOMER-LIFECYCLE-AND-VALUE-SUPPLEMENT.md`

### F198 / C148 — pipeline value plus realized revenue vs non-duplicative customer lifetime value
Home: same `08AF` / `09AF` pair.

### F199 / C149 — completed service vs missing required receivable consequence
Home:
- `08AG-FINDING-REGISTER-SERVICE-COMPLETION-RECEIVABLE-SUPPLEMENT.md`
- `09AG-CONTRADICTION-REGISTER-SERVICE-COMPLETION-RECEIVABLE-SUPPLEMENT.md`

### F200 / C150 — service deposit vs final receivable settlement lineage
Home:
- `08AH-FINDING-REGISTER-COMMERCIAL-SERVICE-LINEAGE-SUPPLEMENT.md`
- `09AH-CONTRADICTION-REGISTER-COMMERCIAL-SERVICE-LINEAGE-SUPPLEMENT.md`

```text
DEPOSIT invoice D + completion FULL invoice P
!= one service obligation P with declared deposit settlement
```

### F201 / C151 — booking cancellation/no-show vs financial descendant disposition
Home: same `08AH` / `09AH` pair.

```text
Booking CANCELLED / NO_SHOW
!= deposit / invoice / payment / attribution disposition resolved
```

### F202 / C152 — RevenueAttribution pipeline stage vs realized revenue stage
Home: same `08AH` / `09AH` pair.

```text
BOOKING pipeline attribution + paid INVOICE attribution
!= directly additive realized revenue
```

### F203 / C153 — canonical CRM statuses vs KeyCortex lowercase/non-canonical predicates
Home: same `08AH` / `09AH` pair.

```text
LEAD | PROSPECT | CLIENT | LOST
!= lead | customer
```

### F204 / C154 — live post-booking journey event/tool contract mismatch
Home:
- `08AI-FINDING-REGISTER-JOURNEY-EVENT-CONTRACT-SUPPLEMENT.md`
- `09AI-CONTRADICTION-REGISTER-JOURNEY-EVENT-CONTRACT-SUPPLEMENT.md`

```text
BookingCompletedPayload { booking, contact?, businessId }
!= post-booking template flat contactId/serviceName/amount/bookingId/contactName expectations
!= commerce_create_invoice description/quantity/unitPrice tool-item contract
```

The runtime path is mounted through AgentTriggerService → JourneyOrchestrator → plan.approved → PlanExecutor → BullMQ → ActionDispatcher → FlowOrchestrator. The first invoice step is contract-incompatible, so the apparent downstream `Contact.status=CLIENT` automation does not falsify F197. A second valid invoice is not proven and is intentionally not canonized.

## Current ranges

```text
Findings:        F001–F204
Contradictions:  C001–C154
Recommendations: KF-REC-001–KF-REC-052
```

## Agent pre-allocation gate

```text
LOAD 04A + 04B
→ CHECK CURRENT ranges
→ SEARCH semantic equivalents
→ REUSE / REFINE / CROSS-REFERENCE
→ only then allocate next unused ID
→ one canonical home definition
→ update 04B + CURRENT + ROLLOVER
```

No production implementation is authorized by this ledger.
