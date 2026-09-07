# KeyFlowOS Canonical ID Allocation Ledger

Status: CANONICAL — OVERRIDES LEGACY COLLIDING ALLOCATIONS
Last updated: 2026-09-06

Purpose: provide one unambiguous allocator for Finding (`F###`), Contradiction (`C###`) and Recommendation (`KF-REC-###`) identities.

## Governing rule

If any historical supplement still says `CANONICAL` for a colliding ID, **this ledger wins**. Historical evidence remains valuable; the old numeric heading is not a canonical allocation.

Never delete or reuse an allocated identity. Historical collisions resolve as REMAP or ALIAS/SUPERSEDED.

## Preserved mature lineage

```text
F145–F160 temporal/external/recovery lineage
F161–F166 initial J16/K4 epistemic-integrity findings
F167–F174 recovered historical collision-band findings
F175–F178 J16/K4 knowledge-consumption/learning/correction findings
F179–F184 J17 Command Center / operator-control findings
```

```text
C096–C110 temporal/external/recovery lineage
C111–C116 initial J16/K4 contradictions
C117–C124 recovered historical collision-band contradictions
C125–C128 J16/K4 knowledge-consumption/learning/correction contradictions
C129–C134 J17 Command Center / operator-control contradictions
```

```text
KF-REC-045 missed-schedule/lateness policy
KF-REC-046 workflow-definition versioning
KF-REC-047 Temporal Work Projection
KF-REC-048 certainty-aware Recovery Contract
KF-REC-049 provenance/revision-aware Business Knowledge Contract
KF-REC-050 load-bearing WorkDefinition control contract
KF-REC-051 Operator Attention & Priority Contract
```

## Historical collision reconciliation

Governed by:
- `08O-FINDING-REGISTER-TAXONOMY-RECONCILIATION-SUPPLEMENT.md` — F167–F174;
- `09O-CONTRADICTION-REGISTER-TAXONOMY-RECONCILIATION-SUPPLEMENT.md` — C117–C124;
- `10I-RECOMMENDATION-REGISTER-TAXONOMY-RECONCILIATION-CONTINUATION.md` — KF-REC-050.

## J16 allocations

- F175 / C125 — epistemic readiness eligibility.
- F176 / C126 — epistemic prompt eligibility.
- F177 / C127 — causal learning attribution.
- F178 / C128 — knowledge correction lineage.

## J17 allocations

### F179 / C129 — Command Center projection completeness
Home: `08S` / `09S`.

`SOURCE UNAVAILABLE / UNKNOWN != SOURCE HEALTHY + ZERO IMPORTANT ITEMS`

### F180 / C130 — Command spine false-terminal execution semantics
Home: `08T` / `09T`.

`CommandItem.status=EXECUTED != source approval resolved != executionTool ran != business effect occurred != OutcomeEvidence`

### F181 / C131 — Temporal priority materialization reachability
Home: `08U` / `09U`.

`CONSUMER PRIORITY LOGIC EXISTS != PRODUCER PATH IS WIRED != DOMAIN CONDITION REACHES THAT PROJECTION`

### F182 / C132 — CommandItem source-state convergence
Home: `08V` / `09V`.

`SOURCE-DERIVED PROJECTION CREATED != PROJECTION REMAINS VALID FOREVER`

### F183 / C133 — Command Queue lifecycle visibility
Home: `08W` / `09W`.

`MULTI-STATUS CLIENT FILTER VOCABULARY != OPEN-ONLY SERVER DATASET`

The main Command Center fetches only OPEN CommandItems while presenting filters for IN_PROGRESS, WAITING_APPROVAL, SNOOZED, COMPLETED and DISMISSED.

### F184 / C134 — priority semantic compression
Home: `08X` / `09X`.

`SOURCE-SPECIFIC RANKING SEMANTICS != GLOBAL OPERATING PRIORITY`

The Command Center global Top Priorities path ranks priority class → static type weight → recency. It bypasses richer source ranking semantics such as GenomeRecommendationRanker expected gain, confidence, readiness, financial viability, outcome learning, risk and effort. Persistent CommandItems use another scale: numeric priority → urgency → recency.

## Recommendation allocation

### KF-REC-051 — Operator Attention & Priority Contract
Home: `10J-RECOMMENDATION-REGISTER-OPERATOR-PRIORITY-CONTINUATION.md`.

Distinct responsibility:

```text
source truth
→ admission/convergence into operator attention/work projection
→ source health/freshness
→ multidimensional PriorityAssessment
→ question-specific deterministic ordering
→ explicit user disposition
→ canonical current governance/effect execution
→ OutcomeEvidence-driven projection convergence
```

KF-REC-051 is broader than KF-REC-047. Temporal Work Projection is one major source into operator attention/priority; it is not all business priority truth.

## Current ranges

```text
Findings:        F001–F184
Contradictions:  C001–C134
Recommendations: KF-REC-001–KF-REC-051
```

## Agent pre-allocation gate

```text
LOAD 04A + 04B
→ CHECK CURRENT ranges
→ SEARCH semantic equivalents
→ REUSE / REFINE / CROSS-REFERENCE
→ only then allocate next unused ID
→ one canonical home definition
→ update 04B + CURRENT + ROLLOVER
```

No production implementation is authorized by this ledger.
