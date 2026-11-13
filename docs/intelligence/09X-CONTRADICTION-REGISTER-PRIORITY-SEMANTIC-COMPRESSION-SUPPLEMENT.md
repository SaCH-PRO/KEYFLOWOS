# KeyFlowOS Contradiction Register — Priority Semantic Compression Supplement

Status: CANONICAL CONTINUATION — J17 PRIORITY SYNTHESIS
Implementation evidence: `main@9bff44f8f9a5195e06af3669ccb1a8f4c47ccd76`
Production implementation: READ-ONLY / NOT AUTHORIZED

---

## C134 — rich source recommendation rank vs risk/type-based global Top Priority rank

**Status:** VERIFIED ACTIVE CONTRADICTION

The same Genome recommendation ecosystem can be ranked inside the Command Center through two materially different semantics.

Dedicated Genome ranking uses:

```text
expected gain
+ confidence
+ readiness
+ cross-domain synergy
+ financial viability
+ outcome learning
- risk
- effort
→ rank score / safe vs blocked / rank reason
```

while the primary global Top Priorities mapping reduces a Genome recommendation mainly to:

```text
risk level → HIGH/MEDIUM/LOW priority
→ static GENOME_RECOMMENDATION type weight
→ recency
```

The contradiction is:

```text
SOURCE RANKER SAYS RECOMMENDATION A > B
while
GLOBAL TOP PRIORITY CAN ORDER B > A
for reasons that discard the source rank dimensions
```

Persistent CommandItems introduce a third scale (`priority` + `urgency` + recency, with additional impact/value/risk/due fields not used in its default order).

### Target resolution

Preserve source ranking evidence and normalize explicit decision dimensions before cross-source ordering. Do not silently redefine `risk` as `priority` or treat unrelated numeric/enumerated priority scales as comparable without an explicit contract.

Affected kernels: K3, K4, K5, K7, K8, K10, K11.
Affected journeys: J6, J7, J15, J17, J18, J23.

No production implementation is authorized by this contradiction.
