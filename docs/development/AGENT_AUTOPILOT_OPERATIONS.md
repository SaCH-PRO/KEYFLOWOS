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

- **Single instance.** Two locks keep a second worker off a packet. One is
  per checkout (`.agent-control/.worker/worker.lock` under `-RepoRoot`). The
  other, which the worker calls the machine lock, is per Windows user,
  repository and control issue:
  `%LOCALAPPDATA%\KEYFLOWOS\locks\worker-<owner>_<repo>-issue-<n>.lock`
  (under the user's temp directory when `LOCALAPPDATA` is unset; `-LockRoot`
  moves it). A second worker for the same issue, run by the same Windows user
  with the same `-LockRoot`, refuses to start whichever checkout it is started
  from. The lock does not span Windows users or `-LockRoot` values: a worker
  run under another account, or started with a different `-LockRoot`, takes
  its own lock file and runs beside the first, which is the fault the lock
  exists to prevent. The installer never passes `-LockRoot`.
- **Stale locks.** A lock records its owner's PID and process start time. It
  is reclaimed automatically, with a `WARN`, when it names no process, when
  that PID is no longer running, or when the PID now belongs to a process
  with a different start time (Windows reused it). Two locks are not
  reclaimed. A lock whose PID belongs to a process whose start time the
  worker may not read (another account's) stands. A checkout lock written by
  a worker from before start times were recorded (every worker installed
  before this one) has no start time, so any live process with that PID
  holds it, and the worker refuses with "another worker is already running
  (pid <n>)" even when Windows has given that PID to an unrelated process;
  delete the lock by hand (section 5).
- **What takes a lock.** `-Status` shows whether the checkout lock file
  exists (`lock`) and who holds the machine lock (`machine`). `-DryRun` takes
  only the checkout lock. `-Status`, `-Pause`, `-Resume`, `-ReleaseHold` and
  `-RecordInstall` take neither.
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
- **Worktree names fit the path limit.** Windows refuses a path of 260
  characters unless `core.longpaths` is set. The worker measures the longest
  tracked path of the worktree's base and keeps it within 240 characters. When
  the whole message id does not fit, the directory is the head of the id plus
  eight hex digits of its SHA-256 (the same on every attempt). A worktree
  already made under the whole id is found first.
- **Every failure before the wake is counted.** A worktree that cannot be
  made, or a worktree root that is refused, is counted like a failed run: two
  identical failures hold the directive and post one MOMENTUM, and Claude is
  never woken for it.
- **A network fault has its own bound.** A failed `git fetch` is recorded in
  the directive's ledger entry (`network_failures`) but is not an attempt and
  never spends the two strikes. It holds the directive only after 15
  consecutive identical failures that also span 30 minutes
  (`-MaxNetworkFailures`, `-MinNetworkOutageMinutes`), then posts one
  MOMENTUM whose `held_reason` begins `network fault:`. The count starts
  again on any tick that gets past the fetch, so a short outage holds nothing.
- **Install contract.** The worker wakes Claude only when
  `.agent-control/.worker/install.json` matches its contract version. An
  autostart left from an older worker stays a no-op (`WAITING_OPERATOR`) until
  `install-claude-worker.ps1` is re-run from admitted code.
- **Own code checked every tick.** A running worker holds only
  `claude-worker.ps1` in memory and reads `select-directive.ps1`,
  `select-directive.mjs` and `evaluate-run.ps1` from disk on each tick. If any
  is gone it logs `WAITING_OPERATOR worker_code_missing`, does not poll and
  does not wake Claude. `-Status` shows the same on its `code` line.

### Where to run the worker from

Install and run the worker from a checkout that stays on admitted `main`,
never from the checkout you work in. The worker's scripts are tracked files:
changing that checkout to a branch without `scripts/agent-control/` removes
them from under a running worker. On this machine the pinned checkout is a
detached worktree under `%LOCALAPPDATA%\KEYFLOWOS\`.

The cursor and the attempt ledger are per `-RepoRoot`; the machine lock is
per Windows user and `-LockRoot` instead. A worker started from a new location,
by the same user with the same `-LockRoot`, refuses to start while another one
serves the same issue, and names that worker's PID and repo root. Stop the old
process first (section 5).

A worker from before the machine lock existed does not hold it. A new worker
started from another checkout cannot see that old worker and will start beside
it. When upgrading, stop every `claude-worker.ps1` process first
(`Get-CimInstance Win32_Process` filtered on `claude-worker`), then start the
new one.

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
| Worker will not start, "another worker is already running (pid <n>)" | a process with that PID holds this checkout's lock. Usually a live worker. After an unclean stop it can be an unrelated process Windows has since given that PID, when the lock was written by a worker from before start times were recorded or the process belongs to another account (see Stale locks, section 3) | `Get-CimInstance Win32_Process -Filter "ProcessId=<n>"` shows what it is (`-Status` shows only that the lock file exists). If it is a `claude-worker.ps1` worker, stop it or run `uninstall-claude-worker.ps1`. If it is an unrelated process, the lock is stale and the worker will not reclaim it: delete `.agent-control\.worker\worker.lock` and start the worker again |
| Worker will not start, "another worker already serves <repo> issue <n> on this machine (pid, repo root, started)" | a live worker started from another checkout, by the same Windows user with the same `-LockRoot`, holds the machine lock for the same repository and issue. (Rarely, a stale lock whose PID now belongs to another account's process, whose start time the worker may not read) | this is the lock working. `-Status` shows the owner on its `machine` line. Keep the worker running from the pinned checkout; stop the other by the PID in the message if it is the wrong one. If that PID is not a `claude-worker.ps1` process, delete the lock file named in the Single instance bullet (section 3) |
| Worker logs `WARN removing a stale lock (...)` or `removing a stale machine lock (...)` | the lock's owner is gone: `pid <n> is no longer running` after an unclean stop, `pid <n> is now another process` when Windows reused the PID of a lock that records a start time, `it names no process` for an empty or unreadable lock, or `pid <n> is this process, which did not write it` | nothing to do; the worker took the lock and carries on. A lock from before start times were recorded is never reclaimed for a reused PID: see the first row |
| `-Status` shows `machine : stale, ...` | the last worker stopped without releasing the machine lock | nothing to do; the next worker to start reclaims it |
| Worker idle with `WAITING_EXTERNAL_AGENT` | `gh` or `claude` session expired | `gh auth login`, or open Claude Code once to refresh; the worker resumes on the next tick |
| Worker logs `WAITING_OPERATOR` | no install record for this worker contract | re-run `install-claude-worker.ps1` from the admitted code |
| Worker logs `WAITING_OPERATOR worker_code_missing` (before this check existed: `Invalid JSON primitive: Windows.` on every tick) | the checkout the worker was started from no longer has the scripts named in `missing=`, usually because it changed branch | the worker is harmless but useless: it polls nothing. Confirm it has no `claude` child process, stop that one process by PID, and run the worker from the pinned checkout (section 3). Its lock, cursor and attempt ledger stay where they are |
| Worker logs `selector_output_unreadable exit=<n>` | `select-directive.ps1` ran but did not print a decision; `stdout_head` shows what it printed | read `stdout_head` and the exit status. Nothing was selected and Claude was not woken. A mismatch between the worker in memory and the scripts on disk is the usual cause: restart the worker from the pinned checkout |
| Worker logs `verdict_unreadable exit=<n>` | `evaluate-run.ps1` did not print a verdict for a finished run | the run is counted as failed and stays retryable; the transcript is in `.agent-control/.worker/run-<id>-attempt<n>.json` |
| Two `claude-worker.ps1` processes for one issue | the machine lock does not span them: one predates the machine lock and does not hold it, or they run as different Windows users, or they were started with different `-LockRoot` values. Each is a fault: two workers drive one packet | `Get-CimInstance Win32_Process` filtered on `claude-worker`; keep the one running from the pinned checkout and stop the other by PID. Two workers on different issues are fine |
| Worker logs `HELD_RETRYABLE` | two identical failures on one directive, or a network fault past its bound | read the MOMENTUM it posted; `held_reason` names the fault. Fix the blocker, then post a newer directive or run `-ReleaseHold <id>` |
| Worker logs `network_unavailable: git fetch origin failed ... (network failure <n>; held at 15 over 30 minutes)` | `git fetch origin` failed in the worker's checkout; Claude was not woken on a stale base | usually an outage that ends by itself: the count resets on the next tick whose fetch works. If it does not end, run `git -C <repo root> fetch origin` by hand to see why (remote URL, credential helper). Past the bound the directive is held and one MOMENTUM is posted; a hold does not lift by itself when the network returns, so `-ReleaseHold <id>` or post a newer directive |
| Worker logs `wake_setup_failed: ...` | the wake stopped before a worktree was looked for: the worktree root is inside the checkout, or is not a path Windows can hold | Claude was not woken. The second identical failure holds the directive and posts a MOMENTUM. Start the worker with a valid `-WorktreeRoot`, then `-ReleaseHold <id>` |
| Worker logs `run verdict ... wake_failed: ...` | the wake itself threw, for example the worktree vanished between being made and being entered | counted as a failed run, so it is bounded like one; the text after `wake_failed:` is the error |
| Worker logs `worktree_unavailable: ...` | the worktree for a directive could not be made: `git worktree add` failed, a directory of that name is in the way and is not a worktree, or the worktree root is too deep to leave room for a name | Claude was not woken. The second identical failure holds the directive and posts a MOMENTUM. Fix the cause (move the directory, use a shorter `-WorktreeRoot`), then `-ReleaseHold <id>` |
| Before this check existed: `git worktree add failed` on every tick, with an empty `attempts.json` and nothing on #80 | a long message id put the worktree's longest path over 260 characters | upgrade the worker from admitted main; until then a newer directive with a shorter id supersedes the stuck one |
| Worker logs `kept worktree` | the wake left uncommitted or unpushed work | inspect it under the worktree root; push or discard it, then `git worktree remove <path>` |
| Same directive processed twice | cursor lost or purged | ids live in `.agent-control/.worker/cursor.json`; restore it or accept one replay — the repository gates still apply |
| Autopilot posted no AUTO_EVENT | event was not actionable, or was a duplicate | duplicates are suppressed by idempotency key; check the workflow log |
| `auto-merge-admitted` exits 3 | PR is not eligible — an ordinary outcome | the JSON `reason` names the exact unmet contract |
| `auto-merge-admitted` exits 2 | evaluator error (auth, API, parse) | the job fails loudly by design; read stderr, fix, re-run |
| `auto-merge-admitted` exits anything else | the evaluator crashed or was killed | treated exactly like 2: both merging steps pass only on 0 and 3 |
| Sweep job step `Audit AUTO_MERGE records` logs `posted 1 missing record(s)` | an earlier merging job merged a PR and did not leave its record (it died, or the post was refused). The audit found the merge in the repository and posted the record through the same recorder | nothing to do; find out why the original job could not record. The audit runs on every sweep, also when the sweep itself failed, and can be run by hand read-only: `GITHUB_TOKEN=$(gh auth token) GITHUB_REPOSITORY=SaCH-PRO/KEYFLOWOS node scripts/agent-control/audit-merge-records.mjs` (add `--reconcile` to post) |
| `Audit AUTO_MERGE records` fails with `still has no AUTO_MERGE record after reconciliation` or `did not complete` | the audit could not read every closed PR or all of #80, or was refused the post | nothing was posted from a partial read; fix access and re-run. It audits only implementation PRs merged by `github-actions[bot]`; a merge by a person owes no AUTO_MERGE record |
| `Audit AUTO_MERGE records` fails with `contradicts an AUTO_MERGE record` | as `recorder status 4` below, found by the audit rather than at merge time | a person must look at the comment the log names; the audit cannot resolve it |
| A merging job fails with `PR #<n> was merged but its AUTO_MERGE record is not confirmed` | the merge happened; `record-auto-merge.mjs` could not read all of #80, was refused the post, or did not get the stored record back (status 2), or the evaluator exited 0 with no merge in its result (status 3) | the merge stands and is not retried. Confirm the PR is merged, then re-record from the evaluator JSON in the job log: `MERGE_JSON='<that JSON>' GITHUB_TOKEN=$(gh auth token) GITHUB_REPOSITORY=SaCH-PRO/KEYFLOWOS node scripts/agent-control/record-auto-merge.mjs`. It is idempotent on the merge commit, so running it twice posts once. Do not run it while a merging job is in progress: the job holds the mutation lock and a manual run does not, so both could post. That leaves two identical records, which every later run lists under `duplicates` |
| The same line with `recorder status 4`, and `AUTO_MERGE record conflict` in the log | a comment on #80 by `github-actions[bot]` or an allowlisted author carries this merge's marker but is not its record; the log gives the comment id and what differs (`mismatch:pr_number`, `mismatch:admitted_head`, `mismatch:merge_sha`, `malformed:*`, `missing:*`, `unexpected:*`, `marker_only`, `differs_from_record`) | the true record exists: the recorder posts it before failing. A person must look at the named comment and find out how it was written. Every replay fails the same way while it stands. Never edit #80 comments; ChatGPT decides what happens to it |
| `hourly-reconcile-open-prs` fails with `could not list open pull requests` | `list-open-impl-prs.mjs` exited 2, so no PR was reconciled. The line before it, `list-open-impl-prs: <code>: <detail>`, says why: `config`, `http`, `json`, `graphql` or `shape` (the API could not be read as expected), `cursor` or `page_cap` (paging did not end cleanly), or `duplicate` / `total_mismatch` (PRs opened or closed during the read, still inconsistent after one full retry); anything else prints `error` | fix API access, or re-run once the PR list is quiet; the job no longer passes on an empty or partial listing it could not trust |
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
| Orchestrator publishes `REPORT_DRIFT` / `DERIVED_STATE_STALE_AUTHORITY` | a newer ChatGPT DIRECTIVE/REVIEW/HOLD/RESUME could not be folded over the programme-state checkpoint; the finding's `blocked` names the message and why (`CONTROL_EFFECT_MISSING`, `_UNKNOWN`, `_TYPE_MISMATCH`, `_FIELD_MISSING`, `_PACKET_NOT_ACTIVE`, `_PACKET_IN_FLIGHT`, `_PR_CONFLICT`, `_PACKET_HELD`, `_HOLD_DUPLICATE`, `_HOLD_MISMATCH`, `_HEALTH_INVALID`, `_PRODUCTION_TOUCHED`, `_PROJECTION_INVALID`, `_PROGRAMME_NOT_FOLDABLE`, `AUTHORITY_MALFORMED`) | typed authority folds automatically (AGENT_CONTROL_PLANE.md, "Typed authority effects"). The fold never skips a message, so a later typed message cannot get past an untyped or conflicting one: re-derive the checkpoint past it in a reviewed commit, after which later typed messages fold again. Never edit the anchor alone, and never edit #80 |
| `REPORT_DRIFT` / `DERIVED_STATE_INVALID` | the programme-state checkpoint itself fails `validateState` (for example `health: AMBER`, or a container of the wrong type such as `holds: []`, reported as `CHECKPOINT_SHAPE_INVALID`); the fold does not start from it (`reduction.reason: CHECKPOINT_INVALID`) and the finding lists the contract problems | correct the checkpoint in a reviewed commit; it is never repaired automatically |
| `REPORT_DRIFT` / `PR_ALREADY_MERGED`, `PR_NOT_MERGED`, `PR_CLOSED_UNMERGED`, `PR_BRANCH_MISMATCH`, `SOURCE_MAIN_NOT_ON_MAIN` | the repository contradicts the effective projected packet state (for example a merged PR whose typed CHECKPOINT has not been posted yet) | repository truth wins: verify post-merge state; a typed REVIEW with `control_effect: CHECKPOINT` and the PR number then resolves the merged case, otherwise re-derive the projection |
| `REPORT_DRIFT` / `AUTHORITY_UNVERIFIABLE` or `REPO_TRUTH_UNVERIFIABLE` | `gh` could not read #80 or the repository (no token on the runner, expired login, API error) | fix access; nothing advances meanwhile, by design |
| `REPORT_DRIFT` / `AUTHORITY_EDITED` | a comment by an allowlisted author on #80 has been edited, so earlier authority cannot be verified | no automated recovery by design; ChatGPT decides how to proceed. Never edit #80 comments |
| `REPORT_DRIFT` / `AUTHORITY_MALFORMED` | an authority message newer than programme-state's anchor has a repeated key, an unmatched quote or a missing envelope key | treat it as a possible hold; re-derive the projection past it only in a reviewed commit |
| `REPORT_DRIFT` / `AUTHORITY_ORDER_AMBIGUOUS` | an authority comment has no id or timestamp, or two share an id | the snapshot is unusable; re-read #80 |
| Worker logs `newest_authority_malformed` / `newest_authority_not_actionable` / `authority_edited` | the selector's shared AUTHORITY profile refused to wake | expected fail-closed behaviour; ChatGPT posts a well-formed DIRECTIVE/REVIEW |
| Status shows `BOARD DRIFT` | the intelligence board disagrees with programme-state | neither advances work; reconcile both against #80 and the repository at a checkpoint |
| State file looks wrong | hand-edited while running | stop the worker, correct it, re-run `status.mjs --verify`; `validateState` rejects impossible values on save, and on every reconcile (`DERIVED_STATE_INVALID`) |

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
