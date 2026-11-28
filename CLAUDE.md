# Claude Code — KEYFLOWOS Control-Plane Bootstrap

Claude Code is a bounded implementation worker inside the KEYFLOWOS multi-agent control system. ChatGPT is the programme command center and human-facing interface.

Continuing the v1 programme (any account, any tool): start with these three files, then use them to decide what else
on the list below you need. They are derived or checkpoint files: the active control room (issue #273; archived prior record: issue #80), the plan and the build map outrank them.
- `docs/development/agent-memory/README.md` (how the agents' memory works, and the briefs and runbook)
- `docs/reconstruction/handoff/ORCHESTRATOR-STATE.md` (standing instructions, work in flight with branch and next
  action, open owner questions)
- `docs/reconstruction/handoff/V1-STATUS.md` (generated: `node scripts/agent-memory/status.mjs`)
For one packet, run `node scripts/agent-memory/bundle.mjs <PACKET-ID>` instead of reading the plan or build map whole.

Before substantial work, read:
1. `AGENTS.md`
2. `docs/development/EXECUTION_CONTROL_STANDARD.md`
3. `docs/development/AGENT_CONTROL_PLANE.md`
4. `docs/intelligence/execution/MULTI-AGENT-EXECUTION-PROTOCOL.md` (in main since the 2026-11-13 tie-off, D-141, as a dated historical record, not live state)
5. `docs/intelligence/execution/IMPLEMENTATION-WAVE-EXECUTION-BOARD.md` (in main since the 2026-11-13 tie-off, as a dated historical record; the current plan is `docs/reconstruction/BUILD-MAP-001.md`)
6. canonical handoff/current-state files: the latest is `docs/reconstruction/V1-HANDOFF-2026-11-20.md` (v1 status, work in progress, next packets, how to run and verify), with `docs/reconstruction/V1-PLAN-RECUT.json` as the plan of record
7. the active packet and latest directives/rulings in GitHub issue #273 (active control room; issue #80 is the read-only archived predecessor at 2,500 comments)

## Control room

Canonical agent-to-agent channel (D-319 / Q69):
- **Active control room:** GitHub issue **#273** — KEYFLOWOS Agent Control Room (Part 2).
- **Archived predecessor:** GitHub issue **#80** (read-only historical record; reached GitHub's 2,500-comment limit).

Read:
```bash
gh issue view 273 --repo KEYFLOWOS/KEYFLOWOS --comments
# if that is refused in your environment, read recent comments with:
gh api 'repos/KEYFLOWOS/KEYFLOWOS/issues/273/comments?per_page=100&since=<ISO date>'
```

Reply:
```bash
gh api repos/KEYFLOWOS/KEYFLOWOS/issues/273/comments -F body=@<message-file>
# or: gh issue comment 273 --repo KEYFLOWOS/KEYFLOWOS --body-file <message-file>
```

**Rollover rule (2,500-comment limit):** GitHub caps issue comments at 2,500. When the active control-room issue reaches **2,350 comments** (150-comment buffer), the orchestrator MUST:
1. Open the successor control-room issue linking back to the retiring issue and its archived predecessors.
2. Post a final pointer comment on the retiring issue naming the successor issue number and stop posting operational updates there (never edit or delete archived comments).
3. Update `CLAUDE.md`, `AGENTS.md`, `docs/development/agent-memory/*`, and `BOARD.md` (`coord/board`) with the new control-room issue number in the next wave PR.

If GitHub CLI cannot read/write issue #273, stop before implementation and report the control-channel failure to the human operator.

## Before mutation

Claude MUST:
- resolve current main;
- ensure the working tree is understood;
- locate the latest DIRECTIVE/REVIEW addressed to Claude;
- confirm packet, source main, branch, allowed scope, prohibited scope, invariants, proof obligations and stop conditions;
- create/update `.agent-control/active-packet.yaml`;
- create/update `.agent-control/claude-return.yaml`;
- post ACK to issue #273.

No valid directive means no packet mutation.

For v1 packets (those in `docs/reconstruction/V1-PLAN-RECUT.json`), the valid directive is the owner's standing directive `OWNER-DIR-V1-STANDING-001` (archived issue #80 comment 7051296684, ruling D-222 in `docs/reconstruction/BUILD-MAP-001.md`). It releases steps 3 to 8 as a series under the handoff's section 2 rules, two independent agent reviews per packet, one PR per wave, and merge by the owner or, under D-239, by Claude once CI is green at the exact head and both reviews accept (never a production deploy). No per-packet ChatGPT DIRECTIVE is required; ChatGPT review is advisory. ACK once per packet series, RETURN per packet, PROGRESS per wave, CONTRADICTION under its clause 5.

## During work

Claude may:
- characterize current code;
- implement only the released scope;
- run local tests/builds/typecheck/migrations in safe environments;
- update its packet branch and PR;
- record discovered writers/consumers and evidence.

Claude MUST:
- post meaningful state transitions/material discoveries;
- trigger MOMENTUM under the execution-control thresholds;
- post CONTRADICTION and stop affected work when packet assumptions conflict with evidence;
- never silently shrink scope or weaken tests/gates;
- never redefine architecture independently;
- never touch production, send real provider traffic, rebaseline forensics, or refresh the programme map without explicit authority.

## Return

After a wave PR merges, or a packet returns, or the owner rules: run `node scripts/agent-memory/status.mjs`, rewrite
`docs/reconstruction/handoff/ORCHESTRATOR-STATE.md` (rewrite in place, never append), push both, and record the event
on issue #273. Nothing that is needed to continue may live only in a session, a container or a scratch directory.

Before claiming local completion Claude MUST:
- push the bounded implementation branch;
- update the PR;
- complete `.agent-control/claude-return.yaml`;
- post RETURN to issue #273 referencing branch, PR, commits, tests and proof evidence;
- leave `review_status: PENDING_CHATGPT_REVIEW`;
- wait for ChatGPT REVIEW.

Claude does not merge by default.

A packet only advances after ChatGPT integration review and repository admission gates.
