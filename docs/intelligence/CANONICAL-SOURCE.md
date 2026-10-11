# Where the canonical intelligence lives, and how to load it from `main`

Status: pointer and provenance record. It holds no programme state and grants no authority.
Last verified: 2026-10-11, against `main` `98ee0202499ba87fa4ee13d58a2a9075016225bd`.

## Why this file exists

`CLAUDE.md` and `AGENTS.md` tell an agent to read the intelligence documents before working. Those documents are not on `main`. `main` holds one file under `docs/intelligence/` besides this one: the K12 characterization receipt. An agent starting from `main` had no path to the rest and no way to tell which copy was current.

This file gives that path. It does not copy the documents onto `main`. The intelligence branches hold the forensic record, and merging one into `main` would bring 410 intelligence files and changes to 252 others.

## What is authoritative for what

From `docs/development/AGENT_CONTROL_PLANE.md`, "Control-state precedence". Read in this order when two sources disagree:

| Question | Authority | How to read it |
|---|---|---|
| What exists | the repository, PRs and CI | `git`, `gh` |
| What may happen now | the newest valid ChatGPT `DIRECTIVE` / `REVIEW` / `HOLD` / `RESUME` on issue #80 | `gh issue view 80 --repo SaCH-PRO/KEYFLOWOS --comments` |
| The live programme state | the fold of that authority over the reviewed checkpoint | `node scripts/agent-control/status.mjs --verify` |
| Packet topology and order | `docs/development/KEYFLOWOS_PROGRAMME_DAG.yaml` on `main` | this checkout |
| Durable intent, packet definitions, forensic and checkpoint history | branch `docs/keyflow-intelligence-foundation` | `git show`, below |

`.agent-control/programme-state.yaml` on `main` is a **reviewed checkpoint**, not live state. It is old by design: the reducer folds every newer typed authority message over it, and `status.mjs --verify` reports the result. Do not edit it to "bring it up to date". A re-anchor is a reviewed semantic change authorized by ChatGPT, and tests pin the current anchor.

`.agent-control/active-packet.yaml` and `.agent-control/claude-return.yaml` on `main` are whatever the last merged `impl/` PR left. They are per-PR admission artifacts, read by the gate at a PR's head and never from `main`. They describe a merged packet and are not a pointer to the active one.

## The intelligence branches

All three fork from `e1203b34` (2026-09-03).

| Branch | Tip | What it is |
|---|---|---|
| `docs/keyflow-intelligence-foundation` | `f406d15c12d5` (2026-10-07) | the canonical home named by the programme DAG: packet definitions, the wave board, the forensic record |
| `docs/kf-convergence-introspection-001` | `5d64ecdb46b1` (2026-10-07) | PR #157, draft, based on the foundation branch: the newest continuity repair (12 files) |
| `docs/rnd-corpus-foundation-001` | `2f3a200122fe` (2026-10-06) | PR #154: research corpus; its copies of the load-order files are the September ones |

### The load-order files, and how stale each is

| File | Newest copy | Applies to `main` `98ee0202`? |
|---|---|---|
| `docs/intelligence/00-START-HERE.md` | PR #157 (`d70060b7`, 2026-10-07); foundation has `bc4080be` (2026-09-17) | Process and orientation: yes. The September copy says no production implementation is authorized, which later authority superseded. |
| `docs/intelligence/AGENT-CONTINUITY.md` | identical on all three (`b126a672`, 2026-09-05) | Yes. It is process text, not state. |
| `docs/intelligence/handoff/CURRENT-HANDOFF.md` | PR #157 (`5d64ecdb`, 2026-10-07); foundation has `b41ec3c4` (2026-09-22) | **No, for state.** Foundation names `main` as `83b5f98d`. PR #157 names `ac3a6384`, calls PR #159 a draft and admission blocked; PR #159 has since merged. |
| `docs/intelligence/handoff/CURRENT-STATE.yaml` | PR #157 (`cf5f3a80`, 2026-10-07); foundation has `23995490` (2026-09-22) | **No, for state.** Same stale facts. |
| `docs/intelligence/execution/IMPLEMENTATION-WAVE-EXECUTION-BOARD.md` | identical on all three (`b4e5bb54`, 2026-09-28) | Topology and gates: yes. Its counts are stale: it says 4 checkpointed and ACTION-001 active; the live fold says 5 and `KF-EXEC-AUTH-FAIL-CLOSED-001`. |
| `docs/intelligence/execution/MULTI-AGENT-EXECUTION-PROTOCOL.md` | identical on all three (`b4e5bb54`, 2026-09-28) | Roles and envelopes: yes. It predates typed `control_effect`; `AGENT_CONTROL_PLANE.md` on `main` governs those. |

## Load path from `main`

1. `AGENTS.md`, `docs/development/EXECUTION_CONTROL_STANDARD.md`, `docs/development/AGENT_CONTROL_PLANE.md` (this checkout).
2. Live state: `node scripts/agent-control/status.mjs --verify`. Trust it over any handoff file.
3. Issue #80: the newest authority message addressed to you.
4. The intelligence documents, without changing your checkout:

```bash
git fetch origin docs/keyflow-intelligence-foundation
git show origin/docs/keyflow-intelligence-foundation:docs/intelligence/00-START-HERE.md
git show origin/docs/keyflow-intelligence-foundation:docs/intelligence/AGENT-CONTINUITY.md
git show origin/docs/keyflow-intelligence-foundation:docs/intelligence/execution/IMPLEMENTATION-WAVE-EXECUTION-BOARD.md
git show origin/docs/keyflow-intelligence-foundation:docs/intelligence/execution/<PACKET-FILE>.md
```

5. The handoff files on any branch are a record of what was true when they were written. Use them for history and intent. Take current state from steps 2 and 3.

## What would make this simpler, and who decides

- Refresh PR #157's three snapshot files to current `main` and land it into `docs/keyflow-intelligence-foundation`. Then the foundation branch is the single newest copy of every load-order file.
- A refresh of the wave board's counts is a programme-map refresh. The checkpoint records `programme_map_refresh_authorized: false`, so that needs ChatGPT.
- Neither is done by the change that added this file.

## Keeping this file honest

The SHAs above are what was verified on the date at the top. A branch tip that has moved since is not an error in the branch. Re-verify and update the date, or say that it is unverified.
