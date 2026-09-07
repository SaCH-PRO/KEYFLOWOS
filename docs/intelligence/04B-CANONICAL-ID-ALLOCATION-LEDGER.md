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
F185–F191 J7 Financial Truth findings
```

```text
C096–C110 temporal/external/recovery lineage
C111–C116 initial J16/K4 contradictions
C117–C124 recovered historical collision-band contradictions
C125–C128 J16/K4 knowledge-consumption/learning/correction contradictions
C129–C134 J17 Command Center / operator-control contradictions
C135–C141 J7 Financial Truth contradictions
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
Home:
- `08Y-FINDING-REGISTER-FINANCIAL-TRUTH-SUPPLEMENT.md`
- `09Y-CONTRADICTION-REGISTER-FINANCIAL-TRUTH-SUPPLEMENT.md`

Distinct root:

```text
ledger-derived cash movement/balance
!= FinancialAccount.currentBalance initialized from opening balance
```

`currentBalance` is initialized but not maintained by posting, while SafeToSpend and other product surfaces consume it as live cash.

### F186 / C136 — multi-currency valuation
Home: same `08Y` / `09Y` pair.

Distinct root:

```text
currency-specific LedgerEntry amounts
!= directly additive account/report values without valuation
```

Posting preserves currency, while LedgerBalance groups/sums by account without currency separation or FX conversion.

### F187 / C137 — payroll financial outcome
Home: same `08Y` / `09Y` pair.

Distinct root:

```text
PayrollRun.status = PAID
!= payment/disbursement proved
!= accounting consequence posted
```

`markRunPaid()` currently updates PayrollRun status/timestamp only.

### F188 / C138 — PayPal capture financial consequence completeness
Home:
- `08Z-FINDING-REGISTER-FINANCIAL-CONSEQUENCE-COMPLETENESS-SUPPLEMENT.md`
- `09Z-CONTRADICTION-REGISTER-FINANCIAL-CONSEQUENCE-COMPLETENESS-SUPPLEMENT.md`

Distinct root:

```text
provider capture COMPLETED
+ Payment SUCCESSFUL
+ Invoice PAID
!= payment ledger consequence complete
```

The direct PayPal capture path creates a successful Payment and reconciles the Invoice without using `createPaymentWithPosting()`. The later webhook sees the same provider capture ID and dedupes before the missing posting is repaired.

F188 is distinct from F158: F158 has failed local Payment persistence after provider success; F188 has successful Payment persistence with an omitted mandatory accounting consequence.

### F189 / C139 — canonical financial source identity / CreditNote reversal reachability
Home: same `08Z` / `09Z` pair.

Distinct root:

```text
canonical invoice posting sourceType = 'Invoice'
!= CreditNote reversal lookup sourceType = 'INVOICE'
```

A valid canonical invoice posting can exist while `CreditNoteService.apply()` cannot discover its lineage. Financial source discriminators must be canonical/typed enough for posting, reversal, reconciliation, reporting and repair to resolve the same business consequence.

### F190 / C140 — provider webhook receipt vs financial consumption completeness
Home:
- `08AA-FINDING-REGISTER-FINANCIAL-CONSUMPTION-AND-CLOSED-PERIOD-SUPPLEMENT.md`
- `09AA-CONTRADICTION-REGISTER-FINANCIAL-CONSUMPTION-AND-CLOSED-PERIOD-SUPPLEMENT.md`

Distinct root:

```text
WebhookEvent receipt persisted
!= provider occurrence consumption complete
!= financial descendants complete
```

Stripe, PayPal and WiPay persist `(provider, providerEventId)` before downstream financial consequences. Redelivery is then treated as duplicate even when first-attempt consequences failed or were swallowed. No independent WebhookEvent processing lifecycle/re-drive owner was found in the repository search for this tranche.

### F191 / C141 — closed-period immutability vs later corrective consequence
Home: same `08AA` / `09AA` pair.

Distinct root:

```text
original reconciled LedgerEntry locked
!= later current-period reversal must be prohibited
```

`PostingService.reverse()` intends to create a new reversal dated now, but first rejects any original transaction containing reconciliation-locked entries. `ReconciliationService` states admin override is required, while repository search found no unlock/reopen operation or separate current-period adjustment path.

### Reused J7 recovery root — F155

`PaymentsOpsService.refundCharge()` remains an instance of mature F155 and does **not** receive another J7 ID:

```text
provider refund succeeds
→ REFUNDED Payment exists
→ ledger/invoice consequences omitted
→ webhook dedupe suppresses missing consequence repair
```

### KF-REC-052 — Financial Truth & Valuation Contract
Home: `10K-RECOMMENDATION-REGISTER-FINANCIAL-TRUTH-CONTINUATION.md`.

Distinct responsibility:

```text
commercial/operational financial state
→ external money reality
→ KeyFlow money-movement record
→ accounting truth
→ reconciliation truth
→ valuation truth
→ derived financial/operator projection
```

Target preserves the strong PostingService/reversal/reconciliation seams while preventing stored balances, operational statuses, raw heterogeneous currencies, receipt-only idempotency and closed-period policy gaps from silently competing with reconciled financial truth.

## Current ranges

```text
Findings:        F001–F191
Contradictions:  C001–C141
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
