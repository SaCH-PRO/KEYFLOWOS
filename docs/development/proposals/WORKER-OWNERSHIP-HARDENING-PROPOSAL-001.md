# Worker ownership hardening — proposal 001

```yaml
document_id: CC-PROPOSAL-WORKER-OWNERSHIP-001
in_reply_to: CG-DIR-WORKER-OWNERSHIP-RESEARCH-001   # relayed in session; not a #80 event
kind: DOCUMENT_ONLY_PROPOSAL
author: cloud Claude session (claude/elegant-curie-7azpsb)
anchor_main: b1948d2797e1bae3660a3d7173abb75397e05aad
status: REVISION_3_SUBMITTED_FOR_INDEPENDENT_CHATGPT_REVIEW
revision: 3   # rev 2 answered review 5707140581; rev 3 answers CG-REV-WORKER-OWNERSHIP-PROPOSAL-002 (5707193052), corrections 1-7
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
2. **Worker-side filtering.** The selector refuses a message assigned to another worker, and refuses a directive its assigned worker has already ACKed. An ACK from any worker other than the assigned one is a protocol violation, never a claim.
3. **Holds consulted at the wake.** The local worker reads the reducer's active packet holds before waking Claude, so a ChatGPT HOLD on a packet is honoured by the worker and not only by the state projection.

Each is backward compatible by construction: the `worker` fields are optional in the parser, so no historical #80 message becomes malformed, and a worker with no configured identity behaves exactly as today. Compatibility is not safety: until the activation gate in §11 is passed, the fleet is exactly as exposed to collision as it was on 2026-10-30, and the interim one-writer rule stands.

The ACK claim is collision *prevention*, a deterministic claim order with a window of seconds. It is not mutual exclusion. Where exclusion is required, the proposal names the one atomic primitive available today, create-only creation of the implementation branch ref, and the second check every executor must make immediately before its first mutation (§6).

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
- **Claim check (finding 1).** Among the comments newer than the decisive message, an ACK is a *claim* only when all of these hold: `message_type: ACK`, `sender: claude`, allowlisted author, `in_reply_to` equal to the decisive `message_id`, `worker` present, **and `worker` equal to the decisive message's `assigned_worker`** (or to the `assigned_worker` of a later TRANSFER review for the same packet, §6). A claim by the assigned worker makes the message `claimed_by_assigned_worker` for every other worker, and `claimed_by_self` for the assigned one (which may resume). An ACK whose `worker` is anyone else is **not a claim**: it is logged `ack_from_unassigned_worker:<id>`, it never blocks the assigned worker, and the assigned worker's own ACK must name it so ChatGPT can rule on the stray executor. First-valid-ACK ordering therefore decides only between repeated ACKs of the *assigned* worker, never between workers. The check reads non-authority messages for this one purpose and never promotes an ACK to authority.
- **Self-reported identity (finding 1).** `worker:` is written by the worker itself, and every executor today posts through the same allowlisted GitHub account, so the author proves the operator's account, not the machine or session. The minimal design therefore prevents *accidental* collision between honest workers; it does not prevent a worker that lies about its id. Two attestation options are available if that stronger property is wanted, neither selected here: (a) one GitHub identity per worker (a machine user, deploy key or App installation), with the allowlist becoming a map from author to worker id, so attribution is authenticated by GitHub; (b) a per-worker signing key whose public half is registered in the policy file and whose signature over `message_id|packet_id|worker` appears in the ACK, verified by the selector. Option (a) needs no new code path; option (b) needs one.
- **Two different reads, kept apart (correction 5).** The hold check (§5.3) reads the *reducer projection* through `status.mjs --verify`, which folds authority messages only; ACKs are non-authority and never enter it. The claim check reads the *raw comment list* of #80 directly (`gh api repos/{owner}/{repo}/issues/80/comments`, every page) and validates ACK envelopes itself. A fresh claim read succeeds only when: every page returned HTTP 200 and pagination completed; the newest comment id seen is not lower than the newest id seen at wake (a lower one is a stale or partial read); and no allowlisted comment is edited (the same fail-closed stance `collectAuthority` takes, applied here to ACKs). On any other outcome the read is `claims_unreadable` and the executor does not wake, does not mutate and does not push. Neither read substitutes for the other.
- **Second check before mutation (finding 3).** A claim read at wake time is stale by the time a session edits a file. The woken session, and an interactive session equally, performs **both** reads above **immediately before its first source mutation and again immediately before each push**. If a conflicting claim, a TRANSFER review, a HOLD on the packet, or a newer authority message assigned elsewhere has appeared, it stops with no mutation and posts one CONTRADICTION naming what it found. If #80 cannot be read at that moment (rate limit, outage, unverifiable record), it **does not mutate**: an unreadable channel is a BLOCKED result, never a licence. This is the rule that bounds the window the ACK lease leaves open.

`claude-worker.ps1`:

- New parameter `-WorkerId`, passed to the selector, recorded in the install record (`-RecordInstall`), and shown by `-Status`.
- `Invoke-ClaudeForDirective` prompt gains one step before ACK: "Before posting ACK, re-read issue 80. If this message's `assigned_worker` is not your worker id, post nothing and end with `KEYFLOW-WORKER-DONE` and the reason `assigned_to_other_worker`. If a valid ACK for this message from **your own worker id** but a different `claim_id` exists, you are a duplicate process: post nothing, end with `KEYFLOW-WORKER-DONE` and the reason `claimed_by_self_other_process`. An ACK from any other worker id is a violation, not a claim: proceed, and name its comment id under `stray_acks` in your ACK." The session has `gh`; this is a read.
- The worker's own ACK carries `worker: <WorkerId>`.

Interactive and cloud sessions follow the same two rules by protocol text (`CLAUDE.md` "Before mutation"): they carry a `worker` id the operator gives them in session, they check for a prior claim before ACK, and they refuse a directive whose `assigned_worker` is not theirs.

### 5.3 Holds consulted at the wake

`claude-worker.ps1`, `Invoke-WorkerTick`, after `Get-PendingDirective` and before the attempt-ledger check:

- Run `node scripts/agent-control/status.mjs --json --verify` (already allowlisted tooling). The read is **safety critical** and fails closed on every path (finding 5):
  - the process exits non-zero, or stdout is not JSON, or the JSON lacks `holds` as an array: do not wake, log `hold_check_unreadable`;
  - `reconciliation` is `null` (the projection was not verified) or `reconciliation.consistent` is not `true`: do not wake, log `hold_check_unverified` with `reconciliation.findings`; this covers an edited or unordered #80 record, a stale checkpoint and an unreadable repository truth, because `reconcileWithTruth` reports each of those as inconsistency;
  - `projection_drift.drift` is `true`: do not wake, log `hold_check_drift`;
  - any entry of `holds` with `active !== false` whose `packet_id` equals the selected `packet_id`: do not wake, log `PACKET_HELD_BY_AUTHORITY`, post nothing (the reducer's hold is already the durable record); retry next tick, a RESUME lifts it;
  - the selected `packet_id` matches no hold and no active packet in the projection (the NO_STATE_CHANGE case, §3.7): the hold check **passes with a disclosure** logged as `packet_not_projected`, because today such packets are legitimately absent from the projection. After §9.1 is decided this becomes a refusal.
- The same check runs again inside the woken session immediately before its first source mutation (§5.2, second check), since authority can change between wake and edit.

And one clarification, documentation only: `HELD_RETRYABLE` is a **retry bound on one message**, not a stop. The operator's durable stop is `-Pause`. **Current behaviour (correction 6):** the retry bound is keyed by `message_id`, and the worker wakes on whatever newer authority message the selector returns, for any packet; the held message is simply no longer the one selected. The MOMENTUM template text ("Post a newer ChatGPT DIRECTIVE or REVIEW (it supersedes this one)") describes that accurately. **Proposed policy, not yet in force:** the retry bound is lifted only by `-ReleaseHold` or by a newer authority message *for the same packet*; a newer message for a different packet is handled by the selector rule in §6.1 and does not touch the held entry. The reducer hold in 5.3 remains the instrument when the operator wants a worker away from a packet regardless of what is posted.

## 6. Exclusive packet ownership: the lease model

**What the ACK lease is, and is not.** It is an immediate collision-prevention mechanism: a deterministic claim order that every executor can read, so a second worker learns within one GitHub round trip that the packet is taken and stops without mutating. It is **not** an atomic ownership guarantee. Two workers that each read #80, each see no claim, and each post an ACK seconds apart have both "acquired" the lease in their own view; the record resolves the loser only on their next read, and a worker that has already started mutating in that window has mutated under a claim it did not hold. The window is seconds rather than the nineteen minutes of the incident, and the loser's obligation is to stop and post one STOP line, so the damage is bounded and visible. A stronger guarantee needs a compare-and-create primitive that fails for the second caller at the moment of the attempt. **A plain `git push origin HEAD:refs/heads/<branch>` is not that primitive** (finding 3): when the ref already exists and the pushed commit descends from it, the push is an ordinary fast-forward and succeeds. Two create-only forms exist: `git push --force-with-lease=refs/heads/<branch>: origin HEAD:refs/heads/<branch>`, where the empty expected value means the ref must not exist, and the REST call `POST /repos/{owner}/{repo}/git/refs`, which answers 422 when the ref exists. Either gives exclusion at the ref, enforced by GitHub, not by what the caller read. The protocol this proposal recommends for review is: ACK (the readable claim), then create-only creation of the directive's `implementation_branch` before any source mutation, then the pre-mutation re-check. A worker whose create fails has lost, posts one STOP line, and never pushes. The test in §8 must prove the loser's commits never reach origin, and only a live test against a scratch ref proves the hosted behaviour; the offline tests are model checks. Whether to adopt this layering, or to move ownership into the reducer (§7-A, after §9.1), is a decision this proposal presents and does not take.

The claim itself is the ACK, and the ACK is **claim evidence, not an exclusive lease**: it records that the assigned worker has started, it lets every other executor see that, and it fixes an order among that worker's own claims. Exclusion, where needed, comes from the create-only ref step above and from the pre-mutation re-check (§5.2), never from the ACK alone. No new store is needed; issue #80 is already append-only, ordered, and the source every executor reads.

**Claim nonce (correction 2).** A worker id names a role, not a process: two processes started under one id on two hosts, or one host with the PID lock bypassed, post indistinguishable worker-id-only ACKs. Every ACK therefore carries `claim_id: <worker-id>.<nonce>`, where the nonce is 128 random bits generated once per process per directive and kept in the worker's attempt ledger (and, for an interactive session, in its control artifacts). Two valid ACKs with the same `worker` and different `claim_id` are a **duplicate-process** condition: the lower comment id proceeds, the other stops with no mutation (tests 23 and 27). The policy file also forbids one worker id on two hosts (`worker.identities[].host`), so the nonce detects a violation rather than legitimising it. What the nonce does not do: it does not authenticate the process (§5.2, self-reported identity); a forged nonce is a forged ACK, bounded only by the attestation options there.

| Question | Answer |
|---|---|
| What is the lease key | `(packet_id, directive message_id)` |
| Who holds it | the directive's `assigned_worker`, evidenced by its first valid ACK (`in_reply_to` that directive, `worker` equal to `assigned_worker`, `claim_id` present) |
| How it is acquired | **first claim:** the assigned worker posts the ACK, then performs the create-only creation of `implementation_branch` (§6, above) before any source mutation; if the create fails the ref already exists and this is not a first claim (see the resume and transfer rows). The §5.2 claim check makes every other worker's ACK a recorded violation, not a competing claim (correction 1) |
| Stray ACK (another worker id) | never preempts the assigned worker. The stray worker, on its own next read, finds `assigned_worker` is not it and stops with one STOP line; the assigned worker names the stray comment id under `stray_acks` so ChatGPT can rule on the executor. Exactly what the ruling of 01:07 asked for, made automatic |
| Duplicate ACK (same worker id, different `claim_id`) | the lower comment id proceeds; the other process stops with no mutation and reports `claimed_by_self_other_process` |
| How it ends | RETURN, CLOSE, a CONTRADICTION that stops the packet, or a REVIEW that reassigns |
| Reassignment | a REVIEW naming `assigned_worker: <new id>` and `lease_action: TRANSFER` with `in_reply_to` the original directive. The new worker's ACK carries `in_reply_to` the review **and** `lease_of` the original directive id, so claim lineage stays packet-scoped; the old holder stops at its next pre-mutation re-check |
| What a newer REVIEW means (finding 4) | one of three things, decided by its fields, never by recency: a **continuation** (same `packet_id`, same `assigned_worker`, no `lease_action`): the holder keeps the lease and processes it; a **transfer** (`lease_action: TRANSFER`); or **unrelated** (another `packet_id`): it does not touch this lease at all. A REVIEW with a different `assigned_worker` and no `lease_action` is malformed for this packet and fails closed |
| Expiry | none by clock. A silent worker is handled by reassignment, which ChatGPT already does by review. A clock-based expiry would let two workers race at the boundary, which is the defect being fixed |
| Worker crash | the claim persists in the record. The same worker resumes by posting a continuation ACK (`lease_action: RESUME`, a **new** `claim_id`, `lease_of` the original directive) referencing its own prior ACK; its cursor and ledger are unchanged. A different worker needs a TRANSFER review |
| Branch on resume (correction 3) | the create-only step cannot apply: the ref exists. The resuming worker's prior ACK or RETURN recorded `branch_head: <sha>`, the last tip it pushed. It pushes with `--force-with-lease=refs/heads/<branch>:<that sha>`, a compare-and-swap on the known tip. A refusal means someone else moved the branch: stop, post CONTRADICTION, no further push |
| Branch on transfer (correction 3) | the TRANSFER review names `branch_head: <sha>`, the tip the previous holder last reported. The new holder's first push is the same compare-and-swap against that sha; a refusal means the tip is not what authority believes and the transfer stops. The new holder never creates the ref and never force-pushes without the lease value |
| A different push branch | is **not** an exclusion mechanism. The cloud session's `claude/elegant-curie-7azpsb` never contended for `impl/kf-product-contacts-visibility-001`, which is exactly why the ref step would not have detected that collision; only the assignment check (§5.2) would have. The ref step protects the contested branch; the assignment check protects the packet |

### 6.1 Two assigned workers and the newest-only selector (finding 4)

`selectDirective` wakes only for the **newest** authority message on #80 (§3.2). With two live workers that rule starves one of them: worker A is retrying or awaiting a correction on packet P, ChatGPT posts a directive for packet Q assigned to B, and A's selector now sees a newest message that is not its own and selects nothing, even if a REVIEW for P that A must act on sits one message older. The one-worker design never met this case.

Two options, presented for decision:

- **Per-worker lane.** A worker selects the newest *actionable message assigned to it* that is not in its cursor, provided no newer message governs that packet. Messages assigned to other workers are invisible to it rather than blocking. This keeps "newest authority governs" per packet, which is where authority is keyed in the reducer anyway, and drops it per channel. It is a **selector semantics change only**; it neither assumes nor decides §9.1 (correction 4): under decision A each lane is a projected packet, under decision B at most one application lane is ever live, and the lane rule reads the same in both. Its fail-closed rules, each a test in §8:
  - **Malformed newer authority.** Any malformed candidate newer than the lane's chosen message, whatever its assignment, selects nothing. Authority that cannot be read is not skipped (the selector's existing stance, kept global).
  - **Edited or unordered record.** `collectAuthority` already fails the whole record closed; the lane inherits that: nothing is selected for any worker.
  - **HOLD and RESUME.** Both are packet-keyed effects. A HOLD newer than the chosen message that names the lane's packet selects nothing; one that names another packet does not govern this lane; one with a blank or missing packet is malformed and selects nothing globally. A RESUME is never actionable by itself. A HOLD that is the newest message on the channel selects nothing for every worker, as today, so the global stop remains available to ChatGPT.
  - **Packet scope.** A newer message with the lane's `packet_id` but a different `assigned_worker` and no `lease_action: TRANSFER` is malformed for that packet and selects nothing. With TRANSFER it ends the lane for this worker.
  - **Unassigned message during migration.** Before the activation gate an unassigned actionable message is legacy and governs every lane: nothing newer-assigned is selected past it. After the gate it is `unassigned_directive` and selects nothing.
- **Keep newest-only.** Simpler, already proven, and ChatGPT sequences directives so that each worker's next message is the newest when that worker needs it. This is manual coordination of a different kind, and it is the thing the directive says must not be permanent.

Tests 29-31 in §8 cover both. The proposal does not select; the per-worker lane is the one consistent with safe parallel autonomy.

What this does not solve: two workers posting ACKs within the same few seconds. #80 orders by `created_at` then comment id, so the record still picks one; the loser learns on its next read. The window is the GitHub round trip, seconds, versus the nineteen minutes of the incident.

## 7. Alternatives considered

| Approach | Cost | What it buys | Why not first |
|---|---|---|---|
| **A. Lease in `programme-state.yaml`** (a `writer` field set by the reducer from ACKs) | reducer change, new fold rule, checkpoint schema bump | machine-checkable lease in the projection | ACKs are deliberately non-authority (§3.1); folding them changes the reducer's trust model. And NO_STATE_CHANGE packets never enter the projection (§3.7). Good second step once §9.1 is settled |
| **B. Create-only ref creation as the exclusion step** (`--force-with-lease=<ref>:` or REST create-ref; a plain push is not create-only) | small: one push flag and one test | genuine atomic exclusion at the implementation branch, enforced by GitHub | it protects the branch, not the packet: a cloud session pinned to another branch name never contends for the ref. Recommended **under** the ACK claim (§6), not instead of it |
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
6. Claim by the assigned worker: a newer ACK whose `worker` equals the decisive `assigned_worker`, with `in_reply_to` the decisive id and a `claim_id`: every *other* worker's selector reports `claimed_by_assigned_worker`; the assigned worker's own reports `claimed_by_self`. An ACK from a worker that is **not** the assigned one is logged `ack_from_unassigned_worker` and changes nothing for the assigned worker.
7. Claim negative controls: an ACK with no `worker`, an ACK from a non-allowlisted author, an ACK with `sender: chatgpt`, an ACK replying to a different message, an ACK older than the directive: none of them blocks selection.
8. Claim by self: an ACK from `workerId` itself does not block (the worker may resume).
9. Concurrency between worker ids: the assigned worker and a stray worker ACK the same directive in the same second, the stray with the lower comment id; the assigned worker's claim stands, the stray's is a violation, and comment order plays no part between worker ids.
10. An edited ACK from an allowlisted author: fail closed, nothing selected (reuses `collectAuthority`'s edit stance; must be asserted, since ACKs are read on a new path).

**`windows/worker-authority.spec.mjs`** (the real `claude-worker.ps1` against recorded `gh` and `claude` stubs; the existing harness)
11. A directive assigned to another worker: no wake, log `assigned_to_other_worker`, cursor unchanged.
12. A directive assigned to this worker but already ACKed by a stray worker id: the worker **does** wake (the stray ACK is not a claim) and its prompt instructs the session to list the stray comment id; a directive assigned to another worker that the other worker has ACKed: no wake, cursor unchanged, no comment posted.
13. The woken session's prompt contains the pre-ACK claim check text and the worker id.
14. `-Status` shows the worker id; `-RecordInstall` writes it; a worker started without `-WorkerId` reports `legacy identity` and still runs.

**`windows/worker-retry.spec.mjs`**
15. A packet with an active reducer HOLD: no wake, log `PACKET_HELD_BY_AUTHORITY`, no MOMENTUM posted, retried next tick.
16. The HOLD is released by a RESUME: the next tick wakes.
17. `status.mjs --verify` unverifiable: no wake, reason logged.
18. Existing case 95 ("a held directive is released by a newer directive or by the operator") kept **unchanged** as the record of current behaviour under the compatibility default. A new sibling case asserts the proposed policy under the policy flag: a newer message for the same packet lifts the bound; a newer message for another packet leaves the held entry in place.

**Recovery**
19. Worker crash after ACK, before RETURN: restart with the same `-WorkerId`; the selector sees its own ACK, selects the message again, the prompt tells the session to post a continuation ACK with `lease_action: RESUME`.
20. TRANSFER: a REVIEW with `assigned_worker: B`, `lease_action: TRANSFER`; worker A's selector reports `assigned_to_other_worker`; worker B's selector selects.

**Documentation gate**
21. `worker.spec.mjs` already parses the policy file and the worker; add an assertion that `AGENT_AUTOPILOT_POLICY.yaml` `worker.identities` is non-empty when `require_assignment` is true.

**Race and recovery (finding 6).** Everything above and below that runs offline is a **model check** of the selector and worker logic against recorded comment fixtures. It proves ordering and fail-closed behaviour; it does not prove GitHub-hosted atomicity. Only test 28 does.
22. Simultaneous claims: fixtures where the assigned worker and a stray worker ACK within the same second; the stray ACK is `ack_from_unassigned_worker`, the assigned worker's claim stands regardless of which comment id is lower.
23. Simultaneous *assigned* claims (two processes of the same assigned worker id, the host-lock-bypassed or two-host case): both ACK with unique ACK `message_id`s (`CC-ACK-<packet>-<worker>-<n>`, `n` from each process's own ledger) and different `claim_id`s; each pre-mutation re-check sees two valid claims of the same worker id; the lower comment id proceeds and the other stops with `claimed_by_self_other_process`; test both sides, and test that two ACKs with the same `claim_id` are treated as one claim (a retried post).
24. Reassignment during execution: worker A holds the lease and has local edits; a TRANSFER review to B appears; A's pre-mutation re-check (or pre-push re-check) finds it, A stops with no push and posts CONTRADICTION; B's ACK carries `lease_of` the original directive.
25. Stale and partial reads, the two paths separately: (a) the fresh claim read returns a newest comment id lower than the one seen at wake, or a page fails, or pagination stops short: `claims_unreadable`, no wake, no mutation; the reducer is not consulted for this and `status.mjs` is not run; (b) the claim read is fresh and clean but the hold check's `reconciliation` is `null` or not `consistent`: `hold_check_unverified`, no wake. Neither path reports through the other's reason code.
26. GitHub unavailable at the pre-mutation check: the session reports BLOCKED and the worktree shows no modified file.
27. Post-ACK crash and restart: worker exits after ACK, before any commit; restart with the same worker id and a fresh `claim_id`; selector returns `claimed_by_self`; the session posts a continuation ACK with `lease_action: RESUME`, a new unique ACK `message_id`, `lease_of` the original directive and `branch_head` from its prior ACK; its push uses the compare-and-swap in §6. A restart under a *different* worker id yields `claimed_by_assigned_worker` and no wake.
28. **Live, hosted, scratch ref:** two processes race to create `refs/heads/scratch/ownership-<run id>` with the create-only push form; exactly one succeeds; the loser's exit is non-zero and its commit is absent from origin. Run in the Windows worker proof workflow against the repository itself, then the ref is deleted. This is the only test that proves atomicity.
29. Per-worker lane: A assigned P, B assigned Q, Q's directive newest; A's selector still selects the newest message assigned to A for P when nothing newer governs P.
30. Per-worker lane, governed: as 29 but a HOLD on P is newer than A's message; A selects nothing.
31. Newest-only (if kept): the same fixtures document the starvation so the choice is made on evidence.

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
| `select-directive.mjs` | new optional inputs; default path byte-identical | covered by test 5; byte-identical means *not yet safer*, see §11 step 3 |
| `select-directive.ps1` wrapper | passes `-WorkerId` through | trivial |
| `claude-worker.ps1` | new parameter, one new tick step, prompt text, install record field | contract version bump to 3 so an un-reinstalled worker stays a no-op (`Test-InstallContract` 302-308 already enforces this) |
| `authority-effects.mjs`, `state-machine.mjs`, `reconcile.mjs`, `events.mjs` | **no change** | the reducer never reads ACKs; leases stay off the projection until §9.1 is decided |
| `agent-control-autopilot.yml`, `agent-control-gate.yml` | none | the gate binds artifacts to a PR, not to a worker; it could later require `worker` in `claude-return.yaml` |
| `.agent-control/claude-return.yaml` | optional `worker:` line, implementer-owned | informational now; a gate check later |
| Historical #80 messages | unchanged, unedited (editing #80 is forbidden and fails the record closed) | none |

## 11. Migration and rollback

**Migration, three steps, each a bounded packet. Steps 1 and 2 are compatibility work and are not collision-safe (finding 2); only the gate in step 3 is.**
1. Parser and selector with tests 1-10 and 22-27, `workerId` unset by default. Zero behaviour change in production. Ship first because it is pure and fully testable offline.
2. Worker: `-WorkerId`, claim and pre-mutation checks in the prompt, hold check at the wake, create-only ref creation if adopted, contract version 3, tests 11-20 and 28. Reinstall the local worker with its id. During this step ChatGPT writes `assigned_worker` on every Claude-directed message; `requireAssignment` stays false, so an unassigned directive is still actionable by any worker. **The fleet is still exposed during this step.**
3. **Activation gate.** `requireAssignment` flips to true only when, in one operator action: every live worker is enrolled with an id and runs contract 3 (`-Status` shows both); every worker is paused for the flip; the policy file and issue #80's body carry the new contract; and ChatGPT confirms it will assign every Claude-directed message from then on. From this point a directive with no `assigned_worker` is `unassigned_directive` for every worker and wakes nobody: **fail closed, not legacy**. The interactive-session rule (`CLAUDE.md`) changes in the same commit. Only after this gate may the rollout be described as collision-safe.

**Rollback (finding 7).** Steps are *technically* reversible, but a rollback to legacy selection while two or more workers are live reopens the 2026-10-30 hazard exactly. So rollback has its own gate: **either the whole fleet is paused, or exactly one worker is live**, before any step is reverted, and the rollback is recorded on #80. Step 1 reverts inertly. Step 2 reverts by reinstalling contract 2 under that gate. Step 3 reverts by flipping the flag under that gate, after which an unassigned directive is actionable again and the interim rule below is back in force. A half-rolled-back fleet never deadlocks, because a contract-3 worker reading an unassigned directive during rollback selects it; that is why the gate matters.

**Interim rule until the step-3 gate is passed:** one live Claude executor at a time. Pause the local worker (`-Pause`) before relaying any directive to a cloud session, and resume it after that session posts RETURN or STOP. Record the pause in the ACK.

## 12. Implementation boundaries and dependencies

- **Files that would change** (none changed by this document): `scripts/agent-control/select-directive.mjs`, `select-directive.ps1`, `claude-worker.ps1`, `install-claude-worker.ps1` (record the id), `tests/select-directive.spec.mjs`, `tests/windows/worker-authority.spec.mjs`, `tests/windows/worker-retry.spec.mjs`, `tests/worker.spec.mjs`, `docs/development/AGENT_AUTOPILOT_POLICY.yaml`, the five documents named in §11 step 3, and the issue #80 body.
- **Files that must not change under this proposal:** `control-envelope.mjs` beyond reading two optional fields; `authority-effects.mjs`; `state-machine.mjs`; `admission.mjs`; `merge-grant.mjs`; every workflow.
- **Depends on:** nothing in flight. It does not touch PR #190 or any `impl/*` branch.
- **Blocks:** nothing. Parallel packets can continue under the interim rule.
- **Needs from ChatGPT:** the §9.1 decision before any projection-level lease is designed; the `assigned_worker` habit on every Claude-directed message from step 2 onward.
- **Needs from the operator:** worker ids for the fleet (today: one local worker, one cloud session); the reinstall in step 2.

## 13. What this proposal does not claim

It does not claim the local worker or the cloud session did anything wrong on 2026-10-30; both followed the protocol as written. It does not claim the retry hold is defective; it did what its comment says. It does not propose a clock-based lease, a new store, or a change to merge admission. It proposes giving the control plane the one concept it was missing, a worker, and reading the claims that workers already post.
