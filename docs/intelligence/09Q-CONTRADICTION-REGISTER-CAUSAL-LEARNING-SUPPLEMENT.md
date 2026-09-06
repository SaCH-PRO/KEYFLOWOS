# KeyFlowOS Contradiction Register — Causal Learning Supplement

Status: CANONICAL CONTINUATION OF `09P-CONTRADICTION-REGISTER-KNOWLEDGE-CONSUMPTION-SUPPLEMENT.md`

Canonical sequence continues after C126. Allocation checked against `04A` + `04B`.

---

## C127 — one observed/domain outcome vs confidence change across unrelated recommendation patterns

**Status:** VERIFIED ACTIVE CONTRADICTION

Genome learning can treat an observed outcome or outcome-coded memory event as domain-wide evidence and adjust recommendation confidence for candidates that share only the same broad domain.

In `GenomeOutcomeLearningService.applyOutcomeToConfidence()`, `actionType` is passed by the caller but is not used to select which recommendations receive the confidence delta.

```text
observed evidence: one recommendation/action/context
learning mutation: all active recommendations in domain
```

The before/after domain snapshot can also move for reasons unrelated to the recommendation under observation.

Target resolution: confidence adaptation is bounded by explicit recommendation/action/effect/outcome lineage and a LearningEligibility decision. Weakly attributed domain movement remains contextual evidence, not causal proof.

Affected kernels: K4, K8, K6, K7, K11.
Affected journeys: J2, J6, J16, J18, J23.

---

# Distinction

C127 is not C116:

- C116 concerns process/control success/failure labels masquerading as business outcome truth;
- C127 concerns insufficient causal specificity even when a business/outcome observation exists.

No production implementation is authorized by this supplement.
