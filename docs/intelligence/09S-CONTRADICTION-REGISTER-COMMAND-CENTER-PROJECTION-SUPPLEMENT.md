# KeyFlowOS Contradiction Register — Command Center Projection Supplement

Status: CANONICAL CONTINUATION OF `09R-CONTRADICTION-REGISTER-KNOWLEDGE-CORRECTION-LINEAGE-SUPPLEMENT.md`

Canonical sequence continues after C128. Allocation checked against `04A` + `04B`.

---

## C129 — unavailable Command Center source vs healthy zero-item projection

**Status:** VERIFIED ACTIVE CONTRADICTION

The Command Center uses fail-soft source reads so a dependency error often becomes an empty list, null or zeroed object. The snapshot schema does not expose source-health/projection-completeness state.

This can produce:

```text
source truth: UNKNOWN / UNAVAILABLE
projection truth: ZERO ITEMS / NO RISK / NO APPROVALS
```

and downstream health/pulse calculations may become more reassuring because the counts are zero.

Target resolution:

> preserve fail-soft partial rendering, but carry explicit degraded/source-freshness/completeness semantics so unknown cannot masquerade as healthy absence.

Affected kernels: K7, K8, K4, K3, K11.
Affected journeys: J17, J15, J23, J16, J18.

No production implementation is authorized by this supplement.
