# Where the canonical intelligence lives, and how to load it from `main`

Status: pointer and provenance record. It holds no programme state and grants no authority.
Original inventory verified: 2026-10-11, against `main` `98ee0202499ba87fa4ee13d58a2a9075016225bd`.
Routing and integration disposition reviewed: 2026-10-17, from PR #173 `842aa4acfd110c9595bb7229c4788dcb6394d771`. The original inventory below remains dated; the October 17 route supplies newer intent and evidence. Re-resolve current main, exact PR heads and valid #80 authority before acting.

## Why this file exists

`CLAUDE.md` requires intelligence context before substantial work. At `main` `98ee0202`, the only file under `docs/intelligence/` is the K12 characterization receipt. PR #173 adds this pointer and a separate TIME-001 admission preparation. The broader intelligence documents remain on their recorded branches; this pointer gives an agent starting from main a precise path to them.

This file gives that path without copying historical intelligence or changing execution authority. PR #173 owns this main-to-intelligence route; PR #157 owns the broader continuity repair; PR #180 owns the October 17 evidence. Reading a pinned document on an unmerged branch does not admit that branch or its contents.

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

## Dated intelligence inventory

The following original three-branch inventory was verified on October 11. All three fork from `e1203b34` (2026-09-03). Their recorded state is historical, not live authority.

| Branch | Tip | What it is |
|---|---|---|
| `docs/keyflow-intelligence-foundation` | `f406d15c12d5` (2026-10-07) | the canonical home named by the programme DAG: packet definitions, the wave board, the forensic record |
| `docs/kf-convergence-introspection-001` | `5d64ecdb46b1` (2026-10-07) | PR #157, draft, based on the foundation branch: the newest continuity repair (12 files) |
| `docs/rnd-corpus-foundation-001` | `2f3a200122fe` (2026-10-06) | PR #154: research corpus; its copies of the load-order files are the September ones |

### Original load-order files and their recorded staleness

| File | Newest copy | Applies to `main` `98ee0202`? |
|---|---|---|
| `docs/intelligence/00-START-HERE.md` | PR #157 (`d70060b7`, 2026-10-07); foundation has `bc4080be` (2026-09-17) | Process and orientation: yes. The September copy says no production implementation is authorized, which later authority superseded. |
| `docs/intelligence/AGENT-CONTINUITY.md` | identical on all three (`b126a672`, 2026-09-05) | Yes. It is process text, not state. |
| `docs/intelligence/handoff/CURRENT-HANDOFF.md` | PR #157 (`5d64ecdb`, 2026-10-07); foundation has `b41ec3c4` (2026-09-22) | **No, for state.** Foundation names `main` as `83b5f98d`. PR #157 names `ac3a6384`, calls PR #159 a draft and admission blocked; PR #159 has since merged. |
| `docs/intelligence/handoff/CURRENT-STATE.yaml` | PR #157 (`cf5f3a80`, 2026-10-07); foundation has `23995490` (2026-09-22) | **No, for state.** Same stale facts. |
| `docs/intelligence/execution/IMPLEMENTATION-WAVE-EXECUTION-BOARD.md` | identical on all three (`b4e5bb54`, 2026-09-28) | Topology and gates: yes. Its counts are stale: it says 4 checkpointed and ACTION-001 active; the live fold says 5 and `KF-EXEC-AUTH-FAIL-CLOSED-001`. |
| `docs/intelligence/execution/MULTI-AGENT-EXECUTION-PROTOCOL.md` | identical on all three (`b4e5bb54`, 2026-09-28) | Roles and envelopes: yes. It predates typed `control_effect`; `AGENT_CONTROL_PLANE.md` on `main` governs those. |

## Load path from `main`

1. Read `AGENTS.md`, `docs/development/EXECUTION_CONTROL_STANDARD.md` and `docs/development/AGENT_CONTROL_PLANE.md` at current main.
2. Resolve live programme state with `node scripts/agent-control/status.mjs --verify`, and read the newest valid issue #80 authority. These outrank handoff snapshots.
3. Read the latest followthrough record and accepted roadmap through the pinned October 17 route below. Distinguish accepted intent, review, implementation, admission, merge and post-merge verification.
4. Read PR #157's pinned START-HERE for orientation, with its October 7 state sections treated as historical. Its stale references to PR #159 and prior PR #155 heads do not control current execution.
5. Read the affected packet definitions, process documents and history from the recorded foundation revision, then resolve exact active PR artifacts.

### October 17 roadmap and evidence route

| Document | Pinned source | Interpretation |
|---|---|---|
| Latest followthrough session | [Current followthrough record](https://github.com/SaCH-PRO/KEYFLOWOS/blob/9e222e8e3b739fafa539ac0d6f5ff834d4858492/docs/intelligence/sessions/2026-10-17-worker-review-followthrough/README.md) | Dated next actions, scope and evidence. Re-resolve authority and heads before acting. |
| Accepted capability roadmap | [ACCEPTED-CAPABILITY-ROADMAP-2026-10-17.md](https://github.com/SaCH-PRO/KEYFLOWOS/blob/9e222e8e3b739fafa539ac0d6f5ff834d4858492/docs/intelligence/handoff/ACCEPTED-CAPABILITY-ROADMAP-2026-10-17.md) | Operator-confirmed intent; capability phases and existing packet backbone, not a new DAG or release grant. |
| H1 review and continuation | [Session README](https://github.com/SaCH-PRO/KEYFLOWOS/blob/9e222e8e3b739fafa539ac0d6f5ff834d4858492/docs/intelligence/sessions/2026-10-17-h1-review-and-continuation/README.md) | Review and publication evidence at the named revisions. Its publication snapshot ends at 20:01:38 UTC; later ACKs and changes belong to the followthrough record. |
| Original P0 safety review | [Session README](https://github.com/SaCH-PRO/KEYFLOWOS/blob/9e222e8e3b739fafa539ac0d6f5ff834d4858492/docs/intelligence/sessions/2026-10-17-p0-safety-review/README.md) | Earlier dated evidence with its own source and proof limits. |
| Continuity orientation | [PR #157 START-HERE](https://github.com/SaCH-PRO/KEYFLOWOS/blob/5d64ecdb46b1a9e8b22a9db5c33e318f99f9c120/docs/intelligence/00-START-HERE.md) | Existing continuity owner; October 7 snapshot, draft and unmerged. |

The roadmap and session records are read from PR #180 at `9e222e8e3b739fafa539ac0d6f5ff834d4858492`. This pointer does not activate PR #177, release work, grant merge authority, refresh the programme map, or turn historical proof into proof of a newer head.

Read the same sources without changing your checkout:

```bash
git fetch origin docs/keyflow-intelligence-foundation docs/kf-convergence-introspection-001 docs/kf-p0-safety-review-20261017
git show 9e222e8e3b739fafa539ac0d6f5ff834d4858492:docs/intelligence/sessions/2026-10-17-worker-review-followthrough/README.md
git show 9e222e8e3b739fafa539ac0d6f5ff834d4858492:docs/intelligence/handoff/ACCEPTED-CAPABILITY-ROADMAP-2026-10-17.md
git show 5d64ecdb46b1a9e8b22a9db5c33e318f99f9c120:docs/intelligence/00-START-HERE.md
git show f406d15c12d56e3758b517161f8e7c2ddc30424a:docs/intelligence/AGENT-CONTINUITY.md
git show f406d15c12d56e3758b517161f8e7c2ddc30424a:docs/intelligence/execution/IMPLEMENTATION-WAVE-EXECUTION-BOARD.md
```

Handoff files record what was known when written. Preserve historical observations, including a snapshot that predates a later ACK. Use the newest verified followthrough record for continuity and live #80 authority for execution.

## Integration ownership and remaining debt

- **PR #173 owns the main entrypoint.** Its existing `CLAUDE.md` change points here. Adding the October 17 route changes this file only within that existing scope. The revised head still needs independent integration review and applicable checks; a pointer is not admission.
- **PR #157 owns START-HERE/CURRENT/HANDOFF/ROLLOVER continuity.** Its [recorded freeze](https://github.com/SaCH-PRO/KEYFLOWOS/pull/157#issuecomment-6025536547) names unresolved branch-role/base-aware convergence and proposes a fresh current-main extraction of PR #107's semantics, not wholesale integration of the stale branch. No explicit lifting of that freeze was found in the inspected PR comments. PR #107 remains a draft proposal, not an admitted policy exception.
- **PR #180 owns the October 17 evidence.** Keep its source/proof provenance and dated records intact. Pointer integration does not require merging its inherited intelligence history into main. Its larger integration disposition remains separate.
- **PR #150 is the existing open-PR convergence lineage.** Carry these dispositions there through its owner rather than create a competing convergence board.
- A wave-board count refresh is a programme-map refresh and requires its existing explicit authority. This route does not edit the wave board or checkpoint.

Measured divergence, with the unchanged **25 commits / 50 files** thresholds:

| Revision and comparison | Unique commits | Differing files | Disposition |
|---|---|---:|---|
| PR #173 `842aa4ac` vs main `98ee0202` | main 0; PR 1 | 5 | Original pointer scope passes the unchanged local divergence check. Recheck the revised head before integration. |
| PR #180 `e8905778` vs main `98ee0202` | main 143; PR 707 | 736 | [Push run 39065514689](https://github.com/SaCH-PRO/KEYFLOWOS/actions/runs/39065514689) fails. This measurement applies to `e8905778`, not automatically to a later evidence head. |
| PR #180 `e8905778` vs foundation `f406d15c` | foundation 0; PR 3 | 73 added files | Even a declared-base comparison exceeds the file threshold; base-awareness alone is insufficient. |
| PR #157 `5d64ecdb` vs current foundation `f406d15c` | foundation 1; PR 30 | 13 endpoint-diff files | The unchanged local check fails the commit threshold. Its older 24-commit/10-file freeze observation is historical. |

Do not treat inherited drift as an application test failure or silently mark it green. Do not mass-retarget historical evidence, weaken thresholds, or infer approval from a green documentation workflow. If full evidence integration is later selected, PR #180's owner can prepare scope-preserving current-main extractions: the 46-file P0 session first, then the 27-file roadmap/H1 session tranche after the first lands. The H1 publication runner imports the P0 replay runner, so the order matters. Those extractions require their own exact revisions, provenance, review and policy checks; none is created by this pointer.

## Keeping this file honest

The original inventory and each newer observation carry their own date and revision. A moving branch tip does not rewrite an old observation. Confirm the linked full SHA and session path when updating this route, re-resolve current main and authority before acting, and state what remains unverified. Never transfer an old head's review, test result or divergence measurement to a new head.

