# Orchestrator state (live checkpoint)

Last written: 2026-11-22 21:15 UTC by the orchestrator (Claude Code). Rewrite in place on every merge, packet return
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
  account's 5-hour usage limit on 2026-11-22 and stopped every session for two hours. From 20:00 UTC hold three: the
  seven-day Fable limit is spent until 2026-11-25 19:00 UTC, so every session runs on Opus (`model:
  claude-opus-5-5` in create_session), which shares the 5-hour limit with the orchestrator.
- Owner decisions are asked in batches with a recommendation first. Record each ruling on issue #80 as D-nnn at once.
- Agent memory layer (D-253, "Both, in parallel"): Track 1 is `docs/development/agent-memory/` and
  `scripts/agent-memory/` (docs and scripts only); Track 2 is a separate research session.
- KEY's memory system is built inside v1 once the owner approves the Track 2 design (D-254).
- Everything needed to continue must be pushed to GitHub (owner, 2026-11-22: "ensure every step of the way our work
  is accessible so that it can be continued by another account or software").

## 2. Rulings not yet on main

D-255 to D-260, seven follow-up packets, the 13 memory packets and three ruling packets (plan now 233) are recorded on `pkt/V1-RULINGS-3E` (main merged in): it
joins wave 3e. D-249 to D-254 are on main (wave 3d, #221).

## 3. Work in flight (what git on main cannot show)

Main is at `2c4e4bf2` (wave 3d, #221, merged 21:12 UTC; #222 merged 20:32). Child sessions are on the account that started them; for another account the
branch is the hand-over: fetch it, read its last commits and the RETURN on #80, and continue. Lesson of 2026-11-22:
three workers stopped on the Fable limit before pushing and their work was lost; the brief now says push after every
commit.

| Work | Branch / PR | State | Next action |
| --- | --- | --- | --- |
| FU-PROPOSAL-REVENUE-SIGHT + Codex fixes | PR #218, `wave/v1-wave-3b-proposal` @ d9284a95 (main 16c37675 merged in) | Both reviews accept; local 775/775 and R0 MET at d9284a95; merges cleanly with 2c4e4bf2 (50 files) | Merge under D-239 when CI is green at d9284a95. The two Codex P1 threads stay open for the owner |
| FU-KEY-GENOME-READS-RESIDUAL (D-235) | `pkt/V1-FU-KEY-GENOME-READS-RESIDUAL` @ bd95bc84 | Suite 775/775 and R0 MET | After #218: merge main, add the test that kills the `budget.left -= rawCost` mutant, re-prove, wave 3e |
| SWP-INV-MONEY-TOTALS (D-249..D-252, D-255, D-256) | `pkt/V1-SWP-INV-MONEY-TOTALS` @ 2b7f96de | ACCEPTED (both lenses); server 767/767 + R0 MET at 001e344d, web-tests-only since | Wave 3e |
| W11-RUNWAY-LEDGER-CASH | `pkt/V1-W11-RUNWAY-LEDGER-CASH` @ e3c4ecc0 | Accepted, repairs proven | Wave 3e with W11-CASH-READERS-LEDGER (owner question 3 default) |
| W11-CASH-READERS-LEDGER | `pkt/V1-W11-CASH-READERS-LEDGER` @ 117171a3 | ACCEPTED; 768/768 and R0 MET | Wave 3e |
| FU-CONTRACT-FETCH-OUTBOUND-GUARD (P0) | `pkt/V1-FU-CONTRACT-FETCH-OUTBOUND-GUARD` @ a558bf9e | ACCEPTED; 770/770 and R0 MET (includes ::ffff:0:0:0/96 in outbound-address.ts, authorized) | Wave 3e |
| NAV-A1 (critical path) | `pkt/V1-NAV-A1`, session_017o9EBfkZtn5ec3BPuoARuf (restarted 19:59) | Building | Acceptance review on return |
| SWP-FIN-LEDGER | `pkt/V1-SWP-FIN-LEDGER` @ 8fbcfba5, session_017o9EBhDURhxSoPYYpU8c4D | Both lenses accept with minors; worker bounding the page>1 seed (skip when out of range, SQL sums) | Check the delta; wave 3e |
| SWP-COA-UNIQUE-CODE | `pkt/V1-SWP-COA-UNIQUE-CODE` @ bff63c11, session_017o9EBe9P31PXeeaZhC6Bbo | Both lenses accept with minors; worker adding explicit tx limits + P2028 -> 503 and the seeder lock comment | Check the delta; wave 3e |
| Memory R&D (D-253 Track 2, D-254) | `docs/kf-memory-rnd-001`, session_017o9EBeh5mV5XyHFgneVdkX (restarted 20:44) | Researching; pushes after each deliverable | Review the report; owner approves the design before product packets |

Next to start, in order, when a slot frees: FU-SEND-REMINDER-SERVER-GATE
(P1 security), FU-KEY-INVOICE-EMAIL-PAY-LINK, W11-RUNWAY-BURN-CURRENCY, then the ready list in `V1-STATUS.md`
(critical path first). `V1-STATUS.md` cannot see this table: check a packet is not already in flight.

## 4. Open questions waiting for the owner (ask together)

Format: `docs/development/agent-memory/OWNER-QUESTION-FORMAT.md`. Safe defaults apply until ruled.

1. FIN8 command-item mirrors show cash, burn and runway to operations readers; D-100 reads as no money signals without
   revenue read. Proposed packet: strip figures from the mirrors.
2. Runway rollout order. Default applied: W11-RUNWAY-LEDGER-CASH merges with W11-CASH-READERS-LEDGER and
   W11-RUNWAY-BURN-CURRENCY.
3. Other status-based money figures on the Sales screen (one small follow-up packet proposed).
4. `adjustInventory` and the Google Sheets stock apply bypass the D-139 reserved floor and lock (pre-existing; not
   cross-tenant). Proposed packet FU-STOCK-ADJUST-AND-SHEETS-FLOOR (P1); the Excel import movement should name its
   uploader (default: yes).
5. Should the agent-memory tests and `status.mjs --check` run in CI? (Default: not until asked.)
6. A cash shortfall on the command item ranks like zero cash (runway packet deviation). Should a shortfall rank
   highest? (Default: as built.)
7. Should the server's own storage host (`S3_PUBLIC_URL`) be exempt from the document-fetch guard when it is private
    (self-hosted MinIO)? (Default: keep refusing.)
8. Should a filtered general ledger's running balance start from the account's true opening balance instead of zero?
    (Default: as built, column labelled.)
9. Should `GET chart-of-accounts` (membership-only; names and codes, seeds defaults on read) require a module scope?
    (Default: unchanged.)
10. The memory design's own questions Q1-Q14 (`docs/intelligence/research/memory/OPEN-QUESTIONS-FOR-OWNER.md`), on their
    recommended defaults until ruled (D-257).

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
- The account's usage limits are shared by all sessions: hold three child sessions at most while on Opus, and keep
  reviews to the diff.
- The v1 packet list with status, for the owner: https://claude.ai/artifact/3jRzGxzXvPXtVZeRoJuraK
