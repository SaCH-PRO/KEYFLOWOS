# Agent memory layer

Working memory for the AI coding agents that build KEYFLOWOS v1 (owner ruling D-253, 2026-11-22, issue #80).
Docs and scripts for the agents' process only: no product code, and no new authority. Everything here either
points at an authoritative source or is derived from one.

**Resuming with no context? Read, in this order, and nothing else first:**

1. `docs/reconstruction/handoff/ORCHESTRATOR-STATE.md`: standing instructions, in-flight work, open owner questions.
2. `docs/reconstruction/handoff/V1-STATUS.md`: what is done, what is ready (generated).
3. The one procedure file below that matches what you are about to do.

Then run `git fetch origin main && node scripts/agent-memory/status.mjs --check`. It compares packet status, not
the sha, so it stays "current" across merges that change no packet's status. If it says STALE, packets have landed
since the status was generated: regenerate it, and expect the state file to be behind too. "Current" says nothing
about the state file: that is hand-written, carries its own timestamp, and is only as fresh as that.

| Layer | What it is here | Authoritative? |
|---|---|---|
| Working | The live conversation context | No. Temporary |
| Episodic | Issue #273 (archived predecessor: #80), git history, PRs | Yes. Append-only |
| Semantic | Plan, rulings, state file, generated status | Plan and rulings yes; state file is a checkpoint; status is derived |
| Procedural | The briefs and runbooks in this folder | They restate rulings; the rulings win |
| Consolidation | The rewrite rules below | - |
| Retrieval | `bundle.mjs`, `status.mjs` | No. Derived projections |

Research this is built on: issue #106 (the owner's memory-architecture research),
`architecture/memory/KEY-MEMORY-CONTEXT-GENOME.md`, `docs/intelligence/research/contracts/CONTEXT-BUNDLE-SCHEMA.yaml`,
`docs/intelligence/research/dossiers/HERMANS-PROGRAMMERS-BRAIN.md`, `docs/intelligence/AGENT-CONTINUITY.md`.
Those are research and historical records; none of them authorizes implementation by itself. D-253 does, for this
folder, `scripts/agent-memory/` and the state and status files in `docs/reconstruction/handoff/` only. This is a projection of the one memory architecture for one consumer (the coding agents), not a second
memory engine (#106 comment 5982170811: "One memory architecture, many projections and consumers").

---

## 1. Working memory: the live context

Research term: "transient working/activation memory", kept "separate from durable canonical memory" (#106 comment
5982274201). Hermans dossier, anti-overload law: "MORE CONTEXT != MORE UNDERSTANDING".
AGENT-CONTINUITY: "Conversation/session memory is temporary. Repository intelligence is durable."

The context is the scarcest resource an orchestrator has. Rules for keeping it small:

- **Delegate wide reads, take back conclusions.** Reading the plan, the build map, a long diff, a CI log or issue
  #273 (or archived #80) goes to a subagent that returns an answer with `file:line`, not the text.
- **Never paste logs.** A suite result is one line: counts, the R0 line as printed, the head sha. Failures: the
  failing test names and the first error, nothing more.
- **One status line per event.** A packet return, a review verdict, a CI result or a merge is one line in the
  conversation and one row in the state file.
- **Point, do not retype.** A child session gets a path to a brief and a packet id (`PACKET-WORKER-BRIEF.md`), not
  the brief. A reviewer gets a path, a sha range and the facts, not a restated procedure.
- **Compile, do not load.** For a packet, read its bundle (`bundle.mjs`), never the whole plan (about 740 KB) or the
  whole build map (about 240 KB).
- **Nothing material lives only in the context.** An owner ruling, a finding, a decision to reorder: write it to
  issue #273 or a file in the turn it happens. "No procedure may require hidden conversational context to execute
  correctly" (#106 comment 5994966639).
- **When the context is getting long** (AGENT-CONTINUITY, "Chat-length risk protocol"): start no new broad
  investigation, finish the current atomic step, rewrite the state file, record the exact next action, and hand
  over to a fresh session. Do not trade continuity for one more tranche.

## 2. Episodic memory: what happened

Research term: "episodic memory". Rule from #106 comment 5981828884: "forgetting should not erase authoritative
evidence/audit history"; raw evidence "is never replaced by summaries" (5982274201).

- **Issue #273** (the active control room, D-319/Q69; archived predecessor: **issue #80**, read-only at GitHub's 2,500-comment cap): every DIRECTIVE, ACK, CLAIM, RETURN, PROGRESS, REVIEW and owner ruling (D-nnn).
- **Control-room rollover rule (2,500-comment cap):** GitHub caps issue comments at 2,500. When the active control-room issue reaches **2,350 comments** (150-comment buffer), the orchestrator opens a successor control-room issue linking back to the retiring issue and its archived predecessors, posts one final pointer comment on the retiring issue naming the new issue number, stops posting operational updates on the retiring issue (never editing or deleting archived comments), and updates `CLAUDE.md`, `AGENTS.md`, `docs/development/agent-memory/*`, `scripts/agent-memory/lib.mjs` (and `scripts/agent-memory/tests/lib.spec.mjs`), and `BOARD.md` (`coord/board`) in the next wave PR.
- **Git history**: commits on main, `pkt/V1-*` branches (a packet's full RED and fix history), wave PRs and their
  review threads.

Append-only and authoritative. **Never loaded whole.** Search it:

```bash
git log --oneline origin/main --grep 'pkt/V1-<ID>'            # a packet's commits on main
git log --oneline origin/main -- <path>                       # what touched a file
git log origin/main --format='%h %s' --grep 'D-2[0-9][0-9]'   # commits that record rulings
gh api 'repos/KEYFLOWOS/KEYFLOWOS/issues/273/comments?since=2026-11-27T00:00:00Z&per_page=100' --jq '.[] | select(.body | test("D-319")) | {id, body}'   # one ruling on #273
```

(`gh issue view <N> --comments`, as `CLAUDE.md` gives it, was refused with HTTP 403 in the cloud sessions on
2026-11-22; the `gh api` form worked.) Where `gh` is not available, use the GitHub issue tools, read the newest page of comments first, and have a
subagent do it and return only the comment id and the ruling text. Summaries in the semantic layer must always
name where the evidence is (a D-nnn, a comment id, a sha, a PR number) so anyone can drill down.

## 3. Semantic memory: what is true now

Research term: "semantic/schema memory". Genome doc section 5, "Canonical versus derived state": canonical state
must be enough to rebuild every derived projection, and a projection links to authority, it does not compete with it.

| File | Kind | Written by |
|---|---|---|
| `docs/reconstruction/V1-PLAN-RECUT.json` | Canonical: the plan of record, every packet | Rulings commits |
| `docs/reconstruction/BUILD-MAP-001.md` | Canonical: every owner ruling D-nnn, once recorded | Rulings commits |
| `docs/reconstruction/handoff/ORCHESTRATOR-STATE.md` | Checkpoint, hand-written: only what cannot be generated | The orchestrator, on every event (section 5) |
| `docs/reconstruction/handoff/V1-STATUS.json`, `V1-STATUS.md` | Derived, GENERATED: status of every packet, counts, critical path, ready list | `node scripts/agent-memory/status.mjs` |
| `docs/reconstruction/V1-HANDOFF-2026-11-20.md`, `handoff/V1-STATUS-2026-11-20.json` | Dated records (20 Nov). Still the reference for build rules and local setup; their counts are superseded by `V1-STATUS.md` | Nobody: do not edit |

Order of authority when two disagree: active control-room ruling (issue #273; archived predecessor: #80), then `BUILD-MAP-001.md` and the plan, then the state file,
then the generated status. A contradiction is reported (CONTRADICTION on #273, under the standing directive), not
silently resolved (#106 comment 5994966639: "A contradiction is a valid state, not an exception to hide").

`V1-STATUS` says how each packet's status was derived and lists the uncertain ones. It sees only main: work on
branches, PRs and child sessions is in the state file's section 3. Each ready row also carries `ready_since` (the newest
evidence commit date among its dependencies, the plan's snapshot date when it has none, or `null` when unknown) and
`stalled: true` when `main_commit_date - ready_since` exceeds the default **14 days** budget (`STALL_BUDGET_DAYS` in
`scripts/agent-memory/lib.mjs`); unknown `ready_since` is never marked stalled. The **Ready but stalled** section in
`V1-STATUS.md` is purely **informational** and deterministic from `main` alone (no wall clock, no branches, no automatic
action, notification, or reassignment — a person decides what a stall means).

## 4. Procedural memory: how to do it

Research term: "procedural/skill memory". #106 comment 5994706532: "automation is not authority"; a learned
procedure is not permission. Each file below restates rules the owner already ruled; none grants anything.

| File | Use it when |
|---|---|
| `PACKET-WORKER-BRIEF.md` | Assigning a packet to a child session (the brief, verbatim, by packet id) |
| `ACCEPTANCE-REVIEW-BRIEF.md` | A packet branch returns: two-lens independent review |
| `CONFIRMATION-REVIEW-BRIEF.md` | A small repair delta needs confirming |
| `WAVE-RUNBOOK.md` | Compacting packets into a wave, proving it, the PR, merge conditions |
| `CHECKLISTS.md` | The repeatable checklists every lane ticks: session start, packet, wave, merge, handoff, advisory review |
| `WORKFLOW-IMPROVEMENTS.md` | D-274: how we speed up with no compromise: the adopted rules every lane follows, owner proposals, research in progress and an experiments log. Read it at session start |
| `LIVE-PROOF-RUNBOOK.md` | Exactly how to run the server proof at one head, the web proof, live journeys and browser sweeps (with RED at the base), and reviews in detached worktrees, on any machine |
| `OWNER-QUESTION-FORMAT.md` | Asking the owner, and recording the answer as D-nnn |
| `MEASUREMENT.md` | Checking what this layer saves, and the resume test |

A procedure changes only with the ruling that changes its rule, in the same commit.

## 5. Consolidation: when each file is rewritten

Research term: "replay/consolidation". Genome doc section 13: consolidation must not delete raw evidence because a
newer belief won, and must not silently overwrite contradictory claims.

| Event | Rewrite | In the same turn |
|---|---|---|
| A PR merges to main | Regenerate `V1-STATUS.*` (`git fetch origin main && node scripts/agent-memory/status.mjs`). State file: remove the merged row from section 3, update next actions; remove from section 2 any ruling that merge carried to main | PROGRESS on #273 (per wave) |
| A packet returns | State file section 3: one row with branch, head sha, verdict so far, next action | RETURN on #273 (per packet) |
| A review verdict arrives | State file section 3: that row's state and next action | - |
| The owner rules | Post D-nnn on #273 first. State file: section 2 gains the ruling, section 4 loses the question. Next rulings commit: `BUILD-MAP-001.md`, and the plan if a packet is added | - |
| A packet is started | State file section 3: one row (child session id, "Building") | - |
| The context is getting long | Whole state file, then hand over | - |

The state file and `V1-STATUS.*` are committed on the next rulings or wave commit; between commits the orchestrator
may keep the state file on its own branch, pushed (an unpushed file is not memory).

**What is dropped from the state file, and where its evidence stays:**

| Dropped | Evidence stays in |
|---|---|
| A merged wave's row, its suite totals and review verdicts | The PR body and review threads; the PROGRESS comment on #273 (or archived #80); the merge commit |
| A returned packet's findings and how each was closed | The RETURN comment on #273 (or archived #80); the `pkt/V1-<ID>` branch history |
| A ruling's summary, once recorded | `BUILD-MAP-001.md` row D-nnn; the #273 (or archived #80) comment |
| An answered owner question | The D-nnn that answered it |
| Yesterday's working rules that became procedure | The runbook; git history of the state file |

The state file is rewritten, never appended to: it should stay about the size it is now. Nothing on #273 or archived #80, no commit
and no `pkt/*` branch is ever deleted or rewritten to make memory smaller.

## 6. Retrieval: the context bundle

Research term: "task-specific projections" (#106 comment 5981894417); genome doc section 12, "Retrieval and Context
Compiler"; contract candidate `CONTEXT-BUNDLE-SCHEMA.yaml`.

```bash
node scripts/agent-memory/bundle.mjs <PACKET-ID>            # Markdown: what a worker or reviewer reads
node scripts/agent-memory/bundle.mjs <PACKET-ID> --json     # the schema-shaped object
node scripts/agent-memory/status.mjs                        # regenerate V1-STATUS.json and V1-STATUS.md
node scripts/agent-memory/status.mjs --check                # exit 1 when the committed status is stale
node --test scripts/agent-memory/tests/*.spec.mjs           # the scripts' own tests
```

Both scripts read `origin/main` through local git (`--ref <ref>` reads another ref, for example a wave branch whose
rulings are not on main yet; `status.mjs` then needs `--stdout`, because the committed files come from origin/main
only). No network, no database. Run `git fetch origin main` first. The tests cover the pure functions in
`lib.mjs`; they are not wired into `package.json` or CI (CI was out of this packet's scope).

A bundle holds: the packet entry; the full text of each ruling it cites, with the `BUILD-MAP-001.md` line; its
`r0_register` rows; its write set with which files exist; its dependencies' status; and paths (not contents) of the
brief and runbook. It follows the schema's required fields and lists its departures at the end of every bundle. Its
health is DEGRADED when a cited ruling cannot be found; today that is true of two packets, which cite "WH3-1", a
rule that has no D-nnn row.

Limits, stated once: a bundle is a derived projection and "MUST NOT outrank [its] source authority" (schema
invariant). A VALID bundle does not mean the packet's premises about the code are true: the worker still checks
them. Rulings made on #273 (or archived #80) but not yet in `BUILD-MAP-001.md` at the ref are not in the bundle: the state file's
section 2 lists them.
