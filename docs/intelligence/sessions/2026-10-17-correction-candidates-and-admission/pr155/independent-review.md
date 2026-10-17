# Independent review — PR #155 admission preparation

**Disposition: no substantive blocker found in the reviewed unbound preparation. This is not an admission decision, ready authorization, merge grant, worker assignment, or application completion.** The two YAMLs remain templates until a real later exact-target REVIEW is posted and read back at a safe authority handoff.

Independent reviewer: `flow_safety_prepare`. Review completed 17 October 2026. Candidate identities reviewed:

| File | SHA-256 |
| --- | --- |
| `.agent-control/active-packet.yaml` | `d4744fc37e8527f2befb835b3b6680152e7b9eff9896198f7b765e29a0131e81` |
| `.agent-control/claude-return.yaml` | `1dc6fa56d4daff3913cd662e847da0b6ff9f409d5e35adcd2149a6bce5ad6645` |

## Findings and evidence

Fresh read-only GitHub checks independently confirmed [PR #155](https://github.com/SaCH-PRO/KEYFLOWOS/pull/155) is open, draft and unmerged at `b30acfa7dcd4fdf96c67747ff8c4a66e4026937e`, on `impl/kf-exec-auth-fail-closed-001`, based on main `98ee0202499ba87fa4ee13d58a2a9075016225bd`. Main still has that exact SHA. The [semantic-to-artifact compare](https://github.com/SaCH-PRO/KEYFLOWOS/compare/fe79181638e373584c3ca3184a39343a132040cd...b30acfa7dcd4fdf96c67747ff8c4a66e4026937e) is ahead by two commits, behind by zero, and changes only the two control files.

[Review 6240050804](https://github.com/SaCH-PRO/KEYFLOWOS/issues/80#issuecomment-6240050804) was reread directly and matches the saved body, with equal created/updated timestamps. It supplies narrow semantic PASS and explicitly consumes RETURN 6112455909. The draft and candidate preserve that consumption as history, leave `return_message_id: null`, and require a separate later admission REVIEW. Current semantic evidence is not being treated as existing admission authority. [Copilot 5559828652](https://github.com/SaCH-PRO/KEYFLOWOS/pull/155#pullrequestreview-5559828652) was independently confirmed as unavailable due to quota at b30acfa7; it is not counted as a passing review.

The actual candidate preserves the original objectives, hard invariant, allowed/prohibited scope, proof obligations, implementation/characterization, historical integration deviation, negative controls, rollback limits, settled contradiction, unresolved findings and Flow/Cortex follow-ons. All safety flags stay false; programme credit stays ZERO. The top-level changes are limited to authority/admission bookkeeping, evidence history, current proof status and matching explanatory prose.

Historical b30acfa7 checks are explicitly under `ci.previous_head_b30acfa7`. Every new-artifact `exact_head_proof` entry remains PENDING, and `future_artifact_head` is null. No self-referential SHA or future CI success is manufactured. Hosted scan, dependency-audit and authenticated-gh skip limits remain disclosed. I checked the existing 50/50 contract-test transcript and its reported zero skips; I did not rerun application suites or hosted controls.

## Independent focused checks

Nine focused checks executed under Node 24.19.0 / Linux, all passing. They verified the 18 pinned source identities, fresh target/lineage and review equality, actual scope preservation, historical/future-proof separation, and a synthetic binding positive control with false authority flags and no new RETURN. Additional negative probes established that:

- A fresh-looking copy of semantic-only review 006, with a different message ID and current artifact binding, still cannot serve as admission.
- An appended `return_comment_id: 6112455909` is rejected as duplicate RETURN consumption.
- Wrong repository or changed semantic head is rejected despite matching PR number.
- Premature PROVEN status for the future artifact is rejected before binding.

The synthetic positive control rendered only in memory. It represents no real comment or decision. Results and the reviewed YAML hashes are in `independent-review-checks.json`, outside the package's publication manifest.

## Remaining boundary

The binder validates caller-supplied snapshots; it is not a live authority reader or a substitute for final source/evidence readback. The real PR must remain draft. The pre-F9 evaluator's failure to independently enforce false merge flags is accurately disclosed; a simulated ready PR passing that older evaluator supplies no merge authority.

Before any actual admission publication, root must reconcile current #80 authority/worker state, obtain the distinct later REVIEW safely, refresh #155/base/checks/reviews, bind its actual immutable comment, verify the resulting two-file scope, and publish from the unchanged prepared parent using a leased update. New artifact proof and any later ready/merge decision remain separate. This review does not introduce F9 as a blanket prerequisite to scope-limited #155 admission.

No candidate, source, publication manifest, remote issue, branch, draft flag, worker or production state was changed by this review.
