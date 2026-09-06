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
F145 missed-schedule semantics
F146 workflow-definition mutation/versioning of waiting work
F147 scheduled EmailCampaign mutable-latest drift
F148 WhatsApp provider acceptance != final delivery
F149 ambiguous provider outcome != confirmed failure
F150–F160 mature J18 recovery/external-reality findings
F161–F166 initial J16/K4 epistemic-integrity findings
F167–F174 recovered distinct historical collision-band findings
F175–F176 J16/K4 knowledge-consumption findings
F177 J16/K4 causal-learning attribution finding
F178 J16/J19 knowledge-correction lineage finding
```

```text
C096 missed-schedule semantics
C097 workflow-versioning inconsistency
C098 provider acceptance vs local SENT
C099 ambiguous external outcome vs definite FAILED
C100–C110 mature J18 recovery/external-reality contradictions
C111–C116 initial J16/K4 epistemic-integrity contradictions
C117–C124 recovered distinct historical collision-band contradictions
C125–C126 J16/K4 knowledge-consumption contradictions
C127 J16/K4 causal-learning attribution contradiction
C128 J16/J19 knowledge-correction lineage contradiction
```

```text
KF-REC-045 missed-schedule/lateness policy
KF-REC-046 workflow-definition versioning / waiting-occurrence binding
KF-REC-047 Temporal Work Projection
KF-REC-048 certainty-aware Recovery Contract
KF-REC-049 provenance/revision-aware Business Knowledge Contract
KF-REC-050 load-bearing WorkDefinition control contract
```

## Historical collision reconciliation

The discovered historical parallel-analysis collision band is reconciled as follows. These mappings remain authoritative unless a later explicit decision supersedes them.

### Findings

| Historical source / old ID | Resolution | Canonical identity |
|---|---|---|
| workflow-control F146 — disabled workflow not load-bearing | REMAP | F167 |
| workflow-control F147 — visible delay config bypassed | REMAP | F168 |
| work-definition provenance F148 | ALIAS / strengthens version provenance | F146 |
| recurrence F149 — DelegationLoop coalesces/drifts | REMAP | F169 |
| recurrence F150 — RecurringInvoice distributed claim missing | REMAP | F170 |
| cross-provider ambiguous-outcome F151 | ALIAS / strengthens ambiguous-outcome root | F149 |
| control/recurrence refinement F152–F155 | ALIAS | F167–F170 |
| provider-recovery F152 — provider idempotency identity missing | REMAP | F171 |
| provider-recovery F153 — Instagram checkpoint missing | REMAP | F172 |
| scheduled-recovery F154 — no durable recovery owner | REMAP | F173 |
| compensation F155 — two compensation owners | REMAP | F174 |
| compensation F156 — recovery result overwritten | ALIAS | F154 |

Canonical definitions F167–F174: `08O-FINDING-REGISTER-TAXONOMY-RECONCILIATION-SUPPLEMENT.md`.

### Contradictions

| Historical source / old ID | Resolution | Canonical identity |
|---|---|---|
| workflow-control C097 | REMAP | C117 |
| workflow-control C098 | REMAP | C118 |
| work-definition provenance C099 | ALIAS / specialization | C097 |
| recurrence C100 | REMAP | C119 |
| recurrence C101 | REMAP | C120 |
| cross-provider ambiguous outcome C102 | ALIAS / strengthening | C099 |
| control/recurrence refinement IDs | ALIAS | C117–C120 |
| provider recovery C102 — delivery vs provider idempotency | REMAP | C121 |
| provider recovery C103 — Instagram checkpoint | REMAP | C122 |
| scheduled recovery C104 | REMAP | C123 |
| compensation C105 — two compensation owners | REMAP | C124 |
| compensation C106 — recovery result overwritten | ALIAS | C104 |

Canonical definitions C117–C124: `09O-CONTRADICTION-REGISTER-TAXONOMY-RECONCILIATION-SUPPLEMENT.md`.

### Recommendations

| Historical source / old ID | Resolution | Canonical identity |
|---|---|---|
| workflow-definition-control old KF-REC-046 | REMAP | KF-REC-050 |
| workflow-versioning KF-REC-046 | PRESERVE | KF-REC-046 |
| external-outcome old KF-REC-048 | ALIAS / precursor subsumed by broader recovery contract | KF-REC-048 |

Canonical KF-REC-050: `10I-RECOMMENDATION-REGISTER-TAXONOMY-RECONCILIATION-CONTINUATION.md`.

## Post-reconciliation J16 allocations

### F175 / C125 — epistemic readiness eligibility

Home: `08P-FINDING-REGISTER-KNOWLEDGE-CONSUMPTION-SUPPLEMENT.md` / `09P-CONTRADICTION-REGISTER-KNOWLEDGE-CONSUMPTION-SUPPLEMENT.md`.

```text
matching GenomeFact row exists
!=
knowledge is epistemically acceptable for an automation-readiness requirement
```

### F176 / C126 — epistemic prompt eligibility

Home: same `08P` / `09P` pair.

```text
stored/high-ranked GenomeFact
!=
current canonical knowledge eligible for KEY prompt reasoning
```

### F177 / C127 — causal learning attribution

Home: `08Q-FINDING-REGISTER-CAUSAL-LEARNING-SUPPLEMENT.md` / `09Q-CONTRADICTION-REGISTER-CAUSAL-LEARNING-SUPPLEMENT.md`.

```text
one observed/domain outcome
!=
causal evidence for every recommendation pattern in that domain
```

F177 is distinct from F166: F166 concerns incorrect semantic labeling of process/control evidence; F177 concerns broad propagation without sufficiently specific causal/action-pattern lineage even when outcome observations exist.

### F178 / C128 — knowledge correction lineage

Home: `08R-FINDING-REGISTER-KNOWLEDGE-CORRECTION-LINEAGE-SUPPLEMENT.md` / `09R-CONTRADICTION-REGISTER-KNOWLEDGE-CORRECTION-LINEAGE-SUPPLEMENT.md`.

```text
current/source knowledge corrected or withdrawn
!=
all active derived recommendations, memories, readiness and prompt context have converged
```

F178 is deliberately scoped to fine-grained correction/withdrawal lineage. It does not assert whole-business GDPR purge failure.

## Current ranges

```text
Findings:        F001–F178
Contradictions:  C001–C128
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
