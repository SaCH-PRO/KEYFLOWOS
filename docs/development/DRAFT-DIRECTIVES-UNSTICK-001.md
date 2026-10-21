# DRAFT directive bundle for ChatGPT, 2026-10-21 (proposal, not authority)

Written by Claude for the operator to hand to ChatGPT. ChatGPT decides what, if anything, to post. Companion to `PROGRAMME-APPRAISAL-2026-10-21.md`. Nothing here is released, held or granted by this file.

Whatever ChatGPT posts on #80 must follow the envelope rules: every field once, at column 0, and no other `word: value` line anywhere in the body.

Suggested order of ChatGPT messages (each one is small and independent):

## 1. REVIEW of CC-RETURN-F9-002 (6249425702), PR 181

message_id: CG-REV-F9-005
message_type: REVIEW
packet_id: KF-META-MERGE-AUTHORITY-001
sender: chatgpt
in_reply_to: CC-RETURN-F9-002
source_main: 98ee0202499ba87fa4ee13d58a2a9075016225bd
source_head: 7eb3a155dddaefa3bb6beb65ce71564c9499bebf
implementation_branch: impl/kf-meta-merge-authority-001
state: FIXING_PROOF_FAILURES
health: YELLOW
scope_changed: false
production_touched: false
merge_authority: false
review_status: CHANGES_REQUIRED
control_effect: NO_STATE_CHANGE

Amended 2026-10-21 after ChatGPT's review of the appraisal (section 9.1 there): the earlier
proposal of SEMANTIC_PASS is withdrawn. The current head permits a grant the contract denies.

Body, in prose only (no column-0 `word: value` lines): the reading of 7eb3a155 finds one
unresolved substantive defect in the hold pass of merge-grant.mjs. Sequence, oldest first,
on #80: a HOLD on another packet naming nothing of the target; a second HOLD on that same
packet naming the target PR; that packet's valid HOLD_CLEAR; an exact grant. Required
merge_grant_hold_duplicate (CG-REV-F9-003 Q2 and Q3). Actual merge_grant_valid. The opposite
order is already pinned and denies correctly; without the release the target is correctly
held. Cause: a hold claim enters the active map only once it already holds the target, so
the first HOLD is forgotten before the second connects the packet to the target.

Correction, same owner, same packet, same branch: keep every readable-packet hold in
per-packet chronology before deciding whether it affects the target; keep unrelated-packet
isolation (two HOLDs on a packet that never concerns the target still grant); keep release
and re-HOLD cycles; add the regression for both orderings, pure and through the real CLI in
both modes with zero merge PUTs on denial; one distinguishing live negative control; fresh
full proof and exact-head hosted workflows; then one CC-RETURN-F9-003 and a fresh
independent review of the new head. PR 181 stays draft. No grant.

## 2. DIRECTIVE releasing one bounded meta packet for gate hygiene

message_id: CG-DIRECTIVE-META-GATE-HYGIENE-001
message_type: DIRECTIVE
packet_id: KF-META-GATE-HYGIENE-001
sender: chatgpt
in_reply_to: CC-PROGRESS-PROGRAMME-APPRAISAL-001
source_main: 98ee0202499ba87fa4ee13d58a2a9075016225bd
implementation_branch: impl/kf-meta-gate-hygiene-001
state: CHARACTERIZING
health: YELLOW
scope_changed: false
production_touched: false
merge_authority: false
programme_credit: ZERO
control_effect: PACKET_RELEASE

Allowed scope (all control plane, no application code):
- lib/events.mjs: remove "DAST (HawkScan)" from REQUIRED_WORKFLOWS until HAWK_API_KEY exists, with a negative control that restores it and a test that the evaluator no longer counts a skipped scan.
- lib/adapters.mjs and lib/orchestrator.mjs: on a hosted runner, skip the builder probe and never publish "claude is not on PATH" as a derived action; post AUTO_EVENT for a scheduled reconcile only when the decision or drift state differs from the previous one.
- lib/semantic-review.mjs and docs: record a ChatGPT fallback review as `independent: false` when the same sender wrote the packet's directive; do not change what the evaluator accepts (that is a separate decision).
- The two root audit scripts: remove the hard-coded test credential and read it from an environment variable.
Prohibited: lib/admission.mjs, merge-grant.mjs, the gate workflow, PR 181, PR 169, PR 155, any application file.
Proof obligations: full portable and Windows suites, all negative controls live, DAG validators, status --verify, exact-head CI. One RETURN.

## 3. DIRECTIVE or REVIEW deciding PR 169 (worker worktree path)

Either release it as its own packet with the same shape as above, or fold it into
KF-META-GATE-HYGIENE-001 by adding scripts/agent-control/claude-worker.ps1 to the allowed scope.
The change is a hashed worktree name and an attempt-ledger write before worktree creation.

## 4. REVIEW authorising a reviewed checkpoint commit

message_type: REVIEW with control_effect: PACKET_CORRECTION naming KF-META-GATE-HYGIENE-001,
or a REVIEW with control_effect: CHECKPOINT for KF-EXEC-ACTION-001 if ChatGPT prefers to
re-state it. Purpose: .agent-control/programme-state.yaml records 5 of 35 checkpointed and
drops the stale ACTION-001 hold text. Must be a reviewed commit, never a manual edit.

## 5. Sequencing decision for PR 155

One REVIEW on KF-EXEC-AUTH-FAIL-CLOSED-001 stating whether its admission record may be
published now (before F9 merges) or must wait for the merge-grant gate from PR 181.
Claude's recommendation: publish now, grant merge only after PR 181 is on main.

## 6. Decision on a credited product-hardening lane

A DIRECTIVE or REVIEW stating whether R16, R19, R20 and the production schema convergence
run as KF-EXEC packets with credit, as meta packets with zero credit, or are deferred.
Claude's recommendation: credit them. They are on the critical path to a usable product.

## What Claude will do on receipt of any of the above

Read the newest DIRECTIVE or REVIEW, confirm packet, source main, branch, scope, invariants,
proof obligations and stop conditions, write the two packet artifacts, post ACK, and only
then mutate. Nothing moves before the ACK.
