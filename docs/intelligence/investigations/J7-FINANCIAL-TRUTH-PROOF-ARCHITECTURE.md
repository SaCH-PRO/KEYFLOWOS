# J7 Financial Truth — Proof Architecture

Status: CANONICAL ASSURANCE DESIGN — NOT RUNTIME PROOF
Date: 2026-09-06
Implementation evidence head: `main@4e9f60c65bdb78fbdadcb08731c5dab95b3645c7`
Target: `KF-REC-052 — Financial Truth & Valuation Contract`
Runtime proof executed: NO
Production implementation authorized: NO

## 1. Purpose

This document converts J7's current target architecture into proof obligations and deterministic fault-injection points.

It does not prescribe final implementation shape. It defines what a future implementation must prove regardless of whether KeyFlow uses the current models, adapters, projections, new fields, or migrations.

---

## 2. Proof classes

```text
P1 — STRUCTURAL
one owner / one sanctioned path / declared state algebra

P2 — TRANSACTIONAL
required descendants commit atomically where atomicity is required

P3 — IDEMPOTENCY
replay cannot duplicate an occurrence/effect

P4 — COMPLETENESS
missing descendants can be detected and repaired

P5 — TEMPORAL
as-of, closed-period and effective-time behavior is truthful

P6 — VALUATION
currency/FX semantics are explicit and reproducible

P7 — RECOVERY
crash/provider ambiguity/partial consequence can converge safely

P8 — PROJECTION
user/operator reads remain semantically equivalent to canonical financial truth

P9 — AUTHORITY
material money actions/corrections consume current governance without over-governing bookkeeping
```

---

## 3. J7 proof obligations

### PF-J7-001 — sanctioned ledger writer

All ordinary production creation of `FinancialTransaction` / `LedgerEntry`, including reversal/correction, must pass through the governed posting contract or a formally declared equivalent boundary.

Proof fails if a domain service can raw-write balanced entries while bypassing period/reconciliation/idempotency controls.

### PF-J7-002 — posting balance invariant

Every posted transaction has >=2 entries and total debits == total credits under Decimal arithmetic.

### PF-J7-003 — tenant/account ownership

A posting cannot reference foreign-business accounts, contacts, sources or reconciliation state.

### PF-J7-004 — deterministic financial source identity

Equivalent source consequences resolve to one canonical `FinancialSourceIdentity`; case/alias differences cannot make reversal/reconciliation unreachable.

### PF-J7-005 — posting idempotency

Concurrent/replayed posting of one source consequence yields one accounting consequence, not duplicates.

### PF-J7-006 — successful payment consequence atomicity

Where a local SUCCESSFUL Payment claims accounting completion, Payment persistence and required posting either commit together or neither commits.

### PF-J7-007 — external success / local failure separability

Provider success remains externally confirmed even if local Payment/posting persistence fails; local failure cannot rewrite provider truth to FAILED.

### PF-J7-008 — ingress receipt vs completion lifecycle

A provider event can be RECEIVED without being CONSEQUENCES_COMPLETE. Retry/re-drive remains possible after partial local failure without repeating the provider effect.

### PF-J7-009 — duplicate delivery safety

Repeated delivery of one provider occurrence does not duplicate Payment/refund/accounting consequences.

### PF-J7-010 — missing-descendant repair

If Payment exists but accounting/source-document descendant is absent, reconciliation/repair can create only the missing descendant and converge.

### PF-J7-011 — canonical invoice balance

All canonical invoice/payment balance reads compute or consume semantically equivalent:

```text
SUCCESSFUL - REFUNDED = net paid
```

including remaining, overpayment and payment progress.

### PF-J7-012 — projection convergence after refund

After refund/reversal, invoice list, detail, stats, finance overview and operator attention converge to the same net financial position within their declared freshness guarantees.

### PF-J7-013 — cash truth ownership

The product can identify one authoritative cash basis. Any materialized `currentBalance`-like projection has explicit source basis, computedAt/asOf, freshness, rebuild and reconciliation semantics.

### PF-J7-014 — safe-to-spend basis

`SAFE_TO_SPEND` exposes cash basis, included reserves/liabilities, known exclusions and valuation currency. Unmodeled payroll/debt cannot be silently treated as known zero.

### PF-J7-015 — native currency separation

Two monetary amounts in different currencies cannot be added as one scalar financial balance without explicit conversion or currency-separated output.

### PF-J7-016 — valuation evidence reproducibility

A converted material amount can be reproduced from native amount/currency, target currency, rate, rate source, purpose and effective time.

### PF-J7-017 — functional/presentation distinction

Where KeyFlow supports multi-currency, transaction currency, functional/accounting currency and presentation/reporting currency remain distinguishable.

### PF-J7-018 — closed-period write enforcement

A posting dated inside a CLOSED accounting period is rejected or routed through an explicit permitted adjustment policy at the canonical write door.

### PF-J7-019 — reconciliation-lock immutability

Historical reconciled entries cannot be silently mutated/deleted/unlocked by ordinary reversal.

### PF-J7-020 — later correction representability

A real later refund/correction against a reconciled historical posting can be represented by a governed current-period correction with lineage, without mutating the historical source entry.

### PF-J7-021 — credit-note apply reachability

A valid canonical invoice posting is discoverable by credit-note application through canonical source identity.

### PF-J7-022 — credit-note apply atomicity

Credit-note accounting consequence + CreditNote APPLIED state + dependent invoice credit state converge atomically or through a repairable durable lifecycle.

### PF-J7-023 — credit-note void correction closure

Voiding an APPLIED credit note cannot leave its accounting consequence and invoice credited state active without an explicit incomplete/recovery state.

### PF-J7-024 — one invoice lifecycle owner

All invoice statuses observable in production belong to one declared state algebra and transition owner. No domain service can write undeclared status values directly.

### PF-J7-025 — payroll paid evidence

`PayrollRun=PAID` requires the declared evidence contract for payroll disbursement/accounting consequence; status-only mutation cannot satisfy proof.

### PF-J7-026 — bill paid evidence

Bill PAID state remains transactionally coupled to the declared AP/cash accounting consequence.

### PF-J7-027 — refund consequence completeness

A provider-confirmed refund can be checked independently for:

```text
external occurrence
refund Payment/money-movement record
accounting correction
invoice/document convergence
reconciliation impact
projection convergence
```

### PF-J7-028 — correction lineage

Reversal/correction preserves original evidence and links the new financial consequence explicitly; no destructive history rewrite.

### PF-J7-029 — material money authority

A material money-moving provider action requires current applicable K3 Clearance/authority.

### PF-J7-030 — deterministic bookkeeping is not over-governed

Idempotent accounting descendant repair/reconciliation does not require a new human approval merely because it writes ledger state, unless business policy/materiality specifically requires it.

### PF-J7-031 — financial attention basis

J17 financial attention items expose truth basis/completeness and cannot present a stale/incomplete projection as authoritative money reality.

### PF-J7-032 — financial recovery preserves effect identity

Retry/repair of local financial descendants does not change or duplicate the already-confirmed external EffectId; new reversal/compensation uses distinct RecoveryEffectId where applicable.

---

## 4. Deterministic fault-injection points

### FI-J7-001 — provider success before local Payment write

Inject failure after provider success, before Payment persistence.
Expected: external outcome remains known/unknown correctly; no false FAILED; reconciliation path exists.

### FI-J7-002 — Payment write before ledger posting

Inject failure between successful Payment creation and accounting consequence.
Expected: transactional path rolls back or durable consequence-incomplete state is repairable.

### FI-J7-003 — webhook receipt before downstream handler

Persist provider receipt, then crash before payment/refund handling.
Expected: same provider occurrence can be re-driven; receipt does not poison repair.

### FI-J7-004 — webhook refund after reversal failure

Force `PostingService.reverse()`/correction failure after provider refund occurrence.
Expected: provider refund remains known and local recovery is visible/retryable.

### FI-J7-005 — duplicate provider delivery

Deliver same event concurrently twice.
Expected: one occurrence/effect, descendants exactly once or idempotently converged.

### FI-J7-006 — Payment exists / ledger missing

Seed F188-like state then invoke repair/reconciliation.
Expected: missing posting created without second provider charge/capture.

### FI-J7-007 — refund after fully paid invoice

Create SUCCESSFUL payment then REFUNDED row.
Expected: canonical invoice balance reopens; all active projections converge from gross to net semantics.

### FI-J7-008 — mixed-currency ledger account

Post 100 USD + 100 TTD to a path under test.
Expected: no scalar `200` financial result without valuation evidence or currency-separated response.

### FI-J7-009 — missing/stale FX rate

Attempt reporting valuation with unavailable or stale required rate.
Expected: degraded/incomplete valuation state, not silent 1:1/default conversion.

### FI-J7-010 — backdated posting into closed period

Close period then attempt posting with date inside it.
Expected: canonical write door enforces policy.

### FI-J7-011 — later refund against reconciled payment

Reconcile original payment, then confirm external refund in later period.
Expected: historical entries remain immutable; current-period correction remains representable and linked.

### FI-J7-012 — applied CreditNote void

Apply credit note, then void it.
Expected: correction consequence and invoice state converge; no VOID document with active credit effect unless explicitly marked incomplete.

### FI-J7-013 — undeclared invoice state injection

Attempt direct write of status absent from canonical state algebra.
Expected: rejected by architecture/control/test ratchet.

### FI-J7-014 — raw ledger write outside PostingService

Static/dynamic proof detects direct production `financialTransaction.create` or `ledgerEntry.create` outside allowed boundary.
Expected: build/test fails or call is explicitly whitelisted with equivalent invariant proof.

### FI-J7-015 — stale currentBalance vs real ledger movement

Seed account opening balance, post cash movement without updating projection.
Expected: canonical cash/safe-to-spend surfaces use ledger/reconciled basis or declare projection stale/incomplete.

### FI-J7-016 — payroll status-only paid attempt

Attempt to mark payroll PAID without declared payment/accounting evidence.
Expected: rejected or represented as a weaker assertion state, not strong financial completion.

---

## 5. Proof ratchets

Future implementation should add durable ratchets such as:

```text
STATIC
- no raw ledger writers outside allowlist
- one InvoiceStatus source/type vocabulary
- canonical financial source discriminator constants/types

UNIT
- computeBalance refund/net semantics
- valuation evidence/rate selection
- period-policy decision

INTEGRATION
- Payment + posting atomicity
- refund + correction + invoice convergence
- credit-note apply/void closure
- reconciled historical refund correction

CONCURRENCY
- duplicate provider delivery
- duplicate posting source identity
- concurrent repair

CRASH / FAULT
- each FI-J7 point above

PRODUCT
- invoice UI/server projections after refund
- safe-to-spend basis/completeness
- J17 attention degradation/completeness
```

---

## 6. Current assurance verdict

J7 now has:

```text
32 proof obligations
16 deterministic fault-injection points
standards/frontier pressure test: complete
backward re-audit: complete for current J3/J4/J17/J18/J23 scope
runtime proof: NOT EXECUTED
implementation: NOT AUTHORIZED
```

The next programme move is to pool J7 into the whole-system virtual model and decide whether another journey/kernel must be reopened before broader target/migration synthesis.

No production implementation is authorized by this proof architecture.
