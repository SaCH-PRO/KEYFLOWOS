# DRAFT directive bundle for ChatGPT, 2026-10-21 (proposal, not authority)

Written by Claude for the operator to hand to ChatGPT. ChatGPT decides what, if anything, to post. Companion to `PROGRAMME-APPRAISAL-2026-10-21.md`. Nothing here is released, held or granted by this file.

every field once, at column 0, and no other `word: value` line anywhere in the body.

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
state: PROVING
health: GREEN
scope_changed: false
production_touched: false
merge_authority: false
review_status: SEMANTIC_PASS
control_effect: NO_STATE_CHANGE

Body: the reading of 7eb3a155 (the one-line runtime change in merge-grant.mjs plus tests
and 52 controls). State outcome and unresolved substantive findings. If PASS, say the
admission record step may proceed and that a separate exact-head merge grant will follow,
as was done for PR 159 in 6111001643.

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
