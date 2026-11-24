# Workflow improvements: decisions, experiments and research (live log)

Owner ruling **D-274** (2026-11-24, issue #80): "Just do all you can to speed up. Record decisions that enhance our
operations. As we are improving the workflow we should be doing R&D to implement the best strategies." Read with the
owner's earlier "speed up without any compromise": every speedup keeps tests first, two independent reviews, browser
proof, Release 0 at the wave head, CI green at the exact head and the merge order. A change to a gate, to merge
authority or to repository ownership still needs the owner's explicit ruling.

This file is the one place that records how we work faster. Add to it, keep entries short, cite evidence. Every lane
(Claude, Antigravity, any other account or tool) reads it at the start of a session and follows the ADOPTED rules.

## 1. Where the time goes (measured 2026-11-24)

| Stage | Time | Parallel? | Notes |
|---|---|---|---|
| Build one packet (RED, fix, two reviews, browser proof) | 1.5 to 3 h | yes, per lane | reviews run while the browser proof runs |
| Review bounce (a REJECT round) | about 1 h | no | 3 plan premises were false on 2026-11-24 |
| CI on a wave PR | 60 to 70 min | **no** | Windows worker proof about 60 min, Run Tests about 28 min |
| Merge queue (one PR at a time, D-272) | 1 CI cycle per PR, plus a re-run after merging main in | **no** | the bottleneck |
| Full server suite plus Release 0 at a wave head | about 30 min | once per wave | |

GitHub's merge queue is not available: the repository is owned by a personal account (checked 2026-11-24), and the
queue needs an organization-owned repository.

## 2. Adopted (any lane, from now)

| # | Rule | Why | Since |
|---|---|---|---|
| A1 | **Fill waves.** A wave PR carries as many returned packets as fit the 25-commit / 50-file gate, not two or three. | One CI cycle per wave, whatever its size. | D-274 |
| A2 | **Open the wave PR as soon as its packets are compacted,** even while it waits its turn: its CI runs early on main, so failures surface hours before its merge slot. When its turn comes, merge main in and re-run (CI at the exact head is still the gate). | Overlaps CI with the waves ahead. | D-274 |
| A3 | **Pre-flight the plan.** Before a packet is claimed, a read-only check of its premises against the code: files and lines it names, redirect targets, sibling call sites of the same bug, guard specs it will trip, Release 0 binding, overlap with other ready packets. Corrections go to the plan on a docs branch (as SWP-KEY-SHELL-SMOKE was corrected, c8afd062). | A REJECT round costs about 1 h; three on 2026-11-24 came from false premises. | D-274 |
| A4 | **Fix a shared bug at its root, not at one call site.** When a review finds the same defect elsewhere, widen the fix (declared departure) instead of filing it for later, when the root is one function. | SWP-KEY-CHAT-WEB: the loop lived in loadSessions, not in four callers. | D-274 |
| A5 | **Live runs: one at a time on the build tree, checked by PID.** Check for a running live script by the PID it records, never by a process-name grep; the head guard (`HEAD MOVED: these runs do not count`) stays, and a run it flags is discarded. | A grep missed a running chain on 2026-11-24; the guard caught it. | D-274 |
| A6 | **Pass full shas to scripts.** A head check compares full shas; a short or mistyped sha makes a run prove nothing. | Two wasted runs on 2026-11-24. | D-274 |
| A7 | **A browser step must be able to fail for its bug.** Before trusting a sweep, show it RED at the base for the reason it names; a step that cannot fail there is labelled a guard and the real repro is named. | A drawer step could not see BUG-043 at the base. | D-274 |

## 3. Proposed, waiting for the owner

| # | Proposal | Gain | What it needs |
|---|---|---|---|
| P1 | Move the repository into a free GitHub organization, then turn on the merge queue (with FU-CI-MERGE-GROUP: `merge_group` triggers, the agent-control gate reporting its PR result on a queue entry). | Waves test in parallel on the combined result; about 3 h of serial CI for three waves becomes about 1 h. | Owner: create the org and transfer (integrations to re-check: Vercel, the Claude and Codex GitHub apps, GitGuardian, Supabase preview); then a ruling that "merge" under D-239/D-272 means "add to the queue". |
| P2 | Run the Windows worker proof only when the paths it exercises change, with a required aggregate job so a needed run can never be skipped. | About 60 min off every web-only or docs-only wave. | A gate ruling; the path list from R&D-1 below. |

## 4. Research in progress

| # | Question | Owner | State |
|---|---|---|---|
| R&D-1 | Cut CI wall time with no check dropped: per-step timings of the Windows worker proof and Run Tests; caching (pnpm store, Turbo, Prisma), sharding with an aggregate job, superseded-run cancellation, slow jobs first; pipelining without a merge queue. | claude lane | running |
| R&D-2 | Pre-flight audit of the Claude lane's next rows (P13, P17, P18 and the next ready web launch packets). | claude lane | running |

Results land here as findings with evidence, then as ADOPTED rules or owner proposals.

## 5. Experiments log

| Date | Change | Result |
|---|---|---|
| 2026-11-24 | Two lanes, atomic claims, one owner per board row, a joint plan ACKed by both (#80 7130344208, 7132212972). | No duplicated work, no clashes. Merges, not building, became the limit. |
