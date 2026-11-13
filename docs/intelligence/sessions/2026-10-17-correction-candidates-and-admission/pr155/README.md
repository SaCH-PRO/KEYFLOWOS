# PR #155 admission preparation

**Status: LOCAL UNBOUND CANDIDATE. No branch, authority, review, RETURN, draft flag, workflow, production system or provider was changed.** This is the concrete two-control-file admission record to bind at the safe worker handoff. It does not report that admission has occurred.

## Exact target and current evidence

| Identity | Value |
|---|---|
| PR | [#155](https://github.com/SaCH-PRO/KEYFLOWOS/pull/155), open, draft, unmerged |
| Prepared parent | b30acfa7dcd4fdf96c67747ff8c4a66e4026937e |
| Reviewed semantics | fe79181638e373584c3ca3184a39343a132040cd |
| PR base/main | 98ee0202499ba87fa4ee13d58a2a9075016225bd |
| Branch | impl/kf-exec-auth-fail-closed-001 |
| Packet | KF-EXEC-AUTH-FAIL-CLOSED-001 |

[Review 6240050804](https://github.com/SaCH-PRO/KEYFLOWOS/issues/80#issuecomment-6240050804) supplies the narrow semantic PASS, settles the obsolete re-anchor contradiction, accepts the historical integration baseline without fabricating a prior ACK, and assigns the next control-only admission record to ChatGPT. It already consumes RETURN 6112455909.

[Proof receipt 6240756683](https://github.com/SaCH-PRO/KEYFLOWOS/pull/155#issuecomment-6240756683) closes the previous outstanding Windows proof at b30acfa7: 516 tests, 515 passed, zero failed, one named skip, and 193/193 LIVE controls. Ubuntu reports 492/491/0/1. CI/CD reports server 4428/4428, web 210/210 and K12 self-test 16/16 at its declared scope. A fresh REST read in this preparation found seven completed/successful runs covering all five required workflow names. These are hosted historical results; this preparation did not rerun application suites or mutation controls.

[Copilot 5559828652](https://github.com/SaCH-PRO/KEYFLOWOS/pull/155#pullrequestreview-5559828652) is still NOT_RUN / quota_exhausted. The actual compare of fe791816 to b30acfa7 proves two commits changing only the two control files. The provider-neutral evaluator accepts the actual Copilot-unavailable record plus the actual ChatGPT reading.

## Proposed changes

Only the active-packet.yaml and claude-return.yaml files under candidate/.agent-control are intended for the implementation branch. The candidate:

- Sets review status to ACCEPT_FOR_ADMISSION, retaining PROVING / YELLOW, no scope change, zero programme credit and all false safety/grant flags.
- Records the actual provider-neutral semantic_review at top level, with b30acfa7 Copilot-unavailable evidence and the fe791816 ChatGPT reading.
- Binds the later admission authority through two visible placeholders. They cannot be filled with the current semantic-only review.
- Places b30acfa7 hosted results and security/skip limits under ci.previous_head_b30acfa7.
- Leaves every new-artifact gate PENDING, including final artifact review revalidation. It stores no self-referential artifact SHA.
- Preserves application semantics, scope, proof obligations, historical RETURN IDs, settled contradiction, process deviation, and open Flow/Cortex follow-ons. It does not request a repeated worker RETURN.

The placeholders are __ADMISSION_MESSAGE_ID__ and __ADMISSION_COMMENT_ID__. Do not commit the unbound template. The exact review diff is in [admission-candidate.patch](admission-candidate.patch).

## Verified behavior and practical limit

[Validation results](results/validation.json) record **25/25 local cases** using unchanged repository validators from b30acfa7. All **18 exported source files** match their exact Git blob and SHA256 identities.

Both the actual published draft and the candidate status produce pr_is_draft. A synthetic future artifact cannot reuse b30acfa7 successful workflows: workflow_runs_not_at_exact_head. Absent runs report missing_workflows; queued runs report required_check_pending_at_head. A simulated later ready transition requires newer affected checks. Premature PROVEN entries and missing/edited independent evidence are rejected. Application scope and explicit follow-on findings remain unchanged.

The binder rejects a moved head/base, non-draft PR, edited or outside-author review, ambiguous target, merge grant, state-changing effect, or duplicate RETURN consumption. Its positive control renders only in memory using explicitly synthetic review metadata; no such review exists on GitHub. A real CLI invocation with semantic review 006 exits 2 before writing an output directory.

The unchanged return-evidence.spec.mjs and semantic-review.spec.mjs ran against the candidate: **50 tests, 50 passed, zero failed, zero skipped**. Runtime here was **Node 24.19.0 / Linux**, using the runner's no-isolation option. This does not relabel local results as the repository's Node 20 hosted proof.

**Current pre-F9 admission does not independently enforce merge_authority: false.** A diagnostic supplying the candidate and simulating draft: false passes that old evaluator. It is not a merge grant. The real PR must remain draft. F9 is not added as a blanket prerequisite to scope-limited admission; ready/merge remain separate decisions.

## Retained proof limits

The hosted authenticated-gh cursor test remains NOT_RUN. The dependency audit property is FAILED with 260 reported advisories: 12 critical, 107 high, 118 moderate, 23 low; this is not a verified exploitable-path count. Intended TruffleHog coverage is NOT_RUN after unresolved base main and zero scanned bytes/chunks. HawkScan is NOT_RUN because no scan key was present. Existing remediation remains PR #114 and issue #115; this record neither clears production security nor creates a scanner task.

Request-wide effects, the executor BatchResult.results[].result consumer mismatch, cross-field supervised policy, and Flow authority paths remain separate obligations.

## Safe handoff and publication

1. Root reconciles current #80 authority/worker state. Do not post this typed REVIEW while it would replace F9's in-flight authority. A recipient field or NO_STATE_CHANGE does not neutralize the current selector.
2. Re-read #155, main, actual reviews, required runs, timeline and lineage. If the pinned head/base or scope moved, rebuild the preparation.
3. Review [admission-review.DRAFT.md](admission-review.DRAFT.md), choose the unique later message ID, remove its local preparation header, and post only at the safe handoff. Do not consume RETURN 6112455909 again.
4. Read back the unedited review and fresh PR snapshot. Run: node bind-admission.mjs actual-admission-review.json fresh-pr155.json bound-output
5. Root verifies and publishes only the two YAMLs from unchanged parent b30acfa7 with a leased branch update. The helper itself has no network, commit, ready, authority-posting or merge operation.
6. Inspect the new actual SHA, control-only lineage, checks, reviews and proof limits. Save outcomes in a separate evidence receipt. Do not duplicate the consumed worker RETURN or inherit new-head proof from b30acfa7.
7. Keep the PR draft. Later ready/merge requires distinct current authority, exact-artifact proof, affected post-transition checks and the mandated immediate recheck.

The remaining blocker to **recording** admission is the safe authority handoff plus the routine fresh-evidence check at that moment. No newly discovered #155 bounded-code defect is asserted.

## Reproduction

The compact publication manifest omits raw API responses, the full TAP transcript and source copies. The test summary and actual transcript SHA256 are retained in results/verification-summary.json. [Curated input](evidence/validation-input.json) retains every field used by the validator with source URLs.

Recover source from an existing Git repository containing b30acfa7:

    python export-and-verify-source.py --repo /path/to/KEYFLOWOS

The helper uses git archive at the pinned SHA, validates every file before writing, and refuses a nonempty destination. It performs no fetch, checkout, install or source edit. Its --verify-only path was executed against all 18 fetched files. Real Git-archive export was not executed because the commit object is absent from this workspace.

Then run:

    python prepare-candidate.py
    node validate-candidate.mjs

To replay the unchanged suites using Node 24:

    cd candidate
    node --test --test-isolation=none ../source/scripts/agent-control/tests/return-evidence.spec.mjs ../source/scripts/agent-control/tests/semantic-review.spec.mjs

Replay establishes what the saved evidence says. The binder validates caller-supplied metadata; it cannot establish freshness, current worker safety or new remote identity by itself. Those readbacks remain root's responsibility before publication.
