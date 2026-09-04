# KF-KERNEL-010 — Financial Truth

Status: ACTIVE / INITIAL CONVERGENCE / INSTANTIATED FROM J18-K9-K8 EVIDENCE PRESSURE

Implementation evidence baseline: `main@d7c5b86cfa276d75ffa42d5f1707c43704dc9f21`
Current audit-only head: `168732d0e2226e11ed033c14fbdf7b3ea5344a41`
Production implementation remains unauthorized.

---

## A. Definition / Scope

K10 owns the invariants that make monetary state **economically truthful** across:

- provider payment/capture/refund/settlement evidence;
- Payment rows and payment identity;
- double-entry ledger postings/reversals;
- invoice balance/status reconciliation;
- credits/refunds/voids/reversals;
- storefront/order payment state where monetary truth is involved;
- financial correction/recovery;
- reconciliation between external provider reality and internal accounting state.

K10 does **not** own provider transport semantics (K9), generic evidence representation (K8), workflow timing (K7), generic recovery ownership (K11), or authorization (K3). It owns whether those inputs produce a coherent financial truth.

---

## B. Product Intent

KeyFlowOS should answer, without contradiction:

```text
Was money actually captured/refunded/settled?
Which provider operation proves that?
What local Payment evidence represents it?
What ledger entries represent the economic movement?
What invoice/order balance follows from those movements?
Was a reversal complete or only partially recorded?
Can the same financial effect be replayed safely?
What must be repaired if one consequence failed?
```

A business should never see “refunded” while the ledger and invoice still represent the original settled economic state without an explicit reconciliation warning.

---

## C. Truth Ownership

Canonical distinctions:

```text
PROVIDER PAYMENT / REFUND
!=
LOCAL Payment ROW
!=
LEDGER POSTING / REVERSAL
!=
INVOICE / ORDER BALANCE STATE
```

These truths are linked but not interchangeable.

Financial truth is converged only when all required consequences of one monetary occurrence agree.

Core law:

```text
EXTERNAL FINANCIAL EFFECT
→ Payment evidence
→ ledger consequence
→ receivable/order/balance reconciliation
→ financial OutcomeEvidence
```

A failure in a later consequence does not mean the earlier external financial effect did not happen.

---

## D. Current Implementation Sources

Primary current seams include:

- `PaymentsService` provider checkout/capture/webhook handling;
- `PaymentsOpsService` provider operations/refunds;
- `CommerceService` local payment/refund operations;
- `InvoiceWorkflowService` balance/status reconciliation;
- `RevenuePostingService` / posting/ledger machinery;
- provider refund `createRefundWithPosting()` paths;
- storefront `StoreOrderService` payment-state transitions;
- Stripe / PayPal / WiPay connectors and provider lifecycle evidence;
- credit/void/reversal domain services where applicable.

Positive existing seams should be strengthened rather than replaced.

---

## E. Inputs

- businessId / financial entity identity;
- invoice/order/payment identity;
- provider operation/capture/refund ID;
- EffectId / RecoveryEffectId;
- amount/currency;
- provider settlement/refund status;
- Payment evidence;
- ledger external reference;
- current invoice/order balance;
- reversal/credit/refund reason;
- reconciliation evidence;
- current authority/Clearance for a financial mutation.

---

## F. Outputs / Consumers

- canonical payment/refund evidence;
- ledger posting or reversal;
- reconciled invoice/order balance/status;
- financial OutcomeEvidence;
- financial RecoveryOutcomeEvidence;
- Business Graph revenue/cash/receivable truth;
- analytics/reporting/tax consumers;
- operator recovery projection;
- KEY reasoning/readiness.

---

## G. State / Transition Semantics

Financial effect lifecycle:

```text
PAYMENT / REFUND INTENT
→ provider operation
→ PROVIDER_ACCEPTED | OUTCOME_UNKNOWN | FAILED_BEFORE_EFFECT
→ provider financial outcome
→ local Payment evidence
→ ledger posting/reversal
→ invoice/order reconciliation
→ FINANCIAL_TRUTH_CONVERGED
```

When provider outcome is known but local consequences are incomplete:

```text
PROVIDER_SUCCESS_CONFIRMED
→ CONSEQUENCE_INCOMPLETE
→ idempotent repair/reconciliation
→ FINANCIAL_TRUTH_CONVERGED
```

Do not regress to provider failure merely because a local database write failed afterward.

---

## H. Journey Impact Matrix

Primary:

- J3 Lead → Customer → Cash;
- J4 Booking → Service → Payment;
- J7 Financial Truth;
- J10 Commerce/Fulfilment;
- J14 External Event Ingress;
- J18 Failure → Recovery;
- J23 Temporal Flow.

Materially affects J2, J6, J15, J17 and Business Graph/Genome consumers.

---

## I. Canonical Vocabulary / Contracts

- FinancialOccurrenceId
- PaymentId
- ProviderPaymentId / CaptureId / RefundId
- EffectId
- RecoveryEffectId
- LedgerPostingId / ExternalRef
- InvoiceBalance
- Settlement
- Refund
- Reversal
- Credit
- Void
- Reconciliation
- ConsequenceIncomplete
- FinancialOutcomeEvidence
- FinancialRecoveryOutcomeEvidence

---

## J. Authority / Governance

Financial recovery is not automatically authorized by the original financial action.

```text
retry same payment/refund EffectId within explicit retry scope
→ may continue bounded recovery authority

new refund / reversal / credit / compensation
→ new RecoveryEffectId
→ current financial authority
→ proportional ControlRequirement
→ fresh Clearance where material
```

Failure or customer dissatisfaction does not itself grant refund authority.

---

## K. Transactions / Concurrency / Idempotency

K10 adopts:

```text
EFFECT DEDUPE
!=
CONSEQUENCE COMPLETENESS
```

A provider refund ID should prevent a second external refund but **must not** suppress:

- missing local Payment evidence;
- missing ledger reversal;
- missing invoice reconciliation.

Financial consequence handlers should be idempotent independently where feasible.

Provider-native idempotency tokens bind to stable KeyFlow EffectId / RecoveryEffectId where provider contracts support it.

A local `Payment.status=PENDING` row is not sufficient retry ownership.

---

## L. Failure / Recovery

Must handle:

- provider capture succeeds, local Payment persistence fails;
- Payment row succeeds, ledger posting fails;
- ledger posts, invoice reconciliation fails;
- provider refund succeeds, local reversal consequences fail;
- webhook arrives after manual provider operation;
- webhook dedupe encounters incomplete local consequences;
- provider timeout after possible capture/refund;
- duplicate provider webhooks;
- concurrent manual/provider reconciliation;
- partial refund and subsequent additional refund;
- refund/reversal after original authority changed;
- operator retry request with no executable provider recovery owner.

Target recovery states include:

```text
OUTCOME_UNKNOWN
PROVIDER_SUCCESS_CONFIRMED_CONSEQUENCE_INCOMPLETE
RECONCILING
FINANCIAL_TRUTH_CONVERGED
FAILED_FINAL_CONFIRMED
```

These can be semantic projection states over existing records rather than one new table.

---

## M. Security / Privacy

- tenant-bind every financial/provider identity;
- require proportional authorization for payment/refund/credit operations;
- protect provider credentials and payment identifiers;
- avoid storing sensitive payment data beyond provider/tokenized references;
- audit financial corrections/reversals with principal and reason provenance;
- preserve append-only/accounting evidence where financial/legal requirements demand it.

---

## N. Evidence / Observability

For every financial occurrence, operators should be able to trace:

```text
original business obligation
provider operation/capture/refund
Payment row
ledger posting/reversal
invoice/order balance transition
OutcomeEvidence
reconciliation/repair history
recovery authority/principal
```

A single status label such as `PAID`, `REFUNDED`, or `FAILED` is insufficient when components disagree.

---

## O. Reachability / Consumers

Current live evidence includes:

- Stripe/PayPal invoice checkout and capture;
- storefront payment creation;
- Stripe/PayPal refund operations;
- provider webhook reconciliation paths;
- Commerce local payment/refund actions;
- invoice workflow reconciliation;
- ledger posting/reversal seams;
- payment operations UI/API.

---

## P. Duplication / Legacy / Compatibility

Do not create `PaymentsV2` or a second ledger.

Current issue is semantic convergence across existing providers/payment paths and accounting consequences.

Legacy/provider-specific routes may remain temporarily only if they converge onto the same financial occurrence and consequence semantics.

---

## Q. Invariants

1. Provider financial outcome, Payment evidence, ledger consequence and invoice/order balance are distinct but linked truths.
2. A confirmed provider effect is never reclassified as provider failure merely because later local persistence failed.
3. `OUTCOME_UNKNOWN` is reconciled before unsafe financial repeat execution.
4. Provider-native idempotency maps to stable KeyFlow effect identity where available.
5. Effect dedupe never suppresses missing local financial consequences.
6. Every confirmed monetary movement has corresponding accounting consequence or explicit `CONSEQUENCE_INCOMPLETE` state.
7. Ledger reversal and refund/credit evidence preserve linkage to the original financial occurrence.
8. Invoice/order state is derived/reconciled from monetary truth rather than independently asserted where practical.
9. A negative/refunded Payment row alone is not proof that ledger/invoice consequences converged.
10. Financial reversal/compensation has its own authority, EffectId and OutcomeEvidence.
11. Local status repair is not provider retry ownership.
12. Duplicate webhooks/requests cannot double-post the same economic effect.
13. Financial corrections remain reconstructable and auditable.
14. Multi-provider semantics normalize without erasing provider-specific settlement/reversal capabilities.

---

## R. Findings

Primary evidence pressure includes:

- F132 — parallel Stripe ingress routes with divergent financial semantics;
- F133/F134 — WiPay provider-contract/lifecycle gaps;
- F149 — ambiguous external failure semantics relevant to payments;
- F155 — provider refund can bypass ledger/invoice convergence and suppress webhook repair;
- F156 — payment retry status without executable provider recovery owner;
- F158 — confirmed PayPal capture can become local FAILED and lose repair lineage.

Additional financial findings from prior registers remain applicable where referenced by J3/J4/J7/J10.

---

## S. Contradictions

Primary active contradictions include:

- provider refund confirmed vs ledger/invoice unreconciled (C105);
- payment retry initiated vs no recovery execution owner (C106);
- confirmed PayPal capture vs local FAILED recovery evidence (C108);
- provider payment/callback truth vs local route-specific financial semantics from prior J14 findings.

---

## T. Open Questions

1. Which financial paths already use one deterministic financial occurrence/effect identity end to end?
2. Which provider operations support native idempotency and for how long?
3. How should partial payments/refunds be represented in the cross-domain operator projection?
4. Which ledger posting external refs are sufficient for idempotent consequence repair?
5. What exact authority tiers/capabilities govern refunds, credits, voids and write-offs?
6. How should provider disputes/chargebacks/reversals enter K10?
7. Which WiPay lifecycle events can reconstruct later financial corrections in deployed API versions?
8. Which legacy payment ingress paths remain externally configured and must delegate before retirement?
9. How should tax/COGS/inventory consequences participate in financial repair completeness?
10. What retention/audit requirements constrain financial correction deletion/redaction?

---

## U. Target-State Candidate

```text
Governed Financial ActionEnvelope
→ ExecutionClaim / EffectId
→ K9 ProviderOperation
→ provider outcome
→ K8 OutcomeEvidence
→ K10 FinancialOccurrence consequence set
   ├ Payment evidence
   ├ ledger posting/reversal
   ├ invoice/order reconciliation
   └ downstream financial evidence
→ FINANCIAL_TRUTH_CONVERGED
```

Recovery:

```text
known external financial effect
→ detect missing consequence(s)
→ reconcile/repair SAME occurrence
→ do not repeat provider effect
```

---

## V. Migration / Compatibility

1. map all payment/refund/capture routes to financial occurrence identities;
2. characterize provider-native idempotency/reconciliation support;
3. normalize provider-success / consequence-incomplete semantics;
4. converge manual refund paths on existing posting/reconciliation seams;
5. make webhook dedupe consequence-aware;
6. preserve provider lineage across post-provider crash windows;
7. replace status-only “retry” with explicit recovery ownership or rename it as bookkeeping repair;
8. project financial recovery state through KF-REC-047;
9. only then consider further physical consolidation.

---

## W. Proof / Test Ratchets

Future proof must include:

- provider capture success + Payment insert failure → no false provider FAILED; later repair converges;
- Payment exists + ledger missing → replay/reconciliation repairs ledger without duplicate provider effect;
- provider refund exists + invoice reconciliation missing → repair converges;
- duplicate refund webhook cannot double-refund/double-reverse;
- network timeout with provider-native idempotency retries same financial EffectId safely;
- refund/credit action requires current proportional authority;
- partial refund leaves correct balance/ledger state;
- concurrent provider/manual recovery cannot double-post;
- local payment “retry” cannot claim executable recovery without an owner;
- Business Graph/analytics consume only converged or explicitly uncertain financial truth.

No runtime tests were executed as part of this kernel instantiation.

---

## X. Layered Improvement

L0 — no contradictory monetary state.

L1 — durable accounting/idempotency/reconciliation correctness.

L2 — one financial occurrence/consequence contract over existing services.

L3 — provider-aware, consequence-aware automatic repair with explicit uncertainty.

L4 — operator/KEY can explain exactly what money moved, what is uncertain, and what recovery is safe/authorized.

L5 — financial truth feeds adaptive business reasoning without sacrificing accounting correctness or authority.

---

## Y. Machine-readable Record

```yaml
id: KF-KERNEL-010
name: Financial Truth
status: active-initial-convergence
instantiated_from:
  - KF-JOURNEY-018
  - KF-KERNEL-009
  - KF-KERNEL-008
implementation_baseline: d7c5b86cfa276d75ffa42d5f1707c43704dc9f21
current_audit_head: 168732d0e2226e11ed033c14fbdf7b3ea5344a41
primary_findings: [F132,F133,F134,F155,F156,F158]
implementation_authorized: false
```
