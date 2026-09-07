# KeyFlowOS Finding Register — Priority Semantic Compression Supplement

Status: CANONICAL CONTINUATION — J17 PRIORITY SYNTHESIS
Implementation evidence: `main@9bff44f8f9a5195e06af3669ccb1a8f4c47ccd76`
Production implementation: READ-ONLY / NOT AUTHORIZED

---

## F184 — Command Center Top Priorities bypasses richer source ranking semantics and compresses heterogeneous decision dimensions into priority class + type weight + recency

**Status:** VERIFIED CROSS-COMPONENT / PRIORITY-SEMANTICS FINDING

The Command Center global ranking contract is:

```text
priority enum: CRITICAL > HIGH > MEDIUM > LOW
→ static TYPE_WEIGHT by CommandCenterItem type
→ createdAt recency
```

`CommandCenterItem` does not carry a general normalized decision vector for expected value, urgency, deadline, confidence, effort, reversibility, current actionability, recovery state or source completeness. Although the type includes optional `dueAt`, no `dueAt` mapping was found in `BusinessCommandCenterService`.

### Concrete Genome recommendation loss

KeyFlow already has a substantially richer `GenomeRecommendationRankerService`.

For each recommendation it computes a `rankScore` from:

```text
expectedGainScore       30%
confidence              20%
readiness               15%
cross-domain synergy
financial viability     10%
outcome learning        10%
minus risk penalty      15%
minus effort penalty     5%
```

and also derives:

```text
readiness gating
financial viability
capacity gating
safe vs blocked action
rank reason / score breakdown
```

The Command Center cross-domain Genome bridge consumes this richer ranker for its `topRecommendations`/blocked-action material.

But the primary `BusinessCommandCenterService.mapGenomeRecommendationItems()` path used in **global Top Priorities** does not use those ranked results. It reads raw active recommendations from `GenomeRecommendationService.listRecommendations()` and maps their global Command Center `priority` primarily from recommendation `riskLevel`:

```text
CRITICAL/HIGH risk → HIGH priority
MEDIUM risk        → MEDIUM priority
LOW risk           → LOW priority
```

The global ranker then applies the static `GENOME_RECOMMENDATION` type weight and recency.

Thus the same recommendation ecosystem has two different ranking semantics inside one Command Center:

```text
Cross-domain Genome panel:
expected gain + confidence + readiness + viability + outcome learning - risk - effort

Top Priorities:
risk-derived priority class + static item type weight + recency
```

### Persistent CommandItem split

The durable CommandItem spine separately stores/ranks:

```text
priority numeric
urgency numeric
createdAt
```

and may also carry:

```text
impactScore
expectedValue
riskTier
dueAt
```

but `CommandService.findMany()` sorts by `priority`, then `urgency`, then recency, while the synthesized Top Priorities path does not consume that spine or those dimensions.

### Consequence

The product can explain each local formula, but it cannot currently provide one coherent answer to:

> Why is item A above item B in the business's overall operating priority?

A high-risk but low-value/high-effort Genome recommendation can outrank a safer high-gain recommendation in the global Top Priorities even though the dedicated Genome ranker prefers the latter. Likewise, persistent operational work and synthesized priorities use non-comparable scoring scales.

This finding does **not** assert that one universal scalar priority score is always correct. The defect is semantic compression and lost source ranking meaning before cross-source comparison.

### Canonical distinction

```text
SOURCE-SPECIFIC RANKING SEMANTICS
!= GLOBAL OPERATING PRIORITY
```

and:

```text
RISK
!= PRIORITY
!= URGENCY
!= EXPECTED VALUE
!= ACTIONABILITY
```

### Why this is distinct

- F179 concerns incomplete/degraded input masquerading as healthy absence.
- F181 concerns priority-source reachability.
- F184 concerns how valid inputs are semantically normalized and compared once they reach the projection.
- F175/F176 concern epistemic eligibility of knowledge, not operating priority synthesis.

Affected kernels: K3, K4, K5, K7, K8, K10, K11.
Affected journeys: J6, J7, J15, J17, J18, J23.

---

## Target pressure

Do not replace this with an opaque ML ranking model by default.

Target a composable, explainable **Priority Assessment** where source semantics survive normalization:

```text
source item / source rank evidence
+ deadline / lateness
+ consequence severity / risk
+ expected business value
+ epistemic confidence / source completeness
+ readiness / current actionability
+ authority/control wait state
+ recovery / outcome uncertainty
+ effort / capacity
+ user disposition / attention cost
→ priority dimensions + reason
→ policy-specific ordering for the question being asked
```

Important: different operator questions may legitimately use different orderings:

```text
What is owed?           → deadline/lateness first
What is dangerous?      → consequence/risk first
What should I do next?  → value × urgency × actionability with safety constraints
What can KEY do safely? → current Clearance/readiness/reversibility constraints
```

The target should preserve these distinctions rather than force every question through one universal score.

No production implementation is authorized by this finding.
