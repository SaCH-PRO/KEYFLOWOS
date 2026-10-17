# Fresh authority replay — 17 October 2026

**CONSISTENT, generation 118 of 118, with zero reconciliation findings.** This is a new frozen observation from a complete 1,461-comment collection of [issue #80](https://github.com/SaCH-PRO/KEYFLOWOS/issues/80). Collection began at 22:09:12 UTC; associated repository reads finished at 22:10:54 UTC. It supersedes reliance on the historical 1,445-comment replay for this observation. It issues no authority and changes no checkpoint.

## Executed method and collection

The two published replay methods were recovered unchanged from [9e222e8e](https://github.com/SaCH-PRO/KEYFLOWOS/tree/9e222e8e3b739fafa539ac0d6f5ff834d4858492). Twenty-three current-main source files, including the checkpoint, programme/platform DAGs, status, truth, reducer, reconciler and selector, were recovered at main `98ee0202499ba87fa4ee13d58a2a9075016225bd`. All 25 source/method Git blobs matched before execution and remained byte-identical afterward.

The connector returned all 15 REST pages: fourteen pages of 100 and a final page of 61. All 1,461 IDs were unique. The issue's before/after comment count matched; an updated-since overlap query returned no intervening additions or edits. The collection is a recorded sequence of API observations, not an atomic server snapshot.

The unchanged `replay-publication.mjs` / `replay-authority.mjs` method ran successfully. A second runner called unchanged current-main `truth.reconcileWithTruth`, `truth.fetchRepoTruth` and `status.buildStatus`, replacing the `gh` runner solely with frozen connector responses. The two paths agree on every reduction effect, finding, hold and authority basis; direct reduction agrees with reconciliation. Node v24.19.0 was used. Both commands exited 0.

**This is a frozen equivalent of the authority/status calculation, not a live invocation of `status.mjs --verify`.** The status builder received an empty adapter registry to avoid credential, version or installed-worker probes. An empty agent list means NOT_OBSERVED, not that no agents exist.

## Verified snapshot

| Field | Fresh result |
| --- | --- |
| Authority candidates | 118: 111 valid, seven malformed before the reviewed checkpoint; two additional candidates rejected by author/sender rules |
| Checkpoint and fold | Generation 87 checkpoint; 31 later typed effects applied; observed generation 118/118 |
| Latest authority and empty-cursor selector |[CG-DIR-F9-001  / 6240051686](https://github.com/SaCH-PRO/KEYFLOWOS/issues/80#issuecomment-6240051686) |
| Active application |KF-EXEC-AUTH-FAIL-CLOSED-001 / PR #155 / FIXING_PROOF_FAILURES / YELLOW |
| Application holds |Zero active; historical ACTION hold is released by [HOLD_CLEAR 5998716917](https://github.com/SaCH-PRO/KEYFLOWOS/issues/80#issuecomment-5998716917) |
| Merge authority and production flag |Both false in the effective projection |
| Application DAG | 35 packets, 37 phase nodes, fully drainable; five checkpointed, one active, 29 waiting; gate wave B |
| Graph dependency candidate |KF-EXEC-TIME-001; graph eligibility does not release that packet or override F9 |
| Prior #155 reanchor contradiction |[Ruling 6240050804](https://github.com/SaCH-PRO/KEYFLOWOS/issues/80#issuecomment-6240050804) is present, unedited, and applied as NO_STATE_CHANGE; the old formal-ruling debt is settled |

The effective application's retained source_main is `ac3a6384417093f198bcc7d672b0dbc295db137c`. The fresh GitHub comparison proves it is an ancestor of current main, five commits behind. Current [PR #155](https://github.com/SaCH-PRO/KEYFLOWOS/pull/155) remains open, draft and unmerged on `impl/kf-exec-auth-fail-closed-001`, at artifact `b30acfa7dcd4fdf96c67747ff8c4a66e4026937e` against base 98ee. The ancestry-based programme reconciliation and exact-head PR admission are distinct checks.

### Platform precision

The successor DAG has 63 packets / 63 nodes, drains fully, and passes its contract checks with ten human gates and 14 inherited never-automatic effects. Its file status is **INACTIVE_SUCCESSOR**. The unchanged `platformProgrammeState()` evaluated against the complete fresh history returns **HELD**, decided by historical [CG-PLAN-PLATFORM-CONVERGENCE-001  / 5826799265](https://github.com/SaCH-PRO/KEYFLOWOS/issues/80#issuecomment-5826799265). That planning message fails the activation envelope, so the evaluator fails closed. The exact reasons are preserved in `status-and-platform-result.json`.

This is an existing non-active successor state, not a newly created application hold or a new task. No activation, platform release or DAG edit follows from this observation.

### Retained stale descriptions

The reducer still carries the checkpoint's October 5 `updated_at`, ACTION application_frontier and old next-action prose saying ACTION is held. Those descriptive fields are exposed in the replay result and must not override the effective empty hold list or the typed HOLD_CLEAR. CONSISTENT establishes agreement under the implemented reconciliation contract; it does not refresh every descriptive field, establish worker liveness, finish F9, or grant #155 admission.

## Reproduction

Local reproduction requires the pinned `source/` export and the separately retained `raw/` collection. This curated publication includes neither directory; it includes their source identities, collection metadata and the two unchanged method files. The commands below apply only after those inputs are restored. No package installation is required.

```bash
node prepare-and-check.mjs
node method/docs/intelligence/sessions/2026-10-17-h1-review-and-continuation/control/replay-publication.mjs \
  --repo-root source \
  --comments-file raw/issue80-comments.json \
  --manifest source-and-snapshot-manifest.json \
  --repo-truth-file repository-truth.json \
  > authority-replay-result.json
```

Run from a disposable copy of this evidence directory if retaining the original output timestamps matters. The preparation runner writes only evidence files beside itself; neither runner edits repository source or checkpoints. The manifest verifies exact source blobs and frozen comment/repository digests. A later or edited comment collection needs a new observation and must not be relabelled as this one.

Canonical comment SHA-256:

`e63b63494742d269f7efee9bc9b0a345b6cf9501248ad782fd3834a1d491762b`

See `source-and-snapshot-manifest.json` for the raw-file hash, all source references, collection evidence and digest method; `repository-truth.json` for the exact repository projection; `verification.json` for cross-entrypoint agreement; and the two result JSON files for complete findings, effects and counts. **Without the full separate raw comment input, the summaries alone cannot reproduce this frozen fold.**

## Scope and next action

Keep CG-DIR-F9-001 selected while its current correction/proof/RETURN contract is outstanding. The existing F9 proof followthrough separately found no posted RETURN through this collection. No typed issue #80 message, checkpoint change, source edit, workflow rerun, ready/merge transition, worker process/installation change, production access or application completion credit occurred in this replay.
