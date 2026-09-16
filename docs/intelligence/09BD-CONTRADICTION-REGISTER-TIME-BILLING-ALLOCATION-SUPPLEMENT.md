# Contradiction Register - Source Time to Invoice Allocation

Status: CANONICAL SUPPLEMENT  
Checkpoint: `J8-CSB-2026-09-16-01`  
Date: 2026-09-16  
Forensic baseline: `8f173bfe79f1418159cf4099ea18b0d60d203ec2`.

## C178 - Billed-entry completeness and reported source minutes can disagree with priced invoice-line allocation

Finding home: [F228](08BD-FINDING-REGISTER-TIME-BILLING-ALLOCATION-SUPPLEMENT.md).

```text
Selected source entries:
  A 60 minutes @ 100
  B 30 minutes @ 200
  C 45 minutes @ 200
  same display label; total 135 minutes / 350 pre-tax units

invoiceUnbilledTime grouping:
  base group retains A
  alternate-rate group B is overwritten by C
  invoice lines represent 105 minutes / 250 pre-tax units

later bookkeeping, if writes succeed:
  all three source IDs marked billed
  marked.count equals ids.length
  returned totalMinutes can still be 135
```

These facts describe one conditional static source path, not a runtime/customer incident. The contradiction is not merely gross-versus-net payment reporting or a missing provider callback: the commercial invoice basis already omits selected source value.

Required distinction:

```text
all selected IDs marked billed
!= all selected entry revisions allocated into the invoice
!= source quantity/value conserved under the pricing policy
```

Resolve through typed grouping, explicit source-to-line allocations, declared precision and exclusive billing ownership over the canonical invoice writer. Preserve financial correction history for existing billed rows. J8 Y05 is designed; runtime proof and implementation remain unexecuted/unauthorized.
