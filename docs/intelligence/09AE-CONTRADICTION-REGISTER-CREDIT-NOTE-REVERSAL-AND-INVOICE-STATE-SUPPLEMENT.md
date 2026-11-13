# KeyFlowOS Contradiction Register — Credit Note Reversal and Invoice State Supplement

Status: CANONICAL CONTINUATION — J7 FINANCIAL TRUTH
Implementation evidence: `main@4e9f60c65bdb78fbdadcb08731c5dab95b3645c7`
Production implementation: READ-ONLY / NOT AUTHORIZED

---

## C145 — CreditNote VOID state vs still-active accounting and invoice descendants

```text
CreditNote.status = VOID
while
its applied ledger consequence remains posted
and
Invoice credited state can remain unchanged
```

A financial document can therefore be withdrawn at its own source-state layer while stronger accounting/document descendants remain active.

Target law:

```text
financial correction state
!= descendant convergence complete
```

A void of an applied credit note must either be prohibited or produce a governed corrective consequence plus invoice recomputation.

---

## C146 — InvoiceWorkflow single-owner claim vs CreditNote direct undeclared status mutation

```text
InvoiceWorkflowService claims canonical transition ownership
and defines no PARTIALLY_CREDITED / FULLY_CREDITED states

while

CreditNoteService.apply() writes those states directly to Invoice.status
```

This creates two competing invoice state machines over one column.

Target law:

```text
ONE BUSINESS STATE
→ ONE CANONICAL LIFECYCLE OWNER
→ ONE DECLARED STATE ALGEBRA
```

No production implementation is authorized by this contradiction entry.
