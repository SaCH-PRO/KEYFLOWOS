# KeyFlowOS Finding Register — Credit Note Reversal and Invoice State Supplement

Status: CANONICAL CONTINUATION — J7 FINANCIAL TRUTH
Implementation evidence: `main@4e9f60c65bdb78fbdadcb08731c5dab95b3645c7`
Production implementation: READ-ONLY / NOT AUTHORIZED

---

## F195 — Voiding an applied CreditNote can withdraw the document state without reversing its accounting consequence or restoring invoice state

**Status:** VERIFIED CODE-LEVEL / FINANCIAL-CORRECTION FINDING

`CreditNoteService.apply()` intends to create a real accounting consequence through `PostingService.post()` and persists:

```text
CreditNote.status = APPLIED
reversalTransactionId = <credit-note posting transaction>
Invoice.status = PARTIALLY_CREDITED | FULLY_CREDITED
```

`CreditNoteService.void()` allows any non-VOID credit note, including APPLIED, and performs only:

```text
CreditNote.status = VOID
voidedAt = now
```

It does not:

- reverse `reversalTransactionId` or post an offsetting current-period correction;
- restore/recompute the Invoice state from remaining applied credits;
- record a financial correction lineage beyond the status flip.

Therefore a reachable state is:

```text
CreditNote = VOID
while
credit-note ledger consequence remains POSTED
and
Invoice may remain PARTIALLY_CREDITED / FULLY_CREDITED
```

This is distinct from F189. F189 makes `apply()` unreachable against canonical invoice posting because of `INVOICE` vs `Invoice`. F195 describes the independent target-path defect that remains even after F189 is repaired: **withdrawal of an already-applied financial document does not converge its descendants**.

It also specializes the broader correction/convergence law already established in K4 without duplicating K4 identity: financial correction requires accounting and source-document descendant convergence.

Target law:

```text
VOID / WITHDRAW APPLIED FINANCIAL DOCUMENT
→ new corrective accounting consequence
→ recompute dependent financial document state
→ preserve original history + correction lineage
```

No historical posting is silently deleted.

Affected kernels: K6, K8, K10, K11.
Affected journeys: J3, J7, J18.

---

## F196 — CreditNoteService mutates Invoice into statuses outside the canonical InvoiceWorkflow state machine

**Status:** VERIFIED STATE-OWNERSHIP FINDING

`InvoiceWorkflowService` explicitly declares itself the single owner of invoice transitions and defines the canonical `InvoiceStatus` set:

```text
DRAFT
SENT
PARTIALLY_PAID
PAID
OVERDUE
VOID
FAILED
PENDING
```

`CreditNoteService.apply()` bypasses `InvoiceWorkflowService` and directly writes:

```text
Invoice.status = PARTIALLY_CREDITED
or
Invoice.status = FULLY_CREDITED
```

Those states are not represented in the canonical workflow type or transition map.

Consequences:

- state ownership is split between `InvoiceWorkflowService` and `CreditNoteService`;
- workflow legality cannot be proved centrally;
- downstream code typed against canonical `InvoiceStatus` can observe values outside its state model;
- payment/refund reconciliation semantics and credit-note semantics can compete over the same status column;
- future transition behavior from credited states is undefined in the canonical transition graph.

This is distinct from F195. F195 concerns missing correction consequences when an applied credit note is voided. F196 concerns **invoice state-machine ownership and ontology**.

Target pressure:

```text
ONE INVOICE LIFECYCLE OWNER
→ one declared state algebra
→ credit-note effects represented as evidence/balance dimensions or governed transitions
→ no domain service writes undeclared terminal/subterminal invoice statuses directly
```

The target may retain credited states if product semantics require them, but they must be part of one canonical state model rather than a parallel local vocabulary.

Affected kernels: K6, K10.
Affected journeys: J3, J7.

No production implementation is authorized by this supplement.
