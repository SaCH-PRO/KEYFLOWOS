# Orchestrator state (live checkpoint)

Last written: 2026-11-22 18:55 UTC by the orchestrator (Claude Code). Rewrite in place on every merge, packet return
or owner ruling; never append. What you remove stays in git history and on issue #80.

Purpose: everything a fresh session, on any account or tool, needs to carry on the v1 programme without the
conversation that produced it. Read `docs/development/agent-memory/README.md` first.

**This file holds only what cannot be generated.**

| Fact | Where it lives |
|---|---|
| Which packets are done, counts, critical path, what is ready to start | `V1-STATUS.md` in this folder (generated: `node scripts/agent-memory/status.mjs`) |
| One packet's scope, rulings, write set, dependencies | `node scripts/agent-memory/bundle.mjs <PACKET-ID>` |
| Rulings | `docs/reconstruction/BUILD-MAP-001.md` (rulings given after the last rulings commit: section 2 below) |
| How to brief a worker, review a return, build and merge a wave, ask the owner | `docs/development/agent-memory/` |
| What happened, in order, with evidence | GitHub issue #80 (control room) and git history |

## 1. Standing instructions from the owner

- Finish v1 (plan of record: `docs/reconstruction/V1-PLAN-RECUT.json`). Keep going until it is done.
- Tests first. Two independent reviews per packet (security-tenancy, correctness-regression), no cap on rounds: every
  real finding is fixed in the pass that finds it (the owner declined a round cap).
- Release 0 stays MET. No production deploy, no staging change, no real provider traffic, no test against a
  production database, no weakened test or gate, no fabricated evidence, no secrets in chat or browser code.
- Merge authority (D-239, D-240): the orchestrator may merge a v1 wave PR, and a small CI repair PR that unblocks a
  wave, when CI is green at the exact head, both independent reviews accept, and head, mergeability and scope are
  re-verified; merge commit with expectedHeadSha pinned.
- Parallel sessions (D-241): independent packets are built in child sessions; the orchestrator re-verifies each return
  with its own acceptance review before it enters a wave PR. Hold at most four at once: nine at once hit the
  account's 5-hour usage limit on 2026-11-22 and stopped every session for two hours.
- Owner decisions are asked in batches with a recommendation first. Record each ruling on issue #80 as D-nnn at once.
- Agent memory layer (D-253, "Both, in parallel"): Track 1 is `docs/development/agent-memory/` and
  `scripts/agent-memory/` (docs and scripts only); Track 2 is a separate research session.
- KEY's memory system is built inside v1 once the owner approves the Track 2 design (D-254).
- Everything needed to continue must be pushed to GitHub (owner, 2026-11-22: "ensure every step of the way our work
  is accessible so that it can be continued by another account or software").

## 2. Rulings not yet on main

D-249 to D-254 are recorded in `BUILD-MAP-001.md` on branch `wave/v1-wave-3d` (this wave). Remove this line when it
merges. No other ruling is pending a record.

## 3. Work in flight (what git on main cannot show)

Main is at `79ed2a57` (wave 3c, #220). Child sessions are on the account that started them; for another account the
branch is the hand-over: fetch it, read its last commits and the RETURN on #80, and continue.

| Work | Branch / PR | State | Next action |
| --- | --- | --- | --- |
| Wave 3d: agent memory layer, rulings D-249..D-254, CLAUDE.md/AGENTS.md pointers, W11-INV-SET-MOVEMENT | `wave/v1-wave-3d` (PR to open) | Built; local proof running | Prove (server suite, R0, memory specs), open the PR, merge under D-239 when CI is green |
| FU-PROPOSAL-REVENUE-SIGHT + Codex fixes | PR #218, `wave/v1-wave-3b-proposal` @ 7e658329 | Final reviews: security ACCEPT, correctness ACCEPT WITH MINORS, fit to merge. Main merged in; local suite 775/775 and R0 MET at 7e658329; CI running | Merge under D-239 when CI is green. The two Codex P1 threads stay open for the owner |
| FU-KEY-GENOME-READS-RESIDUAL (D-235) | `pkt/V1-FU-KEY-GENOME-READS-RESIDUAL` @ bd95bc84 (pushed) | Suite 775/775 and R0 MET at bd95bc84 | After #218 merges: merge main, add the test "two fields with worded cuid runs are financial" (kills the `budget.left -= rawCost` mutant), re-prove, compact into the next wave |
| W11-RUNWAY-LEDGER-CASH | `pkt/V1-W11-RUNWAY-LEDGER-CASH` @ e3c4ecc0 | Accepted with minors; repairs C1 and C2 done, reviewed and proven (766/766, R0 MET) | Hold: merges together with W11-CASH-READERS-LEDGER and W11-RUNWAY-BURN-CURRENCY (rollout default, owner question 3) |
| W11-CASH-READERS-LEDGER | `pkt/V1-W11-CASH-READERS-LEDGER`, child session started 18:44 on the runway branch | Building | Acceptance review on return; then W11-RUNWAY-BURN-CURRENCY |
| SWP-INV-MONEY-TOTALS | `pkt/V1-SWP-INV-MONEY-TOTALS` @ 5e23fb09, child session resumed 18:44 | Applying D-250 and D-251 | Acceptance review of the delta on return |
| NAV-A1 (critical path) | `pkt/V1-NAV-A1` (not pushed yet), child session resumed 18:42 | Building | Acceptance review on return |
| FU-CONTRACT-FETCH-OUTBOUND-GUARD (P0) | `pkt/V1-FU-CONTRACT-FETCH-OUTBOUND-GUARD` (not pushed yet), child session resumed 18:42 | Building | Acceptance review on return |
| SWP-FIN-LEDGER | `pkt/V1-SWP-FIN-LEDGER` @ 25688bd4 | Stopped mid-work by the usage limit | Resume when a slot frees |
| SWP-COA-UNIQUE-CODE | `pkt/V1-SWP-COA-UNIQUE-CODE` @ 339a5df7 | Stopped mid-work by the usage limit | Resume when a slot frees |
| Memory R&D (D-253 Track 2; D-254 adds the packet proposal) | `docs/kf-memory-rnd-001` (nothing pushed yet) | Stopped by the usage limit before pushing | Resume when a slot frees; brief is on #80 (D-253, D-254) |

Next to start, in order, when a slot frees: SWP-FIN-LEDGER and SWP-COA-UNIQUE-CODE (resume), memory R&D (resume),
FU-KEY-INVOICE-EMAIL-PAY-LINK, then the ready list in `V1-STATUS.md` (critical path first). `V1-STATUS.md` cannot see
this table: check a packet is not already in flight before starting it.

## 4. Open questions waiting for the owner (ask together)

Format: `docs/development/agent-memory/OWNER-QUESTION-FORMAT.md`. Safe defaults apply until ruled.

1. Finance doors open to any member (pre-existing): POST intelligence/scan, actions/:id/resolve and /dismiss need only
   membership. Proposed P0 packet: revenue write for resolve/dismiss, revenue read for scan.
2. FIN8 command-item mirrors show cash, burn and runway to operations readers; D-100 reads as no money signals without
   revenue read. Proposed packet: strip figures from the mirrors.
3. Runway rollout order. Default applied: W11-RUNWAY-LEDGER-CASH merges with W11-CASH-READERS-LEDGER and
   W11-RUNWAY-BURN-CURRENCY.
4. Other status-based money figures on the Sales screen (one small follow-up packet proposed).
5. `adjustInventory` and the Google Sheets stock apply bypass the D-139 reserved floor and lock (pre-existing; not
   cross-tenant). Proposed packet FU-STOCK-ADJUST-AND-SHEETS-FLOOR (P1); the Excel import movement should name its
   uploader (default: yes).
6. Should the agent-memory tests and `status.mjs --check` run in CI? (Default: not until asked.)
7. A cash shortfall on the command item ranks like zero cash (runway packet deviation). Should a shortfall rank
   highest? (Default: as built.)

## 5. How to work here (learned the hard way)

The procedures themselves are in `docs/development/agent-memory/WAVE-RUNBOOK.md`. Kept here: what is specific to
this machine and this week.

- Node 22.23.4 at `/opt/node-22.23.4/bin`. Load env for DB tests: `set -a; . /home/user/KEYFLOWOS/.env; set +a`.
- One local Postgres and Redis: never run two DB suites at once, never edit a worktree while its suite runs. After a
  worker restart, `service postgresql start; service redis-server start`. An ECONNREFUSED run is not a result.
- Proof at a head: `rm -f dist/.tsbuildinfo; pnpm build; pnpm vitest run; pnpm proof:release0 -- --skip-build` in
  `apps/server`. Web: set NEXT_PUBLIC_API_BASE_URL and NEXT_PUBLIC_SITE_URL, `npx next typegen`, `npx tsc --noEmit`,
  `pnpm vitest run`, `pnpm lint --max-warnings 26`. tsc needs `NODE_OPTIONS=--max-old-space-size=6144`.
- Branch-divergence gate: a PR may differ from main by at most 25 commits and 50 files. Compact each packet into one
  tests-only RED commit and one fix commit (`scratchpad/compact.sh` shows how; the steps are now in the runbook);
  keep full history on the pkt/* branch. Release 0 evidence edits ride the fix commit. `.agent-control/*` stays at
  main's copy in wave PRs.
- Release 0 manifests bind cases exactly: new tests go in new spec files. Never edit a Release 0 evidence file without
  an owner ruling.
- Plan premises can be false (three were today): check what a packet says about the code before building on it, and
  trace callers before claiming who is affected.
- A reviewer's acceptance is by reading unless it says it ran something; re-run suite and R0 yourself at the wave head.
- Worktrees are disposable: every branch named in section 3 is pushed to origin. A fresh session recreates what it
  needs with `git worktree add <dir> origin/<branch>`. Nothing in this file depends on one container.
- The account's usage limit is shared by all sessions: hold four child sessions at most, and keep reviews to the diff.
- The v1 packet list with status, for the owner: https://claude.ai/artifact/3jRzGxzXvPXtVZeRoJuraK
