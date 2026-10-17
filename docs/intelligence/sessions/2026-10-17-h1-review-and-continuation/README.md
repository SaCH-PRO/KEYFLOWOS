# H1 independent review and programme continuation — 17 October 2026

Status: **CHANGES_REQUIRED for H1.** Seven substantive correction groups. Evidence and continuation checkpoint; no admission, merge grant, application completion credit or production claim.

Later continuation is recorded in [the worker review and F9 follow-through session](../2026-10-17-worker-review-followthrough/README.md). It includes the subsequent F9 ACK, #169/#175 reviews and #155 check closeout. The earlier snapshots and proof below retain their original observation times.

The operator accepted continued execution of the existing plan toward its full acceptance contract. This session advances actual review and dispatch; it does not replace the programme DAG or activate draft PR177. The preserved plan is [the accepted capability roadmap](../../handoff/ACCEPTED-CAPABILITY-ROADMAP-2026-10-17.md).

## Revision and scope

- Runtime main: `98ee0202499ba87fa4ee13d58a2a9075016225bd`.
- H1 PR179 semantic head: `1539ac53d4c5c740898de695d9b35ae3c5bdacf6`.
- H1 artifact head: `b9baa28f7b637e6f0f6a3a0dddbc8418570c1ce5`, draft and unmerged.
- The semantic-to-artifact tail changes only the two `.agent-control` files.
- Scope: independent review of [issue178](https://github.com/SaCH-PRO/KEYFLOWOS/issues/178) and [RETURN6230685195](https://github.com/SaCH-PRO/KEYFLOWOS/issues/80#issuecomment-6230685195).
- Reviewers: ChatGPT, independently of Claude's implementation, with parallel source/authority/surface analysis. Root reproduced the reported failures on the repository's declared Node20.18.1 runtime.
- Existing P0/PR155 proof remains in [the preceding review](../2026-10-17-p0-safety-review/README.md), unchanged.

## Seven correction groups

| ID | Priority | Finding and exact source anchor | Required correction proof |
| --- | --- | --- | --- |
| H1-F1 | P1 | `handoff-projector.mjs:580–585` treats AUTHORITY-envelope validity as effect validity and retains the first grant after a newer correction. A DIRECTIVE/PACKET_ADMISSION or a REVIEW without valid source_main renders GRANTED despite canonical readEffect rejection; a later valid correction can coexist with GRANTED. | Observe admitted effect semantics and relevant ordering. Invalid, revoked or superseded grants cannot appear current. Preserve historical evidence separately; do not change the canonical parser/reducer or create another authority owner. |
| H1-F2 | P1 | `handoff-collector.mjs:297–299,348–351` fingerprints count/global max timestamp/deletions/PRs instead of all relevant comment evidence. A fetched delayed edit below the newest event timestamp leaves the old authority projection verified and FRESH. | Body, identity, edit and provenance changes invalidate projection, including equal timestamp precision and delayed edits. Identical reordered input stays idempotent. |
| H1-F3 | P2 | `handoff-collector.mjs:159` overwrites a 304 response's current pagination Link with the cached one. At 100→101 comments the incremental pass sees101, then a full pass drops to100 and remains PARTIAL on retries. | Preserve current conditional-response pagination metadata; prove recovery across first and later page boundaries and define absent-link semantics. |
| H1-F4 | P2 | `handoff-collector.mjs:282–307,348–364` commits incomplete evidence as the current snapshot. A requested PR timeout still yields COMPLETE/FRESH and advances success time; a count mismatch replaces the last complete RETURN-bearing snapshot. | Overall complete success requires all requested sources. Preserve the last complete snapshot and time; expose partial evidence separately and keep recovery bookkeeping coherent. |
| H1-F5 | P2 | `handoff-collector.mjs:276–279` and `handoff-projector.mjs:600–605` use only the original directive's PR. A null-PR implementation request followed by a correlated RETURN naming its new PR yields zero PR fetches and permanent current-revision UNKNOWN. This is the actual H1 shape. | Resolve an effective PR from unambiguous accepted correlation with provenance; retain the historical request and reject contradictory references. |
| H1-F6 | P2 | `handoff-collector.mjs:348–351`, projector age computation and page `page.tsx:33–36` freeze time-derived claims. An unchanged successful refresh shows60-second-old progress after3660 seconds. A disconnected browser still shows FRESH after300 seconds with a180-second stale threshold, although its separate error banner is visible. | Compute ages/freshness against current time; preserve source timestamps/content generation. Cover unchanged successes and failed browser polls; distinguish attempted from successful refresh. |
| H1-F7 | P2 | `handoff-projector.mjs:213–245` redacts raw body text while parsed outward metadata remains unredacted. A synthetic supported GitHub-token marker in reviewer_model survives in API provenance and the actual TaskDetail rendering. | Keep original identities internal for correlation; consistently redact every outward text-bearing field after correlation. Test serialization and rendering without conflating redacted identities. |

All file anchors refer to `scripts/agent-control/lib/` except the frontend page under `apps/web/src/app/admin/mission-control/handoffs/` and its `_components/handoff-panels.tsx` consumer.

## Executed proof and limits

- Direct Node20.18.1 execution of the unchanged original H1 suite: **43/43 passed**, zero skipped/todo.
- `proof/regression-expectations.spec.mjs`: **8/8 expected-correct assertions fail substantively**, zero skips, against the unchanged implementation. These expose gaps in the original43; they are intentionally failing review probes, not accepted green tests.
- `proof/reproduce-pagination-age.mjs`: successful reproductions of pagination, frozen age and missing produced-PR collection.
- The actual unchanged page, panels and typed client were TypeScript-transpiled and rendered with React19.2.0/ReactDOM, JSDOM24.1.3, TypeScript5.9.3 and an isolated fake-clock harness. Root reran both component reproductions under Node20.18.1. The disconnect harness uses the real fixture collector/projector and a simulated API transport. The redaction harness uses a deliberately fake marker, never a real credential.
- Component proof is not a full Next browser/Nest/production test. Full endpoint/compiled-loopback/browser source was inspected; builder-reported results are not claimed as root-executed proof.
- Seven exact-artifact workflow runs report success, including all five required workflow names. This does not turn skipped admission/security/e2e steps into proof. Copilot review5556442822 is NOT_RUN because of quota, not PASS.
- The local `node --test` child runner exposes only a file-level result in this execution environment. The retained proof uses direct Node execution and includes substantive assertion counts/failures. No local full portable or Windows suite claim is made.
- No tracked H1 files, guards, parser, reducer or existing tests were edited. No production, DB, provider, worker/process or deployment effects were exercised.

Known approved limits remain: default-off configuration, dist-only production image reporting UNAVAILABLE, H2 telemetry and H3 alerts outside scope. These are not counted as new defects. RETURN-declared review outcome and requester decision are deliberately separate; no extra finding requests conflating them. Public-account/model-claim trust is reported under the accepted provenance model, not promoted into an unapproved identity architecture.

## Reproduce

Use a clean checkout of the artifact SHA above and Node20.18.1. Set `KF_H1_REPO` to that checkout or run from its root. Run the original test file directly. Run `proof/regression-expectations.spec.mjs` directly and expect exit1 with eight assertion failures on this reviewed revision. Run `proof/reproduce-pagination-age.mjs` and expect exit0 with the observed defects printed.

For the two `.cjs` component probes, install only the isolated dependencies in `proof/package-lock.json` into a temporary harness directory using `npm ci --ignore-scripts --no-audit --no-fund`, copy the two probes there, set `KF_H1_REPO` and `KF_H1_OUTPUT` to separate checkout/output paths, then invoke Node20.18.1. The copied package lock is harness-only, not a repository dependency change. Synthetic fixture event dates are not collection timestamps.

## Published control records and next actions

H1's actual independent verdict is CHANGES_REQUIRED. The [exact-head PR review5559790458](https://github.com/SaCH-PRO/KEYFLOWOS/pull/179#pullrequestreview-5559790458) and [PROGRESS receipt6240049267](https://github.com/SaCH-PRO/KEYFLOWOS/issues/80#issuecomment-6240049267) are published. All seven correction groups remain queued under the H1 owner while the agreed P0 F9 repair takes the next bounded implementation assignment. No competing H1 correction assignment was issued.

[PR155 review6240050804](https://github.com/SaCH-PRO/KEYFLOWOS/issues/80#issuecomment-6240050804) formalizes the narrow semantic PASS and explicitly settles the obsolete re-anchor demand/valid scope contradiction. [F9 directive6240051686](https://github.com/SaCH-PRO/KEYFLOWOS/issues/80#issuecomment-6240051686) was posted last and is the selected worker assignment. Both use NO_STATE_CHANGE to preserve the existing active application packet and give no merge grant. `recipient: chatgpt` does not suppress current worker selection; the no-work instruction on the #155 review is explicit. Draft parser validation used synthetic metadata. The three actual posted comments were fetched back and match their prepared bodies, account and unedited timestamps exactly; see [publication receipts](control/publication-receipts.json).

The full publication snapshot contains 1,436 comments through event6240077811 at 20:01:38 UTC. The unchanged, blob-verified main parser/reducer/reconciler applies all31 effects after the generation87 checkpoint: generation118/118, CONSISTENT, no unapplied effects, no active holds and no merge authority. The application remains KF-EXEC-AUTH-FAIL-CLOSED-001 / FIXING_PROOF_FAILURES / YELLOW. An empty selector cursor chooses F9; that is assignment eligibility, not observation of an installed cursor or process. No F9 ACK appears in this snapshot. [Replay result](control/authority-replay-result.json), [source/snapshot manifest](control/source-and-snapshot-manifest.json), and [repository truth](control/repository-truth.json) retain the evidence. The small publication wrapper reuses the preceding frozen replay runner with a separately identified snapshot and verifies that the new contradiction ruling actually applied. Historical descriptive checkpoint fields can remain stale despite a consistent effect fold.

PR177's [author correctiondc6d2c57](https://github.com/SaCH-PRO/KEYFLOWOS/commit/dc6d2c57fab20dda789a97c26c9980f6b6947b8e) removes the false claim that ACTION's historical hold still applies. It cites the existing unedited HOLD_CLEAR and replay, preserves newer-hold and bounded-scope checks, and acknowledges the original F3 review's mistaken premise. It is a correction to the inactive proposal, not independent acceptance or a worker release.

PR155's [control evidence commitb30acfa7](https://github.com/SaCH-PRO/KEYFLOWOS/commit/b30acfa7dcd4fdf96c67747ff8c4a66e4026937e) now records the actual semantic review and settled contradiction in its two packet artifacts. The final remote blobs and the entire fe791816-to-b30acfa7 control-only tail were verified. It retains PENDING_CHATGPT_REVIEW for the separate admission stage, draft status and merge_authority false. The completed semantic reading is explicit under semantic_head_review. Historical proof, the original first-run timeout, actual hosted skips and separately owned follow-on defects remain visible. Numeric failed/skipped counters describe the final historical local runs only.

The [prepared-record validator](control/pr155-record-validation-node20.json) passed under root's Node20.18.1 execution: binding and pre-RETURN rules have no problems, actual independent semantic evidence is satisfied, and both draft and pending-status admission barriers reject. The [original17-test artifact suite and three existing mutation controls](control/pr155-record-test-evidence.json) were executed under Node24.19.0 during preparation; each mutant failed at its intended assertion. These are metadata/preparation checks, not new application-suite execution or final artifact-head CI. New exact-artifact workflows were observed starting; their completion and admission disposition remain pending and must be read afresh.

The existing quiet continuation task is confirmed enabled, retaining its two-hour cadence. It now performs applicable already-authorized bounded work and reports material outcomes in WORK DONE / CURRENT SNAPSHOT / PLAN FORWARD form. No duplicate task was created. This records configured continuation, not continuous worker liveness or completed future work.

### Evidence-branch integration obligation

PR180 remains draft on the canonical intelligence base. [Branch divergence run39064708171](https://github.com/SaCH-PRO/KEYFLOWOS/actions/runs/39064708171), at the first continuation evidence head37009d60, failed its push comparison against main:143 commits unique to main,706 unique to the evidence head,728 differing files. The existing intelligence base was already704 ahead/143 behind main; the actual PR at that point was2 ahead/0 behind its declared base with65 documentation files. Default thresholds were25 commits/50 files and no override matched. This is inherited stack divergence plus the evidence change's own file-count obligation, not an application or H1 test result. A scoped intelligence integration/policy disposition remains with PR convergence; no automatic retarget, mass rebase, gate change or unsupported success claim is made.

The scope ledger has no dropped obligations. H1 correction, #155 admission/integration, F9 implementation, separate Flow fixes, worker reliability, continuity/PR convergence, integrated KEY/product proof and final release qualification remain visible. Completion credit stays five application checkpoints out of35, with30 uncheckpointed, and no whole-product percentage asserted.
