# KEYFLOWOS Open PR Convergence Board

Status: ACTIVE TRIAGE
Board ID: KF-OPEN-PR-CONVERGENCE-001
Baseline main at refresh: ac3a6384417093f198bcc7d672b0dbc295db137c
Created: 2026-10-05
Refreshed: 2026-10-06

## Purpose

Every open PR is either:
- actively advancing;
- a dependency/input to an active programme;
- a candidate for rebase/extraction;
- superseded by newer admitted work;
- intentionally held for later evidence;
- or historical/archaeological.

No PR may remain indefinitely open without a disposition.

## Current active spine

Recent completed checkpoint:
- #147 KF-EXEC-ACTION-001 is MERGED/CHECKPOINTED on main at ac3a6384417093f198bcc7d672b0dbc295db137c. It is no longer an open-PR dependency.

| PR | Purpose | Current disposition |
|---|---|---|
| #155 | parsed-command autonomy fail-closed safety correction | ACTIVE CRITICAL SAFETY PATH. Semantic head 8987f6db has ChatGPT PASS; latest observed control head fdc900b7 has green exact-head workflows. Admission is blocked by stale derived control state, not by a known new application-code failure. Do not merge until the reducer compatibility repair restores a current projection and admission is re-evaluated. |
| #157 | whole-system convergence / canonical intelligence continuity | ACTIVE CONTINUITY REPAIR. Refreshes stale START-HERE/CURRENT/HANDOFF/ROLLOVER state. Keep draft while current live control state continues to move and external preview/review checks are incomplete. |
| #154 | durable multi-lens research corpus | ACTIVE RESEARCH ONLY. Preserve research authority boundary; branch-divergence failures/cancellations are not green. |
| #156 | cross-converge research corpus with GenAI stack | ACTIVE RESEARCH ONLY, dependent on #154 lineage. No implementation authority. |
| #152 | PR value/unlock contract | ACTIVE CONTROL-PLANE PLAN/FOUNDATION. U0 is non-blocking; rebase/revalidate against current main before admission. |
| #149 | parallel Claude orchestration plan | ACTIVE PLANNING. Preserve one serialized admission lane; do not activate multi-worker runtime until control-state correctness is current. |
| #148 | Memory / Context Genome convergence plan | ACTIVE PLANNING. Reuse #127/#112/#134/#136/#128 rather than add another memory owner. |
| #141 | Living System Atlas foundation | ACTIVE FOUNDATION. Admit before downstream Atlas stack. |
| #142 | deterministic Atlas materializer | ACTIVE STACKED. Revalidate proof and parent state before admission. |
| #143 | canonical journey/kernel intelligence import | ACTIVE STACKED behind #142. |
| #144 | packet -> journey/kernel semantic index | ACTIVE STACKED behind #143. |
| #145 | verified Atlas -> code links | ACTIVE STACKED behind #144. |
| #146 | Mission Control + Atlas read model/UI | ACTIVE STACKED CONTROL PANEL behind #145; read-only until authority contracts are separately admitted. |

Control-plane blocker outside the PR list:
- KF-META-AUTHORITY-EFFECT-COMPAT-001 is released on issue #80 to normalize the two historical effect aliases that currently block reducer replay. It intentionally has no merge authority and must remain separate from PR #155.

## Existing work to converge, not duplicate

| PR | Purpose | Disposition |
|---|---|---|
| #139 | native-capacity shadow loop | REUSE AS READ-ONLY PARALLEL-LANE CANDIDATE. Worker-proof failure remains to characterize. |
| #136 | procedural morphogenesis contracts | REUSE IN MEMORY M8 / procedural learning. Current workflows are green. Do not create a second procedure schema. |
| #134 | make dormant knowledge ingestion reachable | HOLD / EXTRACT AFTER MEMORY M0-M1. Do not merge chunk/embed-first ingestion before provenance/claim semantics converge. |
| #133 | assurance / proof obligation compiler | REUSE IN PARALLEL-AGENT ADMISSION after MVP. Current Agent Control Gate was red at its existing head. |
| #132 | earlier Mission Control read-only dashboard | SUPERSEDED-IN-PART BY #146. Compare unique semantics; preserve useful read-model work, then close rather than merge a second dashboard. |
| #128 | KEY cognitive archaeology + convergence | CANONICAL INTELLIGENCE INPUT. Reconcile into durable intelligence and use for memory/context/cognition work. |
| #127 | static memory truth audit | REUSE AS MEMORY M0 STARTING POINT. Expand coverage rather than create a second memory scanner. |
| #114 | proof integrity / no fake green | REBASE OR EXTRACT. High-value laws, but stale/diverged branch and old control artifacts make wholesale merge unsafe. |
| #112 | context-genome substrate | REASSESS / REUSE AFTER MEMORY M0. Candidate lineage/context implementation; no competing Context Genome types. |
| #111 | per-packet authority queue | PRIMARY REUSE CANDIDATE FOR MULTI-WORKER DISPATCH. Do not build another queue. |
| #109 | earlier typed state reducer | SUPERSESSION AUDIT against merged #120. Preserve only semantics not already admitted; likely close after audit. |
| #107 | branch roles / divergence semantics | REUSE for packet worktree ownership and branch-role validation. |
| #105 | Connector Fabric architecture | INPUT TO ingestion/local-first sync/provider ownership. Keep on intelligence branch and reconcile with current architecture. |
| #94 | old AI review gate | SUPERSESSION / EXTRACTION AUDIT. Current review/admission system evolved beyond it. Preserve missing exact-head reviewer semantics only. |
| #93 | platform convergence programme | STRATEGIC INPUT already materially present on main. Reconcile stale PR lineage rather than duplicate. |
| #91 | Node 24 / Vercel compatibility | REASSESS AGAINST CURRENT runtime pin (main currently Node 20.18.1). Do not merge blindly; current runtime state may have intentionally diverged. |
| #90 | Copilot review guidance | REASSESS for provider-neutral reviewer lane. Do not hard-code Copilot as the only authority. |
| #75 | Resend external-effect certainty | INPUT TO external-reality/evidence semantics. Rebase and reassess before implementation admission. |
| #63 | free contact enrichment / Apollo optional | PRODUCT FEATURE PR; rebase/current-behavior audit required because it predates the current architecture/control regime. |
| #38 | KEY IRONCLAD consciousness services | ARCHAEOLOGY / SELECTIVE EXTRACTION ONLY. Do not merge wholesale until reachability and overlap against current KEY cognition are proven. |

## Immediate work order

1. Complete the bounded authority-effect compatibility repair and replay issue #80 from RECOVERY-021 without skipping authority messages.
2. Re-derive/checkpoint the live control projection through the admitted reducer owner.
3. Re-evaluate #155 exact-head admission and checkpoint only if semantic, CI/proof and control-state evidence agree.
4. Keep #157 current with the live control state, then admit its intelligence-only continuity changes through the canonical intelligence branch.
5. Rebase/revalidate #152 and #149 against current main before any control-plane adoption.
6. Admit/rebase the Atlas stack in order #141 -> #146; no child inherits a stale parent green.
7. Rebase/expand #127 into the M0 memory truth audit defined by #148 and reconcile overlapping memory/cognition/learning PRs.
8. Integrate #154 then #156 through their intended research lineage while retaining RESEARCH_ONLY status.
9. Audit superseded/stale PRs (#132/#109/#114/#112/#94/#93/#91/#90/#75/#63/#38) and close only after unique value is extracted.

## Global invariants

- No "merge everything" behavior.
- No stale-green inheritance.
- No PR merged solely because historical CI was green.
- Every active PR is reviewed at its current exact head.
- Every stale PR must be rebased or selectively extracted before admission.
- Superseded work is closed only after unique semantics are accounted for.
- No duplicate dashboard, queue, reducer, memory authority, review gate, or ingestion runtime.
- Production/provider effects remain separately authorized.
- Mission Control should eventually display this board from machine-readable programme state rather than a hand-maintained file.
