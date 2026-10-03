# Agent Autopilot — Operator Runbook

Everything an operator needs to install, inspect, disable and recover the
KEYFLOWOS control-plane automation. Nothing here requires a credential to be
committed, and nothing here can weaken an existing gate.

## 1. Inspect before installing anything

```bash
# Programme status: packets, active packet, agents, next dependency-safe work
node scripts/agent-control/status.mjs

# Same, reconciled against newest #80 authority and repository truth (reads via gh)
node scripts/agent-control/status.mjs --verify

# Same, machine readable
node scripts/agent-control/status.mjs --json

# Prove the dependency graph is executable (no deadlock, no cycle)
node scripts/agent-control/validate-dag.mjs --print-order

# Run every control-plane proof
node --test scripts/agent-control/tests/*.spec.mjs

# Prove the proofs are not vacuous (restores each defect in a throwaway worktree)
node scripts/agent-control/proof-mutation.mjs --manifest scripts/agent-control/negative-controls.yaml
```

None of these mutate the repository. `proof-mutation.mjs` works inside a
temporary `git worktree` and removes it afterwards.

## 2. Required GitHub permissions

The workflow requests the minimum per job:

| Job | Permissions | Why |
|---|---|---|
| `self-test` | `contents: read` | run proofs on the package's own PR |
| `normalize-event` | `contents: read`, `issues: write` | read the event, post the AUTO_EVENT record |
| `exact-head-auto-merge` | `contents: write`, `pull-requests: write`, `issues: write`, `actions: read` | merge an admitted head, record it, read run conclusions |
| `hourly-reconcile-open-prs` | same as above | sweep open implementation PRs |

No repository secret is required for the deterministic layer. Optional agent
adapters read these environment variables if you choose to enable them:

| Variable | Effect when absent |
|---|---|
| `KEYFLOW_AGENT_OPENAI_API_KEY` | reviewer reports `WAITING_EXTERNAL_AGENT` |
| `KEYFLOW_AGENT_SECONDARY_API_KEY` | secondary reviewer reports `WAITING_EXTERNAL_AGENT` |
| `KEYFLOW_CLAUDE_BIN` | defaults to `claude` on PATH |

Absent credentials never produce a false success.

## 3. The local Claude worker (Windows)

The worker removes the human from the relay role: it watches issue #80 and
wakes Claude Code for an unprocessed DIRECTIVE or REVIEW.

```powershell
# Check auth and lock state — no side effects
powershell -File scripts/agent-control/claude-worker.ps1 -Status

# See what it WOULD process, without invoking Claude
powershell -File scripts/agent-control/claude-worker.ps1 -DryRun

# Run it in the foreground
powershell -File scripts/agent-control/claude-worker.ps1

# Install as a scheduled task that starts at logon (falls back to a per-user
# Startup entry when task registration is denied; -Method forces one)
powershell -File scripts/agent-control/install-claude-worker.ps1

# Pause / resume without uninstalling (every tick becomes a no-op)
powershell -File scripts/agent-control/claude-worker.ps1 -Pause
powershell -File scripts/agent-control/claude-worker.ps1 -Resume

# Release a HELD_RETRYABLE directive for another bounded attempt
powershell -File scripts/agent-control/claude-worker.ps1 -ReleaseHold <message_id>

# Preview the installation without creating anything
powershell -File scripts/agent-control/install-claude-worker.ps1 -WhatIfOnly

# Remove it (keeps the processed-directive cursor)
powershell -File scripts/agent-control/uninstall-claude-worker.ps1

# Remove it and purge durable worker state
powershell -File scripts/agent-control/uninstall-claude-worker.ps1 -Purge
```

The worker runs as the current user at logon so it inherits the existing
authenticated `gh` and Claude sessions. It stores no credential.

### Worker safety properties

- **Single instance.** A PID lock prevents two workers driving one packet. A
  lock whose owner has died is reclaimed automatically.
- **Idempotent.** Processed `message_id`s are recorded in
  `.agent-control/.worker/cursor.json`. A directive is never processed twice.
  A *failed* run is not recorded, so it stays retryable.
- **Fails visibly.** Missing `gh` or `claude` auth logs
  `WAITING_EXTERNAL_AGENT` and does nothing else.
- **Bounded.** The prompt forbids merging, scope widening, architecture change,
  production access, gate weakening and independent contradiction resolution.
- **Untracked runtime state.** `.agent-control/.worker/` is git-ignored: locks,
  logs and cursors are local to the machine.
- **Authenticated dispatch.** Only `DIRECTIVE`/`REVIEW` with `sender: chatgpt`
  from an allowlisted GitHub author (`-AuthorizedAuthors`, default `SaCH-PRO`)
  can wake Claude. Rejected messages are logged as `not actionable`.
- **Bounded retry.** Two identical failures hold the directive
  (`HELD_RETRYABLE`, shown by `-Status`) and post one MOMENTUM. It stays
  unprocessed. A newer directive or `-ReleaseHold` moves it on.
- **Own worktree per wake.** Claude never runs in this checkout. Worktrees
  live under `%LOCALAPPDATA%\KEYFLOWOS\worker-worktrees\<message_id>`
  (`-WorktreeRoot` to change it; it may not be inside the checkout). The worker
  keeps a worktree that has uncommitted changes or commits on no remote. It
  logs `kept worktree` and never deletes that work.
- **Install contract.** The worker wakes Claude only when
  `.agent-control/.worker/install.json` matches its contract version. An
  autostart left from an older worker stays a no-op (`WAITING_OPERATOR`) until
  `install-claude-worker.ps1` is re-run from admitted code.

## 4. Turning autonomy off while keeping observation

Any one of these stops autonomous advancement. None weakens a gate.

| Goal | Action |
|---|---|
| Stop waking Claude | `uninstall-claude-worker.ps1` |
| Pause waking without uninstalling | `claude-worker.ps1 -Pause` (undo: `-Resume`) |
| Keep the worker but disable the builder | set `KEYFLOW_AGENT_CLAUDE_DISABLED=1` |
| Stop all repository automation | disable **KEYFLOWOS Agent Autopilot** in the Actions tab |
| Stop automatic merge only | remove `contents: write` from `exact-head-auto-merge`, or keep every PR draft |
| Full manual mode | all of the above; the manual admission contract is unchanged |

The manual path always remains: ChatGPT reviews, sets `review_status`, and the
Agent Control Gate enforces the same contract with or without automation.

## 5. Failure recovery

| Symptom | Cause | Recovery |
|---|---|---|
| Worker will not start, "another worker is already running" | a live worker holds the lock | `-Status` to see it; stop that process or `uninstall-claude-worker.ps1` |
| Worker idle with `WAITING_EXTERNAL_AGENT` | `gh` or `claude` session expired | `gh auth login`, or open Claude Code once to refresh; the worker resumes on the next tick |
| Worker logs `WAITING_OPERATOR` | no install record for this worker contract | re-run `install-claude-worker.ps1` from the admitted code |
| Worker logs `HELD_RETRYABLE` | two identical failures on one directive | read the MOMENTUM it posted; fix the blocker, then post a newer directive or run `-ReleaseHold <id>` |
| Worker logs `kept worktree` | the wake left uncommitted or unpushed work | inspect it under the worktree root; push or discard it, then `git worktree remove <path>` |
| Same directive processed twice | cursor lost or purged | ids live in `.agent-control/.worker/cursor.json`; restore it or accept one replay — the repository gates still apply |
| Autopilot posted no AUTO_EVENT | event was not actionable, or was a duplicate | duplicates are suppressed by idempotency key; check the workflow log |
| `auto-merge-admitted` exits 3 | PR is not eligible — an ordinary outcome | the JSON `reason` names the exact unmet contract |
| `auto-merge-admitted` exits 2 | evaluator error (auth, API, parse) | the job fails loudly by design; read stderr, fix, re-run |
| `required_check_pending_at_head` | a required run at the head is queued or in progress, even if an older run succeeded | wait for it to finish, then re-evaluate; never merge past it |
| `required_checks_predate_pr_transition` | a `reopened`, `ready_for_review`, `converted_to_draft`, `renamed` or `base_ref_changed` event is newer than a required workflow's latest run, so a run is owed | wait for the owed run to appear and finish; if it never appears, re-run that workflow at the head |
| `pr_transitions_unknown` | the evaluator had no PR timeline | fail-closed by design; fix API access and re-run |
| `admission_changed_before_merge` | the second snapshot, taken just before the merge call, differed (new run, transition, moved head or base) | expected under races; re-evaluate from scratch |
| `semantic_review_not_satisfied` / `semantic_review_missing` | ChatGPT has not recorded `semantic_review` in `claude-return.yaml` | ChatGPT records it with `review_status` at admission (AGENT_CONTROL_PLANE.md, "Independent semantic review") |
| `semantic_review_not_satisfied` / `fallback_without_primary_unavailable_evidence` | a ChatGPT pass is recorded without a Copilot `NOT_RUN` entry | record Copilot's `NOT_RUN` with its reason and the bot's review URL, or obtain a Copilot review |
| `semantic_review_not_satisfied` / `live_evidence_missing` | a recorded review has no live counterpart: no bot review at that head, or no #80 comment at `evidence_location` | request the Copilot review at the head, or post the ChatGPT REVIEW with `reviewed_head`, `semantic_review_outcome` and `unresolved_substantive_findings` lines |
| `semantic_review_not_satisfied` / `live_evidence_contradicts_record` | the PR or #80 disagrees with the record, for example Copilot PASS where the bot said it was unable to review | correct the record to what happened; never edit #80 comments |
| `semantic_review_not_satisfied` / `reviewed_head_is_not_the_admitted_semantics` | the review is of an older or different commit | review again at the current semantic head |
| `semantic_review_not_satisfied` / `self_review`, `reviewer_identity_*`, `provider_not_approved` | the implementer, an unknown provider, or a mislabelled reviewer is recorded | only `copilot-pull-request-reviewer[bot]` or `chatgpt`, and never the implementer |
| `semantic_review_not_satisfied` / `reviewer_findings_not_dispositioned` or `unresolved_substantive_findings` | Copilot findings are not all dispositioned, or a finding is open | disposition each finding (resolved or rejected with evidence) before admission |
| DAG validation fails | a packet edit introduced a deadlock or cycle | `validate-dag.mjs` prints the structured problem codes |
| Orchestrator publishes `REPORT_DRIFT` / `DERIVED_STATE_STALE_AUTHORITY` | a ChatGPT DIRECTIVE/REVIEW/HOLD/RESUME is newer than programme-state's `authority_basis` | expected after every new authority message; re-derive programme-state from that message and repository truth in a reviewed commit and re-anchor it. Never edit the anchor alone |
| `REPORT_DRIFT` / `PR_ALREADY_MERGED`, `PR_NOT_MERGED`, `PR_CLOSED_UNMERGED`, `PR_BRANCH_MISMATCH`, `SOURCE_MAIN_NOT_ON_MAIN` | the repository contradicts the projected packet state | repository truth wins: verify post-merge state, then re-derive the projection |
| `REPORT_DRIFT` / `AUTHORITY_UNVERIFIABLE` or `REPO_TRUTH_UNVERIFIABLE` | `gh` could not read #80 or the repository (no token on the runner, expired login, API error) | fix access; nothing advances meanwhile, by design |
| `REPORT_DRIFT` / `AUTHORITY_EDITED` | a comment by an allowlisted author on #80 has been edited, so earlier authority cannot be verified | no automated recovery by design; ChatGPT decides how to proceed. Never edit #80 comments |
| `REPORT_DRIFT` / `AUTHORITY_MALFORMED` | an authority message newer than programme-state's anchor has a repeated key, an unmatched quote or a missing envelope key | treat it as a possible hold; re-derive the projection past it only in a reviewed commit |
| `REPORT_DRIFT` / `AUTHORITY_ORDER_AMBIGUOUS` | an authority comment has no id or timestamp, or two share an id | the snapshot is unusable; re-read #80 |
| Worker logs `newest_authority_malformed` / `newest_authority_not_actionable` / `authority_edited` | the selector's shared AUTHORITY profile refused to wake | expected fail-closed behaviour; ChatGPT posts a well-formed DIRECTIVE/REVIEW |
| Status shows `BOARD DRIFT` | the intelligence board disagrees with programme-state | neither advances work; reconcile both against #80 and the repository at a checkpoint |
| State file looks wrong | hand-edited while running | stop the worker, correct it, re-run `status.mjs --verify`; `validateState` rejects impossible values on save |

## 6. Human override

The operator can always:

- edit `.agent-control/programme-state.yaml` with the worker stopped;
- set `hold.active: true` to freeze advancement with a recorded reason;
- add an entry to `unresolved_contradictions` to stop the orchestrator dead;
- close or draft a PR to remove it from reconciliation;
- disable the workflow.

`hold` and `unresolved_contradictions` both outrank every mechanical rule in
the orchestrator, so either is a hard stop. A projection edit is only
consulted while it reconciles with the newest #80 authority. To freeze
advancement durably, post a ChatGPT hold on #80 and re-derive the projection
from it. Any newer authority message already stops advancement until that
re-derivation.

## 7. What automation can never do

Encoded in `AGENT_AUTOPILOT_POLICY.yaml#never_automatic` and proved in
`tests/orchestration.spec.mjs`:

architecture precedence decisions · scope widening · production deployment,
mutation or provider traffic · forensic rebaseline · programme-map refresh ·
OS cycle resume · gate weakening · proof-obligation reduction · contradiction
resolution without recorded authority · schema primitive choices · migration
strategy · agent self-approval.
