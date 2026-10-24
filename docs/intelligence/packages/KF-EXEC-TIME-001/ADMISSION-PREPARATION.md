# KF-EXEC-TIME-001 — admission preparation

Status: **read-only preparation. Not a characterization return, not a release, no authority.** Nothing in the application was changed or run to produce it.
Prepared: 2026-10-11, against `main` `98ee0202499ba87fa4ee13d58a2a9075016225bd`.
Packet definition: `docs/intelligence/execution/KF-EXEC-TIME-001-WORK-OCCURRENCE-ADOPTION.md` on branch `docs/keyflow-intelligence-foundation` (see `docs/intelligence/CANONICAL-SOURCE.md`).

Each statement is marked **verified** (read or run against the ref above) or **not established**.

## 1. What the packet is

Wave B, "Work Occurrence Adoption". Adopt WorkDefinition / WorkOccurrence / Attempt semantics over selected existing scheduler and workflow fabrics, without building a universal workflow engine. Locked invariants: stable occurrence identity; wait, retry and supersession distinct; an attempt is not the logical work; one claimant; no duplicate effect. A no-edit characterization is required before any mutation. Required proofs: concurrent claim, wait then resume, cancel or supersede, crash after claim, stale worker. Mock-only evidence does not count for database or concurrency claims.

The packet's forensic baseline is `main@8f173bfe`. `main` is now `98ee0202`, so the characterization must report source drift first.

## 2. Dependencies

| Dependency | State | Evidence |
|---|---|---|
| `KF-EXEC-K12-001` | satisfied (**verified**) | in the checkpoint's `programme.checkpointed`; `ebbe8862` is an ancestor of `main`. It predates typed effects, so it has no typed CHECKPOINT on #80. |
| `KF-EXEC-ACTION-001` | satisfied (**verified**) | CHECKPOINT on #80 comment 6010515405; PR #147 merged as `ac3a6384`. |
| Selector | **verified** | `node scripts/agent-control/status.mjs --verify` at `98ee0202`: "Next dependency-safe: KF-EXEC-TIME-001 (wave B)", eligible 1. |
| Wave A gate "TRUST-G1 satisfied before Wave B implementation is released", and "returned implementation evidence re-audited" | **not established** | The wave board states the gate. No #80 comment mentions TRUST-G1, and `lib/dag.mjs` does not model it. Whether it was satisfied elsewhere is unknown. |

## 3. What blocks release today

**Verified** in `scripts/agent-control/lib/authority-effects.mjs`: a `PACKET_RELEASE` folds only when no packet is in flight (projected state null or `CHECKPOINTED`), or the same packet is still `CHARACTERIZING`.

The live projection is `KF-EXEC-AUTH-FAIL-CLOSED-001`, `FIXING_PROOF_FAILURES`, PR #155. A release of TIME-001 now would be `CONTROL_EFFECT_PACKET_IN_FLIGHT` and would stop the authority fold for every packet.

So, in order:

1. PR #155 is brought up to `main`, re-proved, freshly reviewed and merged (or its packet is otherwise closed by authority).
2. ChatGPT posts a REVIEW with `control_effect: CHECKPOINT` and `pr_number: 155`.
3. The TRUST-G1 / Wave A re-audit question in section 2 is answered by authority.
4. ChatGPT posts the release DIRECTIVE: `control_effect: PACKET_RELEASE`, `packet_id`, `implementation_branch`, a 40-hex `source_main` on `main`, canonical `health`, `production_touched: false`.

A read-only characterization can run before step 4 under a `NO_STATE_CHANGE` DIRECTIVE, as was done for PR #159. `characterize_ahead_only_when_non_mutating: true` in the programme DAG allows exactly that.

## 4. Where the packet would land in the code

**Verified** by reading `main`; this is a map for the characterization, not the characterization.

- `packages/db/prisma/schema.prisma` has no `WorkOccurrence`, `WorkDefinition` or `Attempt` model.
- Candidate fabrics:
  - `ScheduledAgentJob` (schema line 4237). The poller in `apps/server/src/modules/flow/cross-module-agent.service.ts` runs on a 60-second interval: `findMany` of `PENDING` jobs, execute, then `update`. There is no atomic claim between the read and the update, so two server instances can take the same job. That is the "one claimant" invariant, already violated. Other writers: `modules/conversion/abandoned-cart-recovery.service.ts`, `review-solicitation.service.ts`, `lead-magnet.service.ts`, `modules/marketplace/commerce-integration.service.ts`.
  - `FlowRun` / `FlowRunStep`: sole writer `modules/flow/flow-runner.service.ts`, with a unique `(businessId, idempotencyKey)`.
  - `FlowExecution`: written by `key-cortex-flow-studio.service.ts` and `key-cortex-actions.service.ts`.
  - `WorkflowRun`: no writers found.
  - About 20 `@Cron` services, 11 of them under `modules/key-cortex`; also `command-scheduler.service.ts` and `contracts/contract-renewal.sweep.ts`.
  - `IdempotencyKey`: `key-cortex/key-idempotency.service.ts` and `key-autonomy/action-boundary/key-action-boundary.service.ts`.
- Existing tests near these seams: `flow/flow-runner.tenant-idempotency.spec.ts`, `key-cortex/key-idempotency.service.spec.ts`, `action-boundary/*.spec.ts`.

The counts of cron services and the "no writers" result come from a search, not from running the application. The characterization must re-derive them.

## 5. Overlap with open PRs

**Verified** from changed-file lists on 2026-10-11:

- None of #155, #158, #160, #161, #162, #134 touches `modules/flow`, the schedulers or the Prisma schema.
- #162 and #134 both edit `key-cortex/key-cortex.module.ts`. They collide with TIME-001 only if a key-cortex cron family is chosen as an adopted fabric.

## 6. Suggested first bounded family, for authority to accept or replace

`ScheduledAgentJob` and its single poller. It has one worker, one status column, a known violation of "one claimant", and every acceptance proof (concurrent claim, crash after claim, stale worker) can be exercised against a real database with two poller instances. This is a suggestion from the map above, not a scope decision.

## 7. Not established

- Whether TRUST-G1 or the Wave A re-audit was satisfied outside the repository and #80.
- Whether any deployed database holds occurrence-like rows; nothing deployed was inspected.
- Source drift between the packet's baseline `8f173bfe` and `98ee0202` for the files above.
- Whether `KF-EXEC-AUTH-FAIL-CLOSED-001` earns programme credit at its checkpoint. It is not in the programme DAG.
