# H1 independent review and programme continuation — 17 October 2026

Status: **CHANGES_REQUIRED for H1.** Seven substantive correction groups. Evidence and continuation checkpoint; no admission, merge grant, application completion credit or production claim.

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

## Control and next actions

H1's actual independent verdict is CHANGES_REQUIRED. Publish it as an exact-head PR review and a PROGRESS receipt on #80, preserving all seven correction groups as queued H1 obligations while the agreed P0 F9 repair is dispatched. Do not issue and immediately supersede a separate H1 correction assignment.

PR155's narrow PASS is carried through the formal typed REVIEW and explicitly settles the obsolete re-anchor demand/valid scope contradiction. It is not a merge grant. Post the bounded F9 directive last so it is the single newest executable worker assignment. Both use NO_STATE_CHANGE to preserve the existing active application packet. `recipient: chatgpt` does not suppress current worker selection; the no-work instruction on the #155 review is explicit. Draft validation used synthetic metadata; live publication readback is recorded separately.

The scope ledger has no dropped obligations. H1 correction, #155 admission/integration, F9 implementation, separate Flow fixes, worker reliability, continuity/PR convergence, integrated KEY/product proof and final release qualification remain visible. Completion credit stays five application checkpoints out of35, with30 uncheckpointed, and no whole-product percentage asserted.
