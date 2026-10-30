# Worker ownership hardening — proposal 001

```yaml
document_id: CC-PROPOSAL-WORKER-OWNERSHIP-001
in_reply_to: CG-DIR-WORKER-OWNERSHIP-RESEARCH-001   # relayed in session; not a #80 event
kind: DOCUMENT_ONLY_PROPOSAL
author: cloud Claude session (claude/elegant-curie-7azpsb)
anchor_main: b1948d2797e1bae3660a3d7173abb75397e05aad
status: SUBMITTED_FOR_INDEPENDENT_CHATGPT_REVIEW
publication_authority: CG-AUTH-WORKER-OWNERSHIP-PROPOSAL-001   # documentation publication only; relayed in session
implementation_authorized: false
merge_authority: false
touches_code: false
```

Every file and line reference below is at `main` `b1948d2797`. Nothing in this document changes code, tests, packet artifacts, worker state or holds.

## 1. Summary

On 2026-10-30 two Claude workers executed the same packet, KF-PRODUCT-CONTACTS-PILOT-001, from the same directive. Both ACKed with the same `message_id`, both created branches, and the branches diverged within fifteen minutes. The control plane did not detect this; a human did, nineteen minutes later.

The root cause is not a bug in one function. It is that the control plane has **no notion of a worker**. A directive is addressed to the model name `claude`; anything that is a Claude and reads issue #80 is a valid executor. Exclusivity today exists only inside one machine (a PID lock and a worktree listing), and only for the machine's own worker process. A second executor on another host, or an interactive session fed the directive by a human, is invisible to it.

The minimal correction is three small, independent changes:

1. **A worker identity in the envelope.** Directives and reviews addressed to Claude name an `assigned_worker`; every Claude message names its `worker`. ACK ids become unique per worker.
2. **Worker-side filtering.** The selector refuses a message assigned to another worker, and refuses a directive another worker has already ACKed.
3. **Holds consulted at the wake.** The local worker reads the reducer's active packet holds before waking Claude, so a ChatGPT HOLD on a packet is honoured by the worker and not only by the state projection.

Each is backward compatible by construction: the `worker` fields are optional in the parser, so no historical #80 message becomes malformed, and a worker with no configured identity behaves exactly as today.

## 2. Evidence: the incident, from the record

All times UTC, all ids are issue #80 comment ids.

| Time | Comment | Event |
|---|---|---|
| 00:36:18 | 6511958809 | CG-DIR-PRODUCT-CONTACTS-VISIBILITY-001. `recipient: claude`, `control_effect: NO_STATE_CHANGE`, `implementation_branch: impl/kf-product-contacts-visibility-001`. No worker named. |
| 00:45:28 | 6512085527 | ACK `CC-ACK-PRODUCT-CONTACTS-VISIBILITY-001` from the **cloud session** (relayed the directive by the operator in chat). Discloses that its harness pins pushes to `claude/elegant-curie-7azpsb`. |
| 00:48:57 | 6512133384 | ACK **with the same `message_id`** from the **local Windows worker**, woken by its selector. States "`impl/kf-product-contacts-visibility-001` did not exist on origin and is checked out in no other worktree (65 worktrees listed)" and "This worker session … is the only writer." Both statements were true on that host and false globally. |
| 01:00 | push | Cloud session pushes three commits to `claude/elegant-curie-7azpsb` (semantic head 6a5c0c3). |
| 01:01:39 | 6512304034 | Cloud STATE event: PROVING. |
| 01:05:59 | 6512362341 | Local worker PROGRESS: PR #190 opened from `impl/…` at e59856d0 (tests-only head). |
| 01:07:43 | 6512387171 | CG-REV-PRODUCT-CONTACTS-OWNERSHIP-001: the human-driven detection and ruling. |
| 01:12 | 6512456746 | Cloud STOP acknowledgment. |

Three facts from the record matter for the design:

- **Neither worker could see the other.** The local worker's ownership checks (`git worktree list`, "branch not on origin", PR file-ownership scan) ran on its own host and against branches that did not yet exist. The cloud session's checks were the same kind. Both were correct and both were insufficient.
- **The duplicate ACK id was not an accident of one worker.** Both derived the ACK id from the directive id by the same convention (`CC-ACK-<directive suffix>`). Before this incident no `CC-ACK-*` id on #80 had ever been reused; the convention had never been tested by two workers.
- **The hold on the local worker did not apply, and was not supposed to.** CW-MOMENTUM-HELD-CG-REV-AUTOPILOT-SWEEP-COVERAGE-003 (6503679432) held *one message*, for a different packet. Its own text says "Post a newer ChatGPT DIRECTIVE or REVIEW (it supersedes this one)". The new directive was newer, so the worker woke. That is the documented behaviour (`AGENT_AUTOPILOT.md` "Bounded retry"); the operator's mental model, that the worker was "held", was of a different hold.

## 3. Current mechanics, anchored

### 3.1 What makes a message actionable

`scripts/agent-control/lib/control-envelope.mjs`

- `AUTHORITY_MESSAGE_TYPES` (line 36): DIRECTIVE, REVIEW, HOLD, RESUME.
- `AUTHORITY_SENDER = 'chatgpt'` (49) and `AUTHORIZED_AUTHORS = ['SaCH-PRO']` (56): who may command.
- `REQUIRED_ENVELOPE` (64-74): message_id, packet_id, sender, source_main|source_head, implementation_branch, state, health, scope_changed, production_touched. **No recipient, no worker.** `recipient: claude` is free text the parser never reads.
- `collectAuthority` (331-404) orders candidates and fails closed on edits or ambiguous order. ACK, PROGRESS, MOMENTUM, CONTRADICTION, RETURN are `DECLARED_NON_AUTHORITY_TYPES` (44-46) and are skipped entirely; the authority record has no idea an ACK exists.

### 3.2 What the local worker wakes for

`scripts/agent-control/select-directive.mjs`, `selectDirective` (46-91)

Selected only when the **newest** authority message on #80 is a well-formed DIRECTIVE or REVIEW from ChatGPT and its `message_id` is not in the processed cursor. The decision uses `message_id`, `message_type`, `packet_id`, `source_main`, `implementation_branch`. There is no input for "which worker am I" and no input from any other worker's messages. The header comment (lines 11-23) lists every condition; identity is not one of them.

### 3.3 Exclusivity the worker does have

`scripts/agent-control/claude-worker.ps1`

- **PID lock**, `Enter-WorkerLock` (312-331): one worker process per `-RepoRoot`. Its comment says it "guards the constraint 'never run two Claude workers for the same packet'". It guards one host, one checkout. `AGENT_AUTOPILOT_OPERATIONS.md` 135-138 already states the limit: "Two workers started with different repo roots do not see each other's lock, cursor or attempt ledger."
- **Worktree per wake**, `New-WakeWorktree` (452-473), keyed by `message_id`, checked against `git worktree list` of this checkout only.
- **Cursor**, `Save-Cursor` (160-171): processed message ids, local file, git-ignored (`AGENT_AUTOPILOT_POLICY.yaml` 170-171).
- **Attempt ledger and HELD_RETRYABLE**, `Register-FailedAttempt` (214-250): keyed by `message_id`. The hold is lifted by `-ReleaseHold` (678-683) or by the selector simply selecting a newer message (`Invoke-WorkerTick` 629-636 consults the ledger only for the message the selector returned). The ledger comment (175-178) states this.
- **Pause**, `-Pause` / `-Resume` (668-677): the only worker-level stop. Durable, operator-only.

### 3.4 What the woken session is told

`Invoke-ClaudeForDirective` (491-556). The prompt names the message, the worktree and five protocol steps. Step 2 is "Read issue 80"; nothing says *check whether another worker has already claimed this packet*. The tool allowlist (547-552) is `gh`, `git`, `node` and the file tools, so the session could run such a check; it is not asked to.

### 3.5 The second executor path

A cloud or interactive Claude session receives directives by **human relay** (the operator pastes them, as happened here and as `CLAUDE.md` describes: "locate the latest DIRECTIVE/REVIEW addressed to Claude"). This path has no selector, no cursor, no ledger and no lock. It is governed only by the protocol text the session reads. `AGENT_CONTROL_PLANE.md` "Control topology" (11-42) draws exactly one executor, "Claude Code local worker".

### 3.6 Holds at the reducer

`scripts/agent-control/lib/authority-effects.mjs`, `applyEffect` (272-320)

- `HOLD_SET` and `HOLD_CLEAR` are packet-keyed (281-299). A packet effect on a held packet fails with `PACKET_HELD` (300-304). A HOLD **is not** superseded by an unrelated directive at the reducer; it is released only by a RESUME for that packet. On this axis the directive's item 3 already holds.
- The gap is upstream: the worker never reads the projection. `status.mjs` exposes `holds: activeHolds(state)` (line 60) and `--verify` reconciles against #80, but nothing in `Invoke-WorkerTick` (604-668) calls it. A HOLD that is not the *newest* message is invisible to the selector (`select-directive.spec.mjs` 282 proves only the newest-HOLD case).

### 3.7 Why a NO_STATE_CHANGE directive matters here

The Contacts directive carried `control_effect: NO_STATE_CHANGE` because another packet was in flight and `PACKET_RELEASE` would have been refused with `PACKET_IN_FLIGHT` (`applyEffect` 305-310). The consequence is that the projection has **no record that the Contacts packet is live**, so no state-level exclusivity could have applied to it even if one existed. Any lease design that lives in `programme-state.yaml` must allow for work released this way, or that path must be closed. See §9.

### 3.8 Five mechanisms that are not one another

The incident was misread in real time because five different things are each called a hold, a lock or ownership. They must stay distinct in any correction.

| Mechanism | Where it lives | Keyed by | Who sets and clears it | What it guarantees |
|---|---|---|---|---|
| **Durable reducer HOLD** | `programme-state.yaml` projection, folded from #80 by `authority-effects.mjs` | `packet_id` | ChatGPT HOLD sets; only a RESUME for that packet clears (281-299) | no packet effect folds for that packet; survives unrelated directives |
| **Local worker retry bound** (`HELD_RETRYABLE`) | `.agent-control/.worker/attempts.json`, one host | `message_id` | two identical failures set it; `-ReleaseHold` or the selector choosing a newer message ends it (214-250, 629-636) | Claude is not re-invoked for that one message; nothing about the packet or other workers |
| **Host-local lock** | `.agent-control/.worker/worker.lock`, one checkout | PID | the worker process (312-331) | one worker process per checkout on one host; nothing across hosts (`AGENT_AUTOPILOT_OPERATIONS.md` 135-138) |
| **ACK-based ownership evidence** | issue #80, append-only | `(packet_id, directive message_id)` + the posting worker | the worker's own ACK; read by nobody today | after §5.2, a deterministic *claim order* readable by every executor; not an atomic lock (§6) |
| **Canonical execution authority** | the newest valid ChatGPT DIRECTIVE/REVIEW/HOLD/RESUME on #80 (`collectAuthority`, 331) | message order | ChatGPT only | what may happen now; it addresses `claude`, and today names no worker |

None of the first four can stand in for the fifth, and none of them today knows the others exist.

## 4. Verified failure mechanism

1. A directive is addressed to a model name, not a worker (§3.1).
2. Two executors are live: the local worker via its selector (§3.2) and a cloud session via human relay (§3.5). Nothing links them.
3. Each executor's ownership checks are host-local (§3.3) and each passed, truthfully.
4. Neither executor reads other executors' ACKs before ACKing, because ACKs are not authority and the prompt does not ask for it (§3.1, §3.4).
5. Both derived the same ACK id from the directive id, so even a human scanning #80 saw one id, not two claims.
6. The branches diverged; detection was manual.

A hold did not fail. A lock did not fail. The system behaved as specified; the specification has one executor.

## 5. Minimal recommended correction

Three changes, each independently useful, each reversible.

### 5.1 Worker identity in the envelope

**Vocabulary.** Two optional fields, read by the shared parser like every other field:

```yaml
assigned_worker: <worker-id>   # on DIRECTIVE / REVIEW addressed to Claude
worker: <worker-id>            # on every message a Claude executor posts
```

A worker id is a stable string the operator assigns, for example `local-windows-1`, `cloud-claude`. It is not the model name and not a session id. A registry lives in `AGENT_AUTOPILOT_POLICY.yaml` under `worker.identities`.

**ACK id convention.** `CC-ACK-<packet-suffix>-<worker-id>-<n>`. Unique by construction across workers.

**Parser.** `control-envelope.mjs`: no change to `REQUIRED_ENVELOPE`; `assigned_worker` and `worker` are read through `envelopeField` where needed. A directive without `assigned_worker` is **legacy-addressed** (see §5.2).

**Issue #80 body.** "Every message must include" gains `worker` for Claude messages and `assigned_worker` for Claude-directed authority. This is a documentation edit to the issue body, which the parser does not read; it is the human contract.

### 5.2 Worker-side filtering

`select-directive.mjs`, `selectDirective({ comments, processed, authors, workerId, requireAssignment })`:

- If `workerId` is unset: behaviour identical to today (no new rejection reasons). This is the compatibility default.
- If the decisive message has `assigned_worker` and it is not `workerId`: select nothing, reason `assigned_to_other_worker:<id>`. **Select nothing, not an older message**: the newest authority still governs; it is simply not this worker's.
- If the decisive message has no `assigned_worker`: select it when `requireAssignment` is false (migration period), otherwise reason `unassigned_directive`.
- **Claim check.** Among the comments newer than the decisive message, any ACK whose `in_reply_to` is the decisive `message_id` and whose `worker` is set and differs from `workerId` makes the message `claimed_by_other_worker:<id>`. First valid ACK wins the packet. This reads non-authority messages for one purpose only, with their own validation: `sender: claude`, allowlisted author, `message_type: ACK`, `worker` present. It never promotes an ACK to authority.

`claude-worker.ps1`:

- New parameter `-WorkerId`, passed to the selector, recorded in the install record (`-RecordInstall`), and shown by `-Status`.
- `Invoke-ClaudeForDirective` prompt gains one step before ACK: "Before posting ACK, re-read issue 80. If an ACK for this message from another `worker` exists, post nothing, end with `KEYFLOW-WORKER-DONE` and the reason `claimed_by_other_worker`." The session has `gh`; this is a read.
- The worker's own ACK carries `worker: <WorkerId>`.

Interactive and cloud sessions follow the same two rules by protocol text (`CLAUDE.md` "Before mutation"): they carry a `worker` id the operator gives them in session, they check for a prior claim before ACK, and they refuse a directive whose `assigned_worker` is not theirs.

### 5.3 Holds consulted at the wake

`claude-worker.ps1`, `Invoke-WorkerTick`, after `Get-PendingDirective` and before the attempt-ledger check:

- Run `node scripts/agent-control/status.mjs --json --verify` (already allowlisted tooling) and read `holds`.
- If any active hold names the selected `packet_id`: do not wake, log `PACKET_HELD_BY_AUTHORITY`, post nothing (the reducer's hold is already the durable record). Retry next tick; a RESUME lifts it.
- If `--verify` reports the authority record unverifiable (an edited comment, order ambiguity): do not wake, log the reason. This matches the selector's own fail-closed stance.

And one clarification, documentation only: `HELD_RETRYABLE` is a **retry bound on one message**, not a stop. The operator's durable stop is `-Pause`. `AGENT_AUTOPILOT.md` "Bounded retry" and the MOMENTUM template text ("Post a newer ChatGPT DIRECTIVE or REVIEW (it supersedes this one)") should say "a newer message for this packet". Whether a newer message for a *different* packet should wake a worker that is retry-held on another is a policy choice; today it does, and the reducer hold in 5.3 is the correct instrument when the operator wants the worker to stay away from a packet.

## 6. Exclusive packet ownership: the lease model

**What the ACK lease is, and is not.** It is an immediate collision-prevention mechanism: a deterministic claim order that every executor can read, so a second worker learns within one GitHub round trip that the packet is taken and stops without mutating. It is **not** an atomic ownership guarantee. Two workers that each read #80, each see no claim, and each post an ACK seconds apart have both "acquired" the lease in their own view; the record resolves the loser only on their next read, and a worker that has already started mutating in that window has mutated under a claim it did not hold. The window is seconds rather than the nineteen minutes of the incident, and the loser's obligation is to stop and post one STOP line, so the damage is bounded and visible. A stronger guarantee needs a compare-and-set primitive that fails for the second caller at the moment of the attempt. One such primitive already exists in the system and is noted in §7-B: creating the directive's `implementation_branch` on origin is atomic per ref, so the first `git push origin HEAD:refs/heads/<branch>` of a new ref succeeds and the second is refused by GitHub. Whether to layer that under the ACK claim, or to move ownership into the reducer (§7-A, after §9.1), is a decision this proposal presents and does not take.

The claim itself is the ACK. No new store is needed; issue #80 is already append-only, ordered, and the source every executor reads.

| Question | Answer |
|---|---|
| What is the lease key | `(packet_id, directive message_id)` |
| Who holds it | the `worker` named on the first valid ACK whose `in_reply_to` is that directive |
| How it is acquired | by posting that ACK; the §5.2 claim check makes a later ACK from another worker invalid, and that worker stops |
| Duplicate ACK | the second worker treats its own ACK as void, posts one STOP line naming the holder, and does no mutation. Exactly what the ruling of 01:07 asked for, made automatic |
| How it ends | RETURN, CLOSE, a CONTRADICTION that stops the packet, or a REVIEW that reassigns |
| Reassignment | a REVIEW naming `assigned_worker: <new id>` and `lease_action: TRANSFER` with `in_reply_to` the original directive. The new worker's ACK references the review; the old holder stops on reading it |
| Expiry | none by clock. A silent worker is handled by reassignment, which ChatGPT already does by review. A clock-based expiry would let two workers race at the boundary, which is the defect being fixed |
| Worker crash | the lease persists in the record. The same worker resumes by posting a continuation ACK (`lease_action: RESUME`) referencing its own prior ACK; its cursor and ledger are unchanged. A different worker needs a TRANSFER review |
| Worktree and branch | the lease names neither. The branch is the directive's `implementation_branch`; a worker that finds the branch already on origin with commits it did not make treats that as a competing writer and posts CONTRADICTION, which both ACKs already promised to do |

What this does not solve: two workers posting ACKs within the same few seconds. #80 orders by `created_at` then comment id, so the record still picks one; the loser learns on its next read. The window is the GitHub round trip, seconds, versus the nineteen minutes of the incident.

## 7. Alternatives considered

| Approach | Cost | What it buys | Why not first |
|---|---|---|---|
| **A. Lease in `programme-state.yaml`** (a `writer` field set by the reducer from ACKs) | reducer change, new fold rule, checkpoint schema bump | machine-checkable lease in the projection | ACKs are deliberately non-authority (§3.1); folding them changes the reducer's trust model. And NO_STATE_CHANGE packets never enter the projection (§3.7). Good second step once §9.1 is settled |
| **B. Branch creation as the lease** (first `git push origin impl/<branch>` wins; others must find it absent) | none | cheap, already half-practised | both workers checked before either pushed; and a cloud session pinned to another branch name never collides. Keep as a secondary check, not the lease |
| **C. One worker per packet by operator practice** (pause the local worker before relaying to a cloud session) | none | works today | relies on memory; this incident is what forgetting looks like. Keep as interim rule until §5 ships |
| **D. Per-packet GitHub label or sub-issue as a lock** | new objects, new permissions, new parser input | visible in the UI | more surface than §6 and a second source of truth beside #80 |
| **E. Remove the second executor path** (cloud sessions never execute packets) | none | no collision | throws away the parallel capacity the operator wants; the directive's goal is parallel execution that is safe by design |

Recommendation: §5 now; A as the follow-on if a machine-checkable lease is wanted in the projection.

## 8. Test cases

All in `scripts/agent-control/tests/`, Node test runner, no network. Negative controls assert what an unauthorized worker **cannot** do.

**`select-directive.spec.mjs`** (selector; pure)
1. `assigned_worker` equals `workerId`: selected, unchanged output.
2. `assigned_worker` is another id: nothing selected, reason `assigned_to_other_worker`, and **no older message is selected in its place**.
3. No `assigned_worker`, `requireAssignment: false`: selected (legacy).
4. No `assigned_worker`, `requireAssignment: true`: nothing selected, reason `unassigned_directive`.
5. `workerId` unset: every existing case passes byte-identically (compatibility).
6. Claim: a newer ACK from another `worker` with `in_reply_to` the decisive id: nothing selected, reason `claimed_by_other_worker`.
7. Claim negative controls: an ACK with no `worker`, an ACK from a non-allowlisted author, an ACK with `sender: chatgpt`, an ACK replying to a different message, an ACK older than the directive: none of them blocks selection.
8. Claim by self: an ACK from `workerId` itself does not block (the worker may resume).
9. Concurrency: two ACKs for the same directive from two workers, same second, differing comment ids: the lower comment id holds; the selector run as the other worker reports `claimed_by_other_worker`.
10. An edited ACK from an allowlisted author: fail closed, nothing selected (reuses `collectAuthority`'s edit stance; must be asserted, since ACKs are read on a new path).

**`windows/worker-authority.spec.mjs`** (the real `claude-worker.ps1` against recorded `gh` and `claude` stubs; the existing harness)
11. A directive assigned to another worker: no wake, log `assigned_to_other_worker`, cursor unchanged.
12. A directive already ACKed by another worker: no wake, cursor unchanged, no comment posted.
13. The woken session's prompt contains the pre-ACK claim check text and the worker id.
14. `-Status` shows the worker id; `-RecordInstall` writes it; a worker started without `-WorkerId` reports `legacy identity` and still runs.

**`windows/worker-retry.spec.mjs`**
15. A packet with an active reducer HOLD: no wake, log `PACKET_HELD_BY_AUTHORITY`, no MOMENTUM posted, retried next tick.
16. The HOLD is released by a RESUME: the next tick wakes.
17. `status.mjs --verify` unverifiable: no wake, reason logged.
18. Existing case 95 ("a held directive is released by a newer directive or by the operator") kept, with its wording tightened to "a newer message for the same packet".

**Recovery**
19. Worker crash after ACK, before RETURN: restart with the same `-WorkerId`; the selector sees its own ACK, selects the message again, the prompt tells the session to post a continuation ACK with `lease_action: RESUME`.
20. TRANSFER: a REVIEW with `assigned_worker: B`, `lease_action: TRANSFER`; worker A's selector reports `assigned_to_other_worker`; worker B's selector selects.

**Documentation gate**
21. `worker.spec.mjs` already parses the policy file and the worker; add an assertion that `AGENT_AUTOPILOT_POLICY.yaml` `worker.identities` is non-empty when `require_assignment` is true.

## 9. Contradictions with existing contracts

1. **NO_STATE_CHANGE as a release channel, unresolved.** The reducer's single-active-packet rule (`PACKET_IN_FLIGHT`, 305-310) is the only state-level exclusivity the plane has. The Contacts directive carried `NO_STATE_CHANGE` precisely so that it would not be refused by that rule while KF-META-AUTOPILOT-SWEEP-COVERAGE-001 was in flight (§3.7). The result is a packet that is live in practice and absent from the projection: no `active_packet`, no state, no hold target, no place for an owner. Two architectural decisions are possible; **this proposal presents both and selects neither**:

   - **Decision A, parallel packets become first-class in the reducer.** A new effect (say `PACKET_RELEASE_PARALLEL`, or `PACKET_RELEASE` with a `lane`) lets more than one packet be active, each with its own state, holds and, later, an owner (§7-A). `applyEffect` 305-310, `PROJECTED_STATE`, `status.mjs` and the checkpoint schema change. The projection becomes the place where ownership can be checked atomically by the mutation-serialised orchestrator. Cost: a reducer change under the strictest review discipline in the repository, and every consumer of `active_packet` as a scalar.
   - **Decision B, `NO_STATE_CHANGE` never releases work.** Work is released only by `PACKET_RELEASE`, so at most one application packet is live and the existing rule is the exclusivity. Parallel execution is then only ever meta-versus-application, or sequential. The projection stays as it is; ownership stays on #80 (§6) and cannot be made atomic at the state level. Cost: the parallel capacity the operator wants is not available, and the Contacts pilot's own release pattern becomes non-conforming.

   Until one is authorized, the lease in §6 is the only ownership record available, and it carries the limitation stated at the top of §6.
2. **`AGENT_AUTOPILOT_POLICY.yaml` 169** `duplicate_instance_protection: pid_lock` and **`claude-worker.ps1` 311** "never run two Claude workers for the same packet" overstate what the lock does. `AGENT_AUTOPILOT_OPERATIONS.md` 135-138 already contradicts them. The policy line should read `pid_lock (per host and checkout)` and the lease should be named as the cross-host instrument.
3. **`AGENT_CONTROL_PLANE.md` control topology** (11-42) shows one executor. With cloud sessions acting on packets the diagram is wrong, which is how the second path escaped every review of the worker. It should show `n` workers behind one selector contract.
4. **Issue #80 "Every message must include"** has no worker field, and the MOMENTUM template in `claude-worker.ps1` `Send-HoldEscalation` (251-300) posts `sender: claude-worker` while Claude sessions post `sender: claude`. The sender vocabulary already half-distinguishes executors by accident; §5.1 makes it deliberate and moves it to `worker:` so `sender` keeps its current meaning for the parser (`AUTHORITY_SENDER` checks exact `chatgpt`; nothing checks Claude's sender).
5. **`CLAUDE.md` "Before mutation"** lists "post ACK to issue #80" but not "verify no prior claim". That text is what governed the cloud session; it needs the §5.2 sentence or the rule exists only in the worker.

## 10. Backward compatibility

| Component | Effect of §5 | Risk |
|---|---|---|
| `control-envelope.mjs` parser | none to `REQUIRED_ENVELOPE`; two optional fields read on demand | nil; every historical message parses as before |
| `select-directive.mjs` | new optional inputs; default path byte-identical | covered by test 5 |
| `select-directive.ps1` wrapper | passes `-WorkerId` through | trivial |
| `claude-worker.ps1` | new parameter, one new tick step, prompt text, install record field | contract version bump to 3 so an un-reinstalled worker stays a no-op (`Test-InstallContract` 302-308 already enforces this) |
| `authority-effects.mjs`, `state-machine.mjs`, `reconcile.mjs`, `events.mjs` | **no change** | the reducer never reads ACKs; leases stay off the projection until §9.1 is decided |
| `agent-control-autopilot.yml`, `agent-control-gate.yml` | none | the gate binds artifacts to a PR, not to a worker; it could later require `worker` in `claude-return.yaml` |
| `.agent-control/claude-return.yaml` | optional `worker:` line, implementer-owned | informational now; a gate check later |
| Historical #80 messages | unchanged, unedited (editing #80 is forbidden and fails the record closed) | none |

## 11. Migration and rollback

**Migration, three steps, each a bounded packet:**
1. Parser and selector with tests 1-10, `workerId` unset by default. Zero behaviour change in production. Ship first because it is pure and fully testable offline.
2. Worker: `-WorkerId`, claim check in the prompt, hold check at the wake, contract version 3, tests 11-20. Reinstall the local worker with its id. During this step ChatGPT starts writing `assigned_worker` on every Claude-directed message; `requireAssignment` stays false.
3. Flip `requireAssignment` true in the policy once every live worker has an id. Update issue #80's body, `CLAUDE.md`, `AGENT_CONTROL_PLANE.md`, `AGENT_AUTOPILOT.md`, `AGENT_AUTOPILOT_OPERATIONS.md`.

**Rollback:** each step reverts independently. Step 1 is inert. Step 2 reverts by reinstalling contract 2. Step 3 reverts by flipping the flag. A worker on the new contract reading a directive with no `assigned_worker` during a rollback selects it (legacy path), so a half-rolled-back fleet does not deadlock.

**Interim rule until step 2 ships:** one live Claude executor at a time. Pause the local worker (`-Pause`) before relaying any directive to a cloud session, and resume it after that session posts RETURN or STOP. Record the pause in the ACK.

## 12. Implementation boundaries and dependencies

- **Files that would change** (none changed by this document): `scripts/agent-control/select-directive.mjs`, `select-directive.ps1`, `claude-worker.ps1`, `install-claude-worker.ps1` (record the id), `tests/select-directive.spec.mjs`, `tests/windows/worker-authority.spec.mjs`, `tests/windows/worker-retry.spec.mjs`, `tests/worker.spec.mjs`, `docs/development/AGENT_AUTOPILOT_POLICY.yaml`, the five documents named in §11 step 3, and the issue #80 body.
- **Files that must not change under this proposal:** `control-envelope.mjs` beyond reading two optional fields; `authority-effects.mjs`; `state-machine.mjs`; `admission.mjs`; `merge-grant.mjs`; every workflow.
- **Depends on:** nothing in flight. It does not touch PR #190 or any `impl/*` branch.
- **Blocks:** nothing. Parallel packets can continue under the interim rule.
- **Needs from ChatGPT:** the §9.1 decision before any projection-level lease is designed; the `assigned_worker` habit on every Claude-directed message from step 2 onward.
- **Needs from the operator:** worker ids for the fleet (today: one local worker, one cloud session); the reinstall in step 2.

## 13. What this proposal does not claim

It does not claim the local worker or the cloud session did anything wrong on 2026-10-30; both followed the protocol as written. It does not claim the retry hold is defective; it did what its comment says. It does not propose a clock-based lease, a new store, or a change to merge admission. It proposes giving the control plane the one concept it was missing, a worker, and reading the claims that workers already post.
