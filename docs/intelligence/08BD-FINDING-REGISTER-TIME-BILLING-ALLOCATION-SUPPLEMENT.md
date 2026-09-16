# Finding Register - Source Time to Invoice Allocation

Status: CANONICAL SUPPLEMENT  
Checkpoint: `J8-CSB-2026-09-16-01`  
Date: 2026-09-16  
Implementation evidence: `main@8f173bfe79f1418159cf4099ea18b0d60d203ec2`  
Production implementation: READ-ONLY / UNAUTHORIZED.

## F228 - Time billing can omit selected source value from invoice lines while marking every selected entry billed

**Classification:** VERIFIED STATIC SOURCE / NUMERICAL COUNTEREXAMPLE; NOT RUNTIME-REPRODUCED.

Primary kernel: K10 Financial Truth. Primary journey: J8 Project / Work Delivery. Adjacent: J7, J3, J18; K6/K8/K11.

### Exact source

`apps/server/src/modules/time-tracking/time-entry.service.ts`, `invoiceUnbilledTime`, baseline blob `f9acbf100ad2181c703faad7a9450e7742096d9f`.

Full trace: [J8 M002 section 5](investigations/J8-PROJECT-WORK-DELIVERY-MICROTRACE-002.md#5-time-to-invoice-exact-source-allocation-must-survive).

The grouping loop looks up only the base display label. On a differing hourly rate it sets a suffixed key using the current entry's minutes, without first accumulating any group already stored at that suffixed key. A second entry at that alternate rate therefore replaces the previous alternate-rate entry's minutes.

With the same label and chronological entries:

| Entry | Minutes | Hourly rate | Pre-tax source value |
|---|---:|---:|---:|
| A | 60 | 100 | 100 |
| B | 30 | 200 | 100 |
| C | 45 | 200 | 150 |
| Total | 135 | | 350 |

The resulting groups represent A's 60 minutes and C's 45 minutes, not B's additional 30 minutes. Invoice lines therefore represent 105 minutes and 250 pre-tax units. All three original IDs still enter markAsBilled; if invoice creation and marking succeed, the count equals three and the method can return normally. Its totalMinutes is derived from the original entries and can still report 135.

The example uses exactly representable hundredths-of-hour quantities, so it does not depend on tax, discounts, FX or disputed rounding behavior. No actual invoice, customer loss, provider event or test run is asserted.

### Violated invariant

```text
Every source entry marked billed has a reconstructable allocation into
that billing occurrence's priced invoice lines under the declared policy.
```

ID-count equality and an original-selection minutes total do not establish allocation completeness or value conservation.

### Anti-duplication decision

RELATED DISTINCT. Reviewed against J7 F185-F196 definitions (J7 dossier, 08Z, 08AA-08AE), F200's commercial-deposit lineage (08AH), REC052 and the retained J10/J18 required-consequence laws. Those cover financial layer truth, currency aggregation, posting/reversal/projection integrity and missing/replayed consequences. This defect instead destroys source value during commercial-line construction even when the later invoice, billed flags and accounting can all succeed consistently with the wrong constructed lines.

F228 does not absorb all task-completion, assignment, approval or provider-retry defects. The separate create-invoice-before-mark partial-outcome path continues to consume REC048/K11 recovery and K10 correction semantics. A common solution may address both, but their causal claims remain distinct.

### Target and migration consequence

Use typed grouping coordinates and preserve exact source-entry revision/allocation identity. Validate unit and gross-value conservation under an explicit precision/rounding policy before finalizing billed linkage. Exclusive source allocation and canonical invoice creation need the shared transaction/claim boundary specified in [the J8 contract review](investigations/J8-COMPLETION-SCOPE-AND-BILLING-CONTRACT-REVIEW.md#6-billing-allocation-contract).

Historical billed rows with unclear line allocation must be reconciled; do not automatically re-invoice them or silently edit issued documents. No new ledger, pricing SDK or database migration is authorized here.

### Proof status

M002 Y05 is the designed repeated-alternate-rate conservation case; Y06/Y07 cover distinct claim/revision/partial-outcome pressures. Existing `invoice-unbilled-time.spec.ts` (blob `7a6f356c38918e943357204bee4803551c592202`) covers one entry per alternate rate, not this repeated alternate-rate shape. It was read, not executed or modified.

Runtime, concurrency and migration proof: NOT_EXECUTED. Finding allocation is not evidence that the app has been fixed.
