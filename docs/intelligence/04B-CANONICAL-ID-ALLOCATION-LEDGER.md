# KeyFlowOS Canonical ID Allocation Ledger

Status: CANONICAL — OVERRIDES LEGACY COLLIDING ALLOCATIONS
Last updated: 2026-09-06

Purpose: provide one unambiguous allocator for Finding (`F###`), Contradiction (`C###`) and Recommendation (`KF-REC-###`) identities.

## Governing rule

If any historical supplement still says `CANONICAL` for a colliding ID, **this ledger wins**. Historical evidence remains valuable; the old numeric heading is not a canonical allocation.

Never delete or reuse an allocated identity. Historical collisions resolve as:
- **REMAP** — distinct semantic root receives a new unique ID;
- **ALIAS / SUPERSEDED** — same root references an existing canonical ID.

## Preserved mature lineage

```text
F145–F160 temporal/external/recovery lineage
F161–F166 initial J16/K4 epistemic-integrity findings
F167–F174 recovered distinct historical collision-band findings
F175–F176 J16/K4 knowledge-consumption findings
F177 J16/K4 causal-learning attribution
F178 J16/J19 correction lineage
F179 J17 Command Center projection completeness
```

```text
C096–C110 temporal/external/recovery lineage
C111–C116 initial J16/K4 contradictions
C117–C124 recovered distinct historical collision-band contradictions
C125–C126 J16/K4 knowledge-consumption contradictions
C127 J16/K4 causal-learning attribution
C128 J16/J19 correction lineage
C129 J17 Command Center projection completeness
```

```text
KF-REC-045 missed-schedule/lateness policy
KF-REC-046 workflow-definition versioning
KF-REC-047 Temporal Work Projection
KF-REC-048 certainty-aware Recovery Contract
KF-REC-049 provenance/revision-aware Business Knowledge Contract
KF-REC-050 load-bearing WorkDefinition control contract
```

## Historical collision reconciliation

The discovered historical parallel-analysis collision band remains governed by the mappings persisted in:

- `08O-FINDING-REGISTER-TAXONOMY-RECONCILIATION-SUPPLEMENT.md` — F167–F174;
- `09O-CONTRADICTION-REGISTER-TAXONOMY-RECONCILIATION-SUPPLEMENT.md` — C117–C124;
- `10I-RECOMMENDATION-REGISTER-TAXONOMY-RECONCILIATION-CONTINUATION.md` — KF-REC-050.

Key aliases/remaps include workflow-control, recurrence, provider-recovery, scheduled-recovery and compensation collisions. Historical files retain evidence but do not re-own the numeric IDs.

## Post-reconciliation J16 allocations

### F175 / C125 — epistemic readiness eligibility
Home: `08P` / `09P` knowledge-consumption supplements.

```text
matching GenomeFact row exists
!= knowledge is epistemically acceptable for automation readiness
```

### F176 / C126 — epistemic prompt eligibility
Home: same `08P` / `09P` pair.

```text
stored/high-ranked GenomeFact
!= current canonical knowledge eligible for KEY prompt reasoning
```

### F177 / C127 — causal learning attribution
Home: `08Q` / `09Q` causal-learning supplements.

```text
one observed/domain outcome
!= causal evidence for every recommendation pattern in that domain
```

### F178 / C128 — knowledge correction lineage
Home: `08R` / `09R` correction-lineage supplements.

```text
source/current knowledge corrected or withdrawn
!= all active derivatives have converged
```

## J17 allocations

### F179 / C129 — Command Center projection completeness

Canonical home:
- `08S-FINDING-REGISTER-COMMAND-CENTER-PROJECTION-SUPPLEMENT.md`
- `09S-CONTRADICTION-REGISTER-COMMAND-CENTER-PROJECTION-SUPPLEMENT.md`

Distinct root:

```text
SOURCE UNAVAILABLE / UNKNOWN
!= SOURCE HEALTHY + ZERO IMPORTANT ITEMS
```

The Command Center's fail-soft aggregation can currently substitute empty/zero fallback values for unavailable sources without exposing source-health/projection-completeness semantics, allowing incomplete inputs to alter health/priority conclusions.

This is not generic service availability; the canonical defect is semantic misrepresentation in a derived operator projection.

## Current ranges

```text
Findings:        F001–F179
Contradictions:  C001–C129
Recommendations: KF-REC-001–KF-REC-050
```

## Filename rule

Supplement letters are organizational labels only, never allocators. Canonical identity is determined by this ledger plus exactly one current home definition.

## Agent pre-allocation gate

```text
1. Load 04A + 04B.
2. Check CURRENT canonical ranges.
3. Search all registers for semantic equivalent.
4. Reuse/refine if equivalent.
5. Allocate only the next globally unused number.
6. Persist the canonical definition in exactly one home file.
7. Update 04B + CURRENT + ROLLOVER.
```

No production implementation is authorized by this ledger.
