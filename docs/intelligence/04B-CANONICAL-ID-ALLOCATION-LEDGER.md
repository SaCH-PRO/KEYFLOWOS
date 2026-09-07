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
F197–F205 J3/J4 commercial-to-cash findings
F206–F209 J10 Commerce/Fulfilment active microscopic findings
```

```text
C096–C110 temporal/external/recovery lineage
C111–C116 initial J16/K4 contradictions
C117–C124 recovered historical collision-band contradictions
C125–C128 J16/K4 knowledge-consumption/learning/correction contradictions
C129–C134 J17 Command Center / operator-control contradictions
C135–C146 J7 Financial Truth contradictions
C147–C155 J3/J4 commercial-to-cash contradictions
C156–C159 J10 Commerce/Fulfilment active contradictions
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
KF-REC-053 Commercial Relationship & Obligation Contract
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

F185/C135 live cash ownership; F186/C136 multi-currency valuation; F187/C137 payroll financial outcome; F188/C138 PayPal capture consequence completeness; F189/C139 canonical financial source identity; F190/C140 provider webhook receipt vs consumption completeness; F191/C141 closed-history correction; F192/C142 accounting-period enforcement; F193/C143 ledger-writer bypass; F194/C144 gross vs net payment projection; F195/C145 CreditNote void convergence; F196/C146 parallel Invoice state machine.

Reused J7 recovery root: F155.

### KF-REC-052 — Financial Truth & Valuation Contract
Home: `10K-RECOMMENDATION-REGISTER-FINANCIAL-TRUTH-CONTINUATION.md`.

## J3 / J4 commercial-to-cash allocations

- F197 / C147 — commercial customer reality vs Contact lifecycle convergence — `08AF` / `09AF`.
- F198 / C148 — pipeline value plus realized revenue vs non-duplicative customer lifetime value — `08AF` / `09AF`.
- F199 / C149 — completed service vs missing required receivable consequence — `08AG` / `09AG`.
- F200 / C150 — service deposit vs final receivable settlement lineage — `08AH` / `09AH`.
- F201 / C151 — booking cancellation/no-show vs financial descendant disposition — `08AH` / `09AH`.
- F202 / C152 — RevenueAttribution pipeline stage vs realized revenue stage — `08AH` / `09AH`.
- F203 / C153 — canonical CRM statuses vs KeyCortex lowercase/non-canonical predicates — `08AH` / `09AH`.
- F204 / C154 — live post-booking journey event/tool contract mismatch — `08AI` / `09AI`.
- F205 / C155 — persisted Contact status has incompatible lifecycle / relationship-health dialects — `08AJ` / `09AJ`.

### KF-REC-053 — Commercial Relationship & Obligation Contract
Home: `10L-RECOMMENDATION-REGISTER-COMMERCIAL-RELATIONSHIP-OBLIGATION-CONTINUATION.md`.

Scope:
```text
customer relationship state algebra
+ commercial obligation lineage
+ commercial value-stage semantics
+ service financial disposition
+ expected consequence semantics
+ event-to-action schema composition
```

Delegation boundaries:
- knowledge provenance / EpistemicEligibility → KF-REC-049;
- financial/accounting truth → KF-REC-052;
- temporal projection → KF-REC-047;
- recovery certainty → KF-REC-048;
- attention/ranking → KF-REC-051;
- execution authority → K3.

Current local proof architecture: 28 proof obligations / 12 deterministic fault-injection points. Runtime proof not executed.

## J10 Commerce / Fulfilment allocations

- F206 / C156 — one successful storefront checkout has two mounted paid-invoice creation owners whose dedupe identities do not compose — `08AK` / `09AK`.
- F207 / C157 — operational order `CONFIRMED` emits `store_order.paid` while separate payment state can remain PENDING/UNPAID — `08AL` / `09AL`.
- F208 / C158 — native paid checkout decrements tracked stock while post-payment fulfilment routing applies a second reservation effect to the same sold units — `08AM` / `09AM`.
- F209 / C159 — aggregate `store_order.fulfillment_routed` is emitted even when required per-item FulfillmentRoute state is FAILED — `08AM` / `09AM`.

J10 currently reuses KF-REC-053 commercial lineage/state semantics, KF-REC-052 financial truth, and KF-REC-048 recovery semantics; no new recommendation allocated yet.

## Current ranges

```text
Findings:        F001–F209
Contradictions:  C001–C159
Recommendations: KF-REC-001–KF-REC-053
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
