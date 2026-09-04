# KeyFlowOS Contradiction Register — Compensation Recovery Supplement

Status: CANONICAL CONTINUATION OF `09M-CONTRADICTION-REGISTER-SCHEDULED-RECOVERY-SUPPLEMENT.md`

Canonical sequence continues after C104.

---

## C105 — one failed effect vs two independent compensation owners

**Status:** VERIFIED ACTIVE CONTRADICTION

Live KeyCortex plan execution pre-registers saga compensation, executes the step with direct `rollbackOnFailure=true`, and then invokes saga compensation after the failed step.

Thus one failed logical effect can be acted on by two independent rollback/compensation mechanisms with different action mappings and evidence inputs.

Target resolution: one authoritative compensation owner per exact effect, selected only after outcome certainty supports compensation/reversal.

Affected kernels: K6, K8, K9, K11.
Affected journeys: J2, J6, J18, J23.

---

## C106 — durable compensation result vs later generic failure overwrite

**Status:** VERIFIED ACTIVE CONTRADICTION

Saga compensation records `compensated`, `compensation_failed` or `compensation_unavailable`, but the live planner later writes SagaExecution back to generic `failed`.

Thus detailed recovery evidence exists while the top-level saga state discards it.

Target resolution: preserve original execution outcome and recovery outcome as orthogonal durable evidence.

Affected kernels: K7, K8, K11.
Affected journeys: J2, J6, J18, J23.

No production implementation is authorized by this supplement.
