# Orchestrator state (live checkpoint)

Last written: 2026-11-22 16:05 UTC, by the orchestrator session (Claude Code, session_017o9EBg3mFuN9ksfRWmQSBE).
Restructured the same day by the agent memory layer packet from the seed on `pkt/V1-ORCH-STATE` at `a5817fc8`.

What that packet changed, so the orchestrator can check it: the count of packets on main moved to the generated
`V1-STATUS.md`; facts that git on main proves were brought up to main `79ed2a57` (wave 3c merged as #220, rulings
D-240 to D-248 on main); D-253, D-254, the memory-layer row and the note on worktrees were added; everything else
is the seed's wording. **Rows marked (seed, 16:05 UTC) were not re-checked and are older than main: the
orchestrator must rewrite sections 2 to 4 from its own knowledge before anyone acts on them.**

Purpose: everything a fresh session needs to carry on the v1 programme without the conversation that produced it.

**This file holds only what cannot be generated.** Do not write packet counts, done lists or the ready list here:

| Fact | Where it lives |
|---|---|
| Which packets are done, counts, critical path, what is ready to start | `V1-STATUS.md` in this folder (generated: `node scripts/agent-memory/status.mjs`) |
| One packet's scope, rulings, write set, dependencies | `node scripts/agent-memory/bundle.mjs <PACKET-ID>` |
| Rulings on main | `docs/reconstruction/BUILD-MAP-001.md` |
| How to brief a worker, review a return, build and merge a wave, ask the owner | `docs/development/agent-memory/` |

Rule: rewrite this file (do not append a diary) whenever a PR merges, a packet returns, or the owner rules. What
you remove is not lost: it stays in git history and on issue #80. The full rule is in
`docs/development/agent-memory/README.md` under Consolidation.

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
  with its own acceptance review before it enters a wave PR. Hold four to six at once.
- Owner decisions are asked in batches with a recommendation first. Record each ruling on issue #80 as D-nnn at once.
- Agent memory layer (D-253, "Both, in parallel"): Track 1 is `docs/development/agent-memory/` and
  `scripts/agent-memory/` (docs and scripts only); Track 2 is a separate research session.

## 2. Rulings not yet in the plan files on main

All are on issue #80. Remove a ruling from this section when the commit that records it in `BUILD-MAP-001.md` is
on main. D-239 to D-248 are on main (D-240 to D-248 arrived with wave 3c, #220; D-247 is recorded as withdrawn).

NOT YET IN ANY PLAN FILE (write them in the next rulings commit): D-249 PAID invoice with no payment row counts at
its total; packet FU-MARKETPLACE-PAID-PAYMENT-ROW. D-250 partly-rowed PAID invoice counts its full total. D-251 fix
the A/R aging now, inside SWP-INV-MONEY-TOTALS. D-252 headline "X to collect". D-253 agent memory layer and
research track in parallel. D-254: on #80 (comment 7081997117, seen by this packet's reviewer); its content is not
summarized here because this packet did not read it: the orchestrator fills it in.

## 3. Work in flight (what git on main cannot show)

Main is at 79ed2a57 (wave 3c merged as #220: BIZ-SETTINGS-WEB, W11-DISPATCH-REFUSAL-FINAL,
SWP-BOOKING-PAYMENT-GATE and rulings D-240 to D-248). The plan on main has 209 packets (see `V1-STATUS.md`); the
210th, FU-MARKETPLACE-PAID-PAYMENT-ROW (D-249), is in no plan file yet.

Every row below is (seed, 16:05 UTC) unless it says otherwise.

| Work | Branch / PR | State | Next action |
| --- | --- | --- | --- |
| FU-PROPOSAL-REVENUE-SIGHT + Codex fixes | PR #218, `wave/v1-wave-3b-proposal` @ 08eaf7a3 | Local suite 773/773, R0 MET; final reviews: security ACCEPT, correctness ACCEPT WITH MINORS, fit to merge; CI running | Merge under D-239 when CI is green. Two Codex P1 threads stay open for the owner |
| FU-KEY-GENOME-READS-RESIDUAL (D-235) | `pkt/V1-FU-KEY-GENOME-READS-RESIDUAL` (local in `/home/user/kf-wt-prop`, head bd95bc84, NOT pushed) | Suite 775/775 and R0 MET at bd95bc84; based on an old #218 commit | After #218 merges: merge main in, re-run suite and R0, confirm reviews, compact into wave 3d. Add the missing test: two fields with worded cuid runs must be financial (kills the `budget.left -= rawCost` mutant) |
| SWP-INV-MONEY-TOTALS | `pkt/V1-SWP-INV-MONEY-TOTALS` @ c7531a19, child session_017o9EBhDZ91nbpSx6WwePLx | Acceptance: ACCEPT WITH MINORS, conditional on D-249..D-252 | Worker is applying D-250 (repair) and D-251 (aging); then acceptance of the delta |
| W11-RUNWAY-LEDGER-CASH | `pkt/V1-W11-RUNWAY-LEDGER-CASH` @ 55c99772, child session_017o9EBdzUFY5Daty71h48SF | Acceptance: ACCEPT WITH MINORS; repairs C1 (negative cash) and C2 (failed detector not superseded) requested | Wait for return. Default: merge in the same wave as W11-RUNWAY-BURN-CURRENCY (not started) |
| W11-INV-SET-MOVEMENT | child session_017o9EBem9bU9xZUGR8tpmQo | Building | Acceptance review on return |
| SWP-FIN-LEDGER | child session_017o9EBfDmVepjoB3FBR8QoJ | Building | Acceptance review on return |
| SWP-COA-UNIQUE-CODE | child session_017o9EBhYG2it1hhkbyTt7pS | Building | Acceptance review on return |
| NAV-A1, FU-CONTRACT-FETCH-OUTBOUND-GUARD | not known to this packet | Reported as already started in the PROGRESS comment on #80 (7081920271, seen by this packet's reviewer, not by the orchestrator's seed); no `pkt/V1-*` branch for either was on origin when this was written | Orchestrator: confirm and replace this row with one row each (child session, branch, state) |
| Agent memory layer (D-253, Track 1) | `pkt/V1-AGENT-MEMORY-LAYER` (pushed; this file is on it) | Returned to the orchestrator (written by that packet) | Review; take the proposed CLAUDE.md and AGENTS.md edits to the owner |

The seed's "next to start when #220 is on main" list, now that it is: NAV-A1 (next on the critical path) and
FU-CONTRACT-FETCH-OUTBOUND-GUARD (P0) (see the row above: probably started), FU-KEY-INVOICE-EMAIL-PAY-LINK,
W11-RUNWAY-BURN-CURRENCY, FU-BOOKING-PAGE-PAYMENT-METHOD (needs W11-STOREFRONT-PAYPAL-LIST), then by "unblocks
most" (the ready list in `V1-STATUS.md`). Recommended early: FU-PROPOSAL-MONEY-TAG (the structural fix that ends
the free-text money classifier rounds).

`V1-STATUS.md` lists a packet as ready when it is todo on main with its dependencies done. It cannot see this
table: before starting a packet from the ready list, check that it is not already in flight here.

## 4. Open questions waiting for the owner (ask together)

Format: `docs/development/agent-memory/OWNER-QUESTION-FORMAT.md`.

1. Finance doors open to any member (pre-existing): POST intelligence/scan, actions/:id/resolve and /dismiss need only
   membership. Proposed P0 packet: revenue write for resolve/dismiss, revenue read for scan.
2. FIN8 command-item mirrors show cash, burn and runway to operations readers; D-100 reads as no money signals without
   revenue read. Proposed packet: strip figures from the mirrors.
3. Runway rollout order (default applied: merge with W11-RUNWAY-BURN-CURRENCY).
4. Other status-based money figures on the Sales screen (one small follow-up packet proposed).

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
- Worktrees (seed): `/home/user/kf-wt-3b` (wave 3c, now merged), `kf-wt-3b2` (#218), `kf-wt-prop` (D-235), `kf-wt-rul` (rulings),
  `kf-wt-disp`, `kf-wt-book`, `kf-wt-biz`, `kf-wt-money`, `kf-wt-runway` (read-only review checkouts). These exist
  only in the orchestrator's container: a fresh session must recreate what it needs from the pushed branches, and
  anything marked NOT pushed in section 3 is lost if that container is.
- The v1 packet list with status, for the owner: https://claude.ai/artifact/3jRzGxzXvPXtVZeRoJuraK
