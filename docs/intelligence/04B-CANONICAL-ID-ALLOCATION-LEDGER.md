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
F197–F199 J3/J4 commercial-to-cash findings
```

```text
C096–C110 temporal/external/recovery lineage
C111–C116 initial J16/K4 contradictions
C117–C124 recovered historical collision-band contradictions
C125–C128 J16/K4 knowledge-consumption/learning/correction contradictions
C129–C134 J17 Command Center / operator-control contradictions
C135–C146 J7 Financial Truth contradictions
C147–C149 J3/J4 commercial-to-cash contradictions
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

```text
Deal WON / Quote accepted+converted / Invoice PAID / StoreOrder PAID
!= Contact.status automatically converged to CLIENT
```

Core revenue events can establish strong customer evidence while `Contact.status` remains LEAD. Multiple CRM/People/OS consumers nevertheless treat `CLIENT` as operative customer classification. Manual `updateContact()` and AI template writes do not constitute a domain-owned lifecycle convergence contract.

### F198 / C148 — pipeline value plus realized revenue vs non-duplicative customer lifetime value
Home: same `08AF` / `09AF` pair.

```text
won Deal value + PAID Invoice total
!= non-duplicative customer lifetime value
```

`ContactInsightService` adds won deal value and paid invoice total even when they can represent the same economic sale. Refund/valuation weaknesses reuse J7 F194/F186; the distinct J3 root is pipeline/conversion value being added to realized revenue as independent customer value.

### F199 / C149 — completed service vs missing required receivable consequence
Home:
- `08AG-FINDING-REGISTER-SERVICE-COMPLETION-RECEIVABLE-SUPPLEMENT.md`
- `09AG-CONTRADICTION-REGISTER-SERVICE-COMPLETION-RECEIVABLE-SUPPLEMENT.md`

```text
Booking.status = COMPLETED
+ completion-time invoicing required
!= Invoice consequence durably created or durably owed
```

Booking completion commits before auto-invoice generation. The helper catches invoice-generation/linking failure and only logs it, so a required receivable consequence can disappear without a durable recovery owner. This specializes J18/J23 incomplete-descendant recovery semantics and does not imply service completion must be financially atomic.

## Current ranges

```text
Findings:        F001–F199
Contradictions:  C001–C149
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
