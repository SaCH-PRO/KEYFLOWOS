# KeyFlowOS Finding Register — Compensation Recovery Supplement

Status: CANONICAL CONTINUATION OF `08M-FINDING-REGISTER-SCHEDULED-RECOVERY-SUPPLEMENT.md`

Implementation baseline: `main@d7c5b86cfa276d75ffa42d5f1707c43704dc9f21`

Canonical sequence continues after F154.

---

## F155 — Live KeyCortex plan execution can apply two compensation mechanisms to the same failed step

**Status:** VERIFIED LIVE-PATH / RECOVERY-CORRECTNESS FINDING

`KeyCortexPlannerService.executePlan()` is exposed through the Key Cortex goals/plans controller and is the human-triggered plan execution path.

For each step it:

```text
pre-registers saga compensation
→ executor.execute(... rollbackOnFailure: true)
```

`KeyCortexExecutorService.execute()` automatically invokes its own direct `rollback(result)` when the command result is unsuccessful.

If the same plan step fails, the planner then also calls:

```text
saga.failStep(...)
→ saga.compensate(sagaId)
```

`KeyCortexSagaService.compensate()` iterates registered compensations in reverse order and does not restrict itself to only successfully completed steps; the just-failed step can therefore also receive saga compensation.

The direct rollback and saga compensation are not the same mechanism:

- direct rollback infers an inverse from action-name heuristics and original command parameters;
- saga compensation uses pre-registered canonical compensation handlers and can use step output/checkpoint data.

Therefore a failed action can be compensated twice, including cases where the original side effect was never proven to have occurred.

Target law:

> One exact effect has one authoritative recovery/compensation owner. Compensation is admitted only after effect/outcome certainty supports it; overlapping rollback fabrics must not both act on the same effect.

Affected kernels: K6, K8, K9, K11.
Affected journeys: J2, J6, J18, J23.

---

## F156 — KeyCortex planner overwrites saga compensation outcome with generic failed status

**Status:** VERIFIED LIVE-PATH / EVIDENCE-INTEGRITY FINDING

`KeyCortexSagaService.compensate()` persists one of:

```text
compensated
compensation_failed
compensation_unavailable
```

based on actual compensation capability/results.

But after failed plan execution, `KeyCortexPlannerService.executePlan()` later performs:

```text
finalStatus = failed
→ saga.failSaga(saga.id)
→ SagaExecution.status = failed
```

This overwrites the top-level compensation outcome previously written by `compensate()`.

The step-level compensation records may remain, but the saga's primary status no longer tells an operator whether recovery succeeded, failed, or was unavailable.

Target law:

> Failure state and recovery outcome are orthogonal evidence. Terminal workflow status must preserve the strongest truthful recovery result rather than overwrite it with a coarser failure label.

Possible target projection:

```text
original_outcome: FAILED
recovery_state: COMPENSATED | COMPENSATION_FAILED | COMPENSATION_UNAVAILABLE
```

or an equivalent composite state model.

Affected kernels: K7, K8, K11.
Affected journeys: J2, J6, J18, J23.

---

# Stronger existing seam

`KeyCortexCompensationService` is materially stronger than the direct rollback heuristic:

- canonical real tool-name mapping;
- registered handlers;
- output-aware entity identification where available;
- tenant-scoped compensations;
- explicit best-effort messaging semantics;
- SagaService `compensation_unavailable` / `compensation_failed` evidence.

Target convergence should prefer this explicit compensation contract rather than keeping two overlapping rollback owners.

---

# Pool law

```text
FAILED EFFECT
→ classify whether effect occurred
→ choose ONE recovery owner
→ compensate/reverse only with sufficient evidence
→ preserve original failure AND recovery outcome
```

No production implementation is authorized by this supplement.
