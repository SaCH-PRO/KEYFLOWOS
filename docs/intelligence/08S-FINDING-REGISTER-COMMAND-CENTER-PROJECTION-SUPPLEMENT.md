# KeyFlowOS Finding Register — Command Center Projection Supplement

Status: CANONICAL CONTINUATION OF `08R-FINDING-REGISTER-KNOWLEDGE-CORRECTION-LINEAGE-SUPPLEMENT.md`

Current repository head: `main@9bff44f8f9a5195e06af3669ccb1a8f4c47ccd76`
Code-bearing forensic baseline remains unchanged; delta from prior evidence head is audit/architecture-only.

Canonical sequence continues after F178. Allocation checked against `04A` + `04B`.

---

## F179 — Command Center source failures can masquerade as healthy absence and alter priority/health conclusions without projection-degradation evidence

**Status:** VERIFIED CROSS-LAYER / OPERATOR-PROJECTION INTEGRITY FINDING

`BusinessCommandCenterService.snapshot()` aggregates many source systems. Most reads are wrapped by `safeResolve()`:

```text
source call throws
→ warning log
→ fallback value
→ snapshot continues
```

Material examples include:

```text
pending approvals failure
→ []

approved-awaiting-execution failure
→ []

TemporalFlow analysis failure
→ no urgent items / opportunities / risks

executive-mode failure
→ []

asset source failure
→ []

Constitution latest failure
→ null

Genome/Blueprint failure
→ zeroed Genome fallback
```

The returned `BusinessCommandCenterSnapshot` type does not contain an observed source-health/completeness/degraded-input contract that distinguishes:

```text
SOURCE HEALTHY + ZERO ITEMS
```

from:

```text
SOURCE FAILED / UNKNOWN
```

This changes user-facing conclusions, not merely observability.

Examples:

- failed pending-approval read produces `pendingApprovalCount = 0`;
- `buildPulse()` maps zero pending approvals to an approval score of 95;
- failed TemporalFlow read removes urgent/risk items and can reduce risk/urgency counts;
- briefing/top-priority/recommended-action lists are then generated from the incomplete set.

Therefore a subsystem outage can make the Command Center appear **less busy or healthier** rather than explicitly uncertain/degraded.

This is distinct from:

- F175/F176 — epistemic validity of knowledge rows consumed correctly from a source;
- F163 — competing knowledge representations;
- generic service availability — the defect is the **semantic substitution of unknown/unavailable with empty/healthy in an operator projection**.

### Target law

```text
SOURCE UNAVAILABLE / UNKNOWN
!=
SOURCE HEALTHY + ZERO IMPORTANT ITEMS
```

A Command Center projection should preserve per-source or aggregate projection completeness semantics such as:

```text
source status: OK | DEGRADED | UNAVAILABLE | STALE
last successful observation / freshness
fallback used: yes/no
affected projection sections / priority confidence
```

The exact storage/response shape is not frozen.

### User-facing rule

A degraded projection may still render useful partial information, but it must not silently convert unknown risk/approval/urgency into reassuring zero values.

### Architecture rule

The Command Center remains a derived projection. It does not repair or own source truth. It exposes the confidence/completeness of the projection built from those sources.

Affected kernels: K7, K8, K4, K3, K11.
Affected journeys: J17, J15, J23, J16, J18.

---

# Positive seams to preserve

- fail-soft snapshot assembly is valuable for product resilience;
- `safeResolve()` centralizes many source failures;
- deterministic mapping/ranking is currently explainable;
- source/sourceId fields retain basic provenance.

The target is **honest partial availability**, not making the dashboard fail closed whenever one source is unavailable.

No production implementation is authorized by this supplement.
