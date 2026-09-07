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
F180 J17 CommandItem false-terminal execution semantics
F181 J17 Temporal priority materialization reachability
F182 J17 CommandItem source-state convergence
```

```text
C096–C110 temporal/external/recovery lineage
C111–C116 initial J16/K4 contradictions
C117–C124 recovered distinct historical collision-band contradictions
C125–C126 J16/K4 knowledge-consumption contradictions
C127 J16/K4 causal-learning attribution
C128 J16/J19 correction lineage
C129 J17 Command Center projection completeness
C130 J17 CommandItem projection vs source/effect truth
C131 J17 overdue domain truth vs absent TemporalFlow projection
C132 J17 resolved source vs still-open CommandItem projection
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

The discovered historical parallel-analysis collision band remains governed by:
- `08O-FINDING-REGISTER-TAXONOMY-RECONCILIATION-SUPPLEMENT.md` — F167–F174;
- `09O-CONTRADICTION-REGISTER-TAXONOMY-RECONCILIATION-SUPPLEMENT.md` — C117–C124;
- `10I-RECOMMENDATION-REGISTER-TAXONOMY-RECONCILIATION-CONTINUATION.md` — KF-REC-050.

Historical files retain evidence but do not re-own remapped numeric IDs.

## J16 allocations

### F175 / C125 — epistemic readiness eligibility
`matching GenomeFact row exists != knowledge is epistemically acceptable for automation readiness`

### F176 / C126 — epistemic prompt eligibility
`stored/high-ranked GenomeFact != current canonical knowledge eligible for KEY prompt reasoning`

### F177 / C127 — causal learning attribution
`one observed/domain outcome != causal evidence for every recommendation pattern in that domain`

### F178 / C128 — knowledge correction lineage
`source/current knowledge corrected or withdrawn != all active derivatives have converged`

## J17 allocations

### F179 / C129 — Command Center projection completeness
Home: `08S` / `09S`.

```text
SOURCE UNAVAILABLE / UNKNOWN
!= SOURCE HEALTHY + ZERO IMPORTANT ITEMS
```

### F180 / C130 — Command spine false-terminal execution semantics
Home: `08T` / `09T`.

```text
CommandItem.status = EXECUTED
!= source approval resolved
!= executionTool ran
!= business effect occurred
!= OutcomeEvidence
```

### F181 / C131 — Temporal priority materialization reachability
Home: `08U` / `09U`.

```text
CONSUMER PRIORITY LOGIC EXISTS
!= PRODUCER PATH IS WIRED
!= DOMAIN CONDITION REACHES THAT PROJECTION
```

Concrete proof: `TemporalFlowService.analyze()` expects `TemporalFlowEvent(source=APP,type=invoice.overdue)` for overdue-invoice urgency/risk, while standard invoice overdue emits EventEmitter `invoice.overdue`; no load-bearing `invoice.overdue → TemporalFlowService.emit()` path or generic app-event listener was observed. `TemporalFlowEvent` create/upsert is owned by `TemporalFlowService.emit()`.

### F182 / C132 — CommandItem source-state convergence
Home: `08V` / `09V`.

```text
SOURCE-DERIVED PROJECTION CREATED
!= PROJECTION REMAINS VALID FOREVER
```

Concrete proof: CommandGenerator creates OPEN `COLLECT_RECEIVABLE` CommandItems from `Invoice.status=OVERDUE`, but the existing `resolveCommandsForEntity()` has no caller and the generator does not reconcile old rows when source predicates stop matching.

## Current ranges

```text
Findings:        F001–F182
Contradictions:  C001–C132
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
6. Persist canonical definition in exactly one home file.
7. Update 04B + CURRENT + ROLLOVER.
```

No production implementation is authorized by this ledger.
