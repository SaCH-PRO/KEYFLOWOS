# KeyFlowOS Finding Register — Command Spine Source Convergence Supplement

Status: CANONICAL CONTINUATION — J17 OPERATOR WORK / SOURCE CONVERGENCE
Implementation evidence: `main@9bff44f8f9a5195e06af3669ccb1a8f4c47ccd76`
Production implementation: READ-ONLY / NOT AUTHORIZED

---

## F182 — persistent CommandItem creation can be source-state-driven while source resolution has no corresponding load-bearing convergence path

**Status:** VERIFIED CROSS-COMPONENT / OPERATOR-PROJECTION LIFECYCLE FINDING

A concrete creation path is load-bearing:

```text
CommandGeneratorService
→ query Invoice where status = OVERDUE
→ create CommandItem
   sourceModule = finance
   sourceType = invoice
   sourceId = invoice.id
   actionType = COLLECT_RECEIVABLE
   status = OPEN
```

The source condition is therefore explicit and reversible:

```text
Invoice.status = OVERDUE
→ collection attention/work is relevant

Invoice later PAID / VOID / CANCELLED / otherwise no longer overdue
→ collection attention/work should be resolved, superseded or revalidated
```

But the inspected reverse path is not load-bearing:

- `CommandBridgeService.resolveCommandsForEntity(businessId, entityType, entityId)` exists but repository search finds no caller other than its own definition;
- searches for `invoice.paid` + `CommandItem`, `COLLECT_RECEIVABLE` resolution and invoice-scoped CommandItem completion did not reveal a source-lifecycle resolver;
- `CommandGeneratorService.generateForBusiness()` creates/skips rows and does not reconcile previously-created rows whose source state no longer matches the generating predicate;
- the unique tuple prevents duplicate creation, but uniqueness is not lifecycle convergence.

A resulting state can therefore persist:

```text
Invoice = PAID / no longer overdue
CommandItem(COLLECT_RECEIVABLE) = OPEN
```

until a user manually dismisses/completes/deletes it or another unrelated path happens to alter it.

### Product/control consequence

The persistent Command Queue is consumed as operator work/attention truth and by downstream intelligence such as health/risk summaries. A stale OPEN command can:

- continue asking the user/KEY to chase a settled invoice;
- retain `executableByKey` affordances against stale source conditions;
- distort priority/risk counts;
- compete with newer valid work;
- force manual cleanup of a condition the source domain has already resolved.

### Canonical distinction

```text
SOURCE-DERIVED PROJECTION CREATED
!= PROJECTION REMAINS VALID FOREVER
```

and:

```text
DEDUPE IDENTITY
!= SOURCE-LIFECYCLE CONVERGENCE
```

### Why this is distinct

- F141 concerns scheduled future material effects surviving source invalidation.
- F178 concerns derived knowledge/learning surviving correction/withdrawal.
- F182 concerns durable operator-attention/work projection lifecycle and the stale actionability/priority it creates.
- F181 concerns missing admission/materialization into TemporalFlow; F182 concerns missing reverse convergence after CommandItem admission succeeded.

Affected kernels: K6, K7, K8, K11.
Affected journeys: J7, J17, J18, J23.

---

## Target pressure

A durable operator projection must have both admission and convergence semantics:

```text
SOURCE CONDITION BECOMES ACTIONABLE
→ stable projection identity
→ CommandItem/open operator work

SOURCE CONDITION CHANGES
→ re-evaluate projection predicate
→ keep / update / resolve / supersede / cancel
→ preserve history
```

For obligations, the newer `WORK_OBLIGATION_RAISED / SETTLED` contract is a stronger seam because it explicitly models both directions. The target should generalize that bidirectional ownership discipline rather than add periodic cleanup heuristics for each CommandItem source.

No production implementation is authorized by this finding.
