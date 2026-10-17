## Independent ChatGPT review — F9 grant enforcement and executable proof

**CHANGES_REQUIRED — one P1 and one P2.** Reviewed semantics: `739414da0c5faeed1bbaf4a20deab27b9cfa18f1`. Current artifact: `ff49859e70cee65e31c09277b05aca4144ff77ea`. Base: `98ee0202499ba87fa4ee13d58a2a9075016225bd`. The semantic-to-artifact comparison is exactly one commit changing the two `.agent-control` records; both findings remain in the current artifact.

### P1 — An invalid RESUME clears an active target hold

In `lib/merge-grant.mjs`, the hold loop clears its state on any message with `message_type === 'RESUME'` that passes the AUTHORITY envelope profile. That profile does not establish a valid hold-release effect. The existing `readEffect()` contract requires a valid `HOLD_CLEAR`, and the control-plane standard explicitly says only that effect releases a hold.

Executed counterexample: a valid target HOLD/HOLD_SET, then a target RESUME carrying `control_effect: NO_STATE_CHANGE`, then an exact valid grant. The unchanged effect reader rejects the RESUME as `CONTROL_EFFECT_TYPE_MISMATCH`, but the shared grant predicate accepts the sequence. The actual `auto-merge-admitted.mjs --merge` path, with the repository's synthetic fetch preload and no network passthrough, reads two PR/comment snapshots and makes **one SHA-pinned synthetic merge PUT**, exiting 0. The expected result is denial with zero PUTs.

The pure predicate also accepts releases with a missing effect, an unknown effect, `production_touched: true`, or `health: AMBER`, even though the existing effect reader rejects each. Preservation controls confirm that an unreleased hold denies, a valid HOLD_CLEAR restores eligibility, and an unrelated/outside-author/duplicate-effect RESUME does not clear the hold.

Require an effect-valid target RESUME/HOLD_CLEAR before clearing its active hold. Invalid release authority must preserve denial or explicitly report unverifiable authority. Keep the existing parser and effect vocabulary unchanged; preserve exact binding, valid application/meta grants and unrelated-packet separation. Add a distinguishing negative control that fails for the intended unsafe hold release, including the actual CLI path.

### P2 — The pagination fixture cannot launch on Linux

`merge-cli.spec.mjs` serializes the whole scenario into one `KF_SYNTHETIC_GITHUB` environment value. The two-snapshot pagination case produces roughly 174 KB in that value. Local Node 20.18.1/Linux execution failed at process creation with `spawnSync E2BIG`: child status null, no child trace and no comment read. It therefore neither proves nor disproves collector pagination.

This is also a current hosted failure at artifact `ff49859e`: [Worker Proof Ubuntu job 117510274365](https://github.com/SaCH-PRO/KEYFLOWOS/actions/runs/39071628867/job/117510274365) and [Autopilot self-test job 117510274323](https://github.com/SaCH-PRO/KEYFLOWOS/actions/runs/39071628877/job/117510274323) each report **530 tests: 528 passed, one failed, one skipped**, with the pagination assertion at line 181 observing null instead of 0. The hosted logs do not print the spawn error code; E2BIG is the separately reproduced local cause. The skip is the existing authenticated-gh cursor test.

Use a bounded fixture transport such as a temporary scenario file, keep synthetic-only credentials and the no-network preload, and surface child-launch errors explicitly. Preserve more-than-one-page coverage for grant discovery and revocation, plus the two-snapshot path; do not reduce the case to one page or weaken its expected result. A review-only file adapter already allowed the unchanged collector to exercise two pages per snapshot and reject later-page revocation/read failure. That adapter is characterization scaffolding, not a repair committed to this PR.

### Evidence and scope

- The CLI hold counterexample was independently rerun at the current artifact on Node 24.19.0/Linux, preserving a real failing zero-PUT safety assertion and unchanged source. Earlier local proof used Node 20.18.1/Linux.
- Original focused tests at the reviewed semantics: all 21 grant tests pass; admission plus CLI has 55 passes and the one Linux pagination failure. These passing tests do not cover the invalid-release defect.
- The artifact commit resolves the earlier two stale branch-binding failures; it does not change either reviewed defect.
- Claude's local Windows results, current hosted results, and the Linux reproductions are distinct evidence. Current hosted Windows mutation proof was still running at the observation used here; no unobserved LIVE count is asserted.
- Copilot's current artifact review [5560210648](https://github.com/SaCH-PRO/KEYFLOWOS/pull/181#pullrequestreview-5560210648) is NOT_RUN / quota_exhausted.
- All merge calls in these reproductions are in-process synthetic responses. No actual merge, ready transition, business data, provider request, worker installation, or source change was performed by this review.

These are corrections within the existing F9 owner and directive 6240051686. The PR remains draft and carries no merge authority or application checkpoint credit. This PR review records findings; it is not a competing #80 assignment, does not consume an unobserved RETURN, and does not change the active application projection.
