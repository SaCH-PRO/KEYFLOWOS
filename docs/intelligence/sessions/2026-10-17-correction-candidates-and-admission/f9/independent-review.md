# Independent review of the isolated F9 correction

**Finding: no substantive blocker found in the reviewed three-file candidate.** This is a local correction review, not admission of PR #181, a new worker assignment, a ready transition or a merge decision.

The reviewed baseline is [ff49859e70cee65e31c09277b05aca4144ff77ea](https://github.com/SaCH-PRO/KEYFLOWOS/commit/ff49859e70cee65e31c09277b05aca4144ff77ea). The bounded change is [correction.patch](correction.patch). The existing [published review](https://github.com/SaCH-PRO/KEYFLOWOS/pull/181#pullrequestreview-5560243413) remains the defect record.

## Source and proof verification

I verified all 39 exported baseline Git blobs, that exactly the three declared files differ, each candidate SHA256 below, and the hashes of all three existing TAP transcripts in [proof-summary.json](proof-summary.json). I inspected the five new negative failures: each is the intended zero-merge assertion failing with one synthetic PUT, not an infrastructure or fixture error. I did not independently rerun those full suites.

| Reviewed candidate file | SHA256 |
|---|---|
| scripts/agent-control/lib/merge-grant.mjs | 5117a5ca06bc61ab8013c1a77fed8ab131abb6c491cf681478a4dce81cdf0712 |
| scripts/agent-control/tests/helpers/synthetic-github.mjs | 5cd686d7038aeba135ec9b673ea65fa1a4fc5cc7d82c3f85c0d94c214388edeb |
| scripts/agent-control/tests/merge-cli.spec.mjs | 1070ca93610c22a50961dcd0f508314f5daaf5eebcc9f36eaa2e46a94102eced |

The inspected Root suite results were: original 76/77 with the known pagination failure; new requirements against original runtime 12/17 with five invalid-release assertion failures; corrected candidate 84/84 with zero skips. These remain Root's executions, separately verified by reading and hash checking.

## Semantic assessment

The new release predicate delegates to the existing [effect reader](https://github.com/SaCH-PRO/KEYFLOWOS/blob/ff49859e70cee65e31c09277b05aca4144ff77ea/scripts/agent-control/lib/authority-effects.mjs). Only an accepted HOLD_CLEAR clears the packet hold. Invalid release envelopes/effects leave refusal intact; a valid later explicit release still works. Parser, effect vocabulary and global projection remain unchanged.

The synthetic preload accepts a file path before considering the existing inline JSON variable. A missing or invalid selected file fails before the CLI runs. The preload retains its complete in-process fetch replacement and has no live-network fallback. The test transport change therefore preserves the old inline fixture while removing the oversized environment value.

Pagination coverage still contains 150 filler comments. It checks a later-page grant, a later-page revocation, and a later-page revocation appearing only in the second snapshot. The latter checks four comment-page reads and zero merge PUTs.

## Exactly nine independently executed predicate checks

| # | Scenario | Observed result |
|---|---|---|
| 1 | Valid release occurs before a later hold | Target remains held |
| 2 | A new hold follows a valid release | Target remains held |
| 3 | Invalid release is followed by a valid release and a new grant | Grant accepted |
| 4 | Valid release names another packet | Target remains held |
| 5 | Invalid release follows a valid grant | Grant superseded |
| 6 | Duplicate-effect release precedes a later hold | Target remains held |
| 7 | Release comment has edited provenance | Authority collection unverified |
| 8 | Same HOLD → invalid RESUME → grant counterexample on original and candidate | Original grants; candidate refuses |
| 9 | Duplicate-effect release follows the hold | Target remains held |

Case 6 deliberately records the ordering of the first executed command, which constructed the malformed release before the hold. Case 9 separately verifies the malformed release after the hold. They are not presented as two different malformed effects.

The commands were recovered into [independent-extra-checks.mjs](independent-extra-checks.mjs) and replayed successfully: [nine-check result](independent-extra-checks-result.json). This also repeats the source/transcript hash verification without rerunning Root's suites.

## Actual CLI inline-fixture compatibility

I independently ran the real candidate CLI with the retained inline KF_SYNTHETIC_GITHUB input: **exit 0, two complete snapshots, one in-process synthetic merge PUT, zero real network requests and zero real merges**. The merge response explicitly identifies itself as synthetic. No candidate file was changed.

The recovered executable is [independent-inline-cli.mjs](independent-inline-cli.mjs), with its [saved result](independent-inline-cli-result.json). It accepts an optional path to the existing synthetic positive-control scenario; its default points to the local f9-review fixture. The actual CLI JSON was checked in memory. No original raw stdout transcript was persisted, and none is assigned an invented identity here.

## Remaining limits

Both independent executions use Node 24.19.0 / Linux. Node 20 hosted proof, Windows proof, mutation-control manifest integration, the full relevant project gates and final published-head proof remain outstanding. This review does not convert local evidence into those results.

The eventual implementation must preserve exact source/artifact/base binding, existing semantic-review failover and the two-snapshot merge path. The existing gap between the final authority read and the SHA-pinned merge call is disclosed in the baseline contract and is not made atomic by this bounded fix.

No remote record, candidate source, worker process, provider, production system, ready flag or merge state was changed by this review.
