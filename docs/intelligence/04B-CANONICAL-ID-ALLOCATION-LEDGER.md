# KeyFlowOS Canonical ID Allocation Ledger

Status: CANONICAL — OVERRIDES LEGACY COLLIDING ALLOCATIONS
Last updated: 2026-09-05

Purpose: provide one unambiguous allocator for Finding (`F###`), Contradiction (`C###`) and Recommendation (`KF-REC-###`) identities after parallel intelligence tranches created overlapping IDs.

## Governing rule

If any historical supplement listed here still says `CANONICAL` for a colliding ID, **this ledger wins**. Historical prose/evidence remains valuable; the old numeric heading is not a canonical allocation.

Never delete or reuse an allocated identity. A historical collision is resolved as either:

- **REMAP** — semantically distinct item receives a new unique ID;
- **ALIAS / SUPERSEDED** — same semantic root is referenced through an existing canonical ID.

## Preserved mature lineage

The following heavily referenced sequence remains unchanged:

```text
F145 missed-schedule semantics
F146 workflow-definition mutation/versioning of waiting work
F147 scheduled EmailCampaign mutable-latest drift
F148 WhatsApp provider acceptance != final delivery
F149 ambiguous WhatsApp/provider outcome != confirmed failure
F150–F159 mature J18 recovery findings
F160 provider artifact remains after local SocialPost delete
F161–F166 J16/K4 epistemic-integrity findings
```

Contradictions remain:

```text
C096 missed-schedule semantics
C097 workflow-versioning inconsistency
C098 provider acceptance vs local SENT
C099 ambiguous external outcome vs definite FAILED
C100–C109 mature J18 recovery contradictions
C110 local SocialPost delete vs provider artifact live
C111–C116 J16/K4 epistemic-integrity contradictions
```

Recommendations remain:

```text
KF-REC-045 missed-schedule/lateness policy
KF-REC-046 workflow-definition versioning / waiting-occurrence binding
KF-REC-047 Temporal Work Projection
KF-REC-048 certainty-aware Recovery Contract (includes OUTCOME_UNKNOWN/provider reconciliation)
KF-REC-049 provenance/revision-aware Business Knowledge Contract
```

## Finding collision reconciliation

| Historical source / old ID | Resolution | Canonical identity |
|---|---|---|
| `08H-FINDING-REGISTER-WORKFLOW-CONTROL-PLANE-SUPPLEMENT.md` F146 — disabled workflow not load-bearing | REMAP | **F167** |
| same file F147 — visible delay config bypassed by runtime | REMAP | **F168** |
| `08I-FINDING-REGISTER-WORK-DEFINITION-PROVENANCE-SUPPLEMENT.md` F148 | ALIAS / strengthened evidence for definition-version provenance | **F146** |
| `08J-FINDING-REGISTER-MISFIRE-RECURRENCE-SUPPLEMENT.md` F149 — DelegationLoop coalesces/drifts recurrence | REMAP | **F169** |
| same file F150 — RecurringInvoice lacks distributed due-occurrence claim | REMAP | **F170** |
| `08K-FINDING-REGISTER-EXTERNAL-OUTCOME-UNCERTAINTY-SUPPLEMENT.md` F151 | ALIAS / cross-provider strengthening of ambiguous-outcome root | **F149** |
| `08L-FINDING-REGISTER-CONTROL-RECURRENCE-REFINEMENT-SUPPLEMENT.md` F152 | ALIAS | **F167** |
| same file F153 | ALIAS | **F168** |
| same file F154 | ALIAS | **F169** |
| same file F155 | ALIAS | **F170** |
| `08L-FINDING-REGISTER-PROVIDER-RECOVERY-SUPPLEMENT.md` F152 — provider idempotency identity missing | REMAP | **F171** |
| same file F153 — Instagram multi-stage checkpoint missing | REMAP | **F172** |
| `08M-FINDING-REGISTER-SCHEDULED-RECOVERY-SUPPLEMENT.md` F154 — ScheduledAgentJob first failure terminal/no generic recovery | REMAP | **F173** |
| `08N-FINDING-REGISTER-COMPENSATION-SUPPLEMENT.md` F155 — two compensation mechanisms can target same failed step | REMAP | **F174** |
| same file F156 — planner overwrites compensation outcome | ALIAS | **F154** |

Canonical new finding range after reconciliation: **F001–F174**.

Canonical definitions for F167–F174 live in `08O-FINDING-REGISTER-TAXONOMY-RECONCILIATION-SUPPLEMENT.md`.

## Contradiction collision reconciliation

| Historical source / old ID | Resolution | Canonical identity |
|---|---|---|
| `09H-CONTRADICTION-REGISTER-WORKFLOW-CONTROL-PLANE-SUPPLEMENT.md` C097 | REMAP | **C117** |
| same file C098 | REMAP | **C118** |
| `09I-CONTRADICTION-REGISTER-WORK-DEFINITION-PROVENANCE-SUPPLEMENT.md` C099 | ALIAS / specialization | **C097** |
| `09J-CONTRADICTION-REGISTER-MISFIRE-RECURRENCE-SUPPLEMENT.md` C100 | REMAP | **C119** |
| same file C101 | REMAP | **C120** |
| `09K-CONTRADICTION-REGISTER-EXTERNAL-OUTCOME-UNCERTAINTY-SUPPLEMENT.md` C102 | ALIAS / cross-provider strengthening | **C099** |
| `09L-CONTRADICTION-REGISTER-CONTROL-RECURRENCE-REFINEMENT-SUPPLEMENT.md` corresponding control/recurrence IDs | ALIAS | **C117–C120** as applicable |
| `09L-CONTRADICTION-REGISTER-PROVIDER-RECOVERY-SUPPLEMENT.md` C102 — delivery identity vs provider idempotency | REMAP | **C121** |
| same file C103 — Instagram multi-stage state/checkpoint | REMAP | **C122** |
| `09M-CONTRADICTION-REGISTER-SCHEDULED-RECOVERY-SUPPLEMENT.md` C104 | REMAP | **C123** |
| `09N-CONTRADICTION-REGISTER-COMPENSATION-SUPPLEMENT.md` C105 — one failed step vs two compensation owners | REMAP | **C124** |
| same file C106 — compensation result overwritten by generic failure | ALIAS | **C104** |

Canonical new contradiction range after reconciliation: **C001–C124**.

Canonical definitions for C117–C124 live in `09O-CONTRADICTION-REGISTER-TAXONOMY-RECONCILIATION-SUPPLEMENT.md`.

## Recommendation collision reconciliation

| Historical source / old ID | Resolution | Canonical identity |
|---|---|---|
| `10D-RECOMMENDATION-REGISTER-WORKFLOW-DEFINITION-CONTROL-CONTINUATION.md` KF-REC-046 — load-bearing workflow control plane | REMAP | **KF-REC-050** |
| `10E-RECOMMENDATION-REGISTER-WORKFLOW-VERSIONING-CONTINUATION.md` KF-REC-046 | PRESERVE | **KF-REC-046** |
| `10F-RECOMMENDATION-REGISTER-EXTERNAL-OUTCOME-RECONCILIATION-CONTINUATION.md` KF-REC-048 | ALIAS / precursor subsumed by broader recovery contract | **KF-REC-048** in `10G-RECOMMENDATION-REGISTER-RECOVERY-CONTINUATION.md` |

Canonical recommendation range after reconciliation: **KF-REC-001–KF-REC-050**.

Canonical KF-REC-050 lives in `10I-RECOMMENDATION-REGISTER-TAXONOMY-RECONCILIATION-CONTINUATION.md`.

## Filename rule

Supplement letters are organizational labels only. They are **not allocators**. Multiple historical `08H`, `08I`, `08J`, etc. filenames may remain for provenance, but canonical identity is determined only by this ledger + canonical home entry.

Future supplements must use the next unused organizational suffix and must check this ledger before allocating IDs.

## Agent pre-allocation gate

Before creating any F/C/KF-REC ID:

```text
1. Load 04A + 04B.
2. Check CURRENT-STATE canonical ranges.
3. Search all existing registers for semantic equivalent.
4. Reuse/refine if equivalent.
5. Allocate only the next globally unused number.
6. Persist canonical definition in exactly one home file.
7. Update 04B + CURRENT + ROLLOVER if allocation changes.
```

No production implementation is authorized by this ledger.
