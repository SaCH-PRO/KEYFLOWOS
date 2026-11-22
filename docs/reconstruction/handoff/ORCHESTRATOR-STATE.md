# Orchestrator state (live checkpoint)

Last written: 2026-11-22 16:05 UTC, by the orchestrator session (Claude Code, session_017o9EBg3mFuN9ksfRWmQSBE).
Purpose: everything a fresh session needs to carry on the v1 programme without the conversation that produced it.
Rule: rewrite this file (do not append a diary) whenever a PR merges, a packet returns, or the owner rules.

## 1. Standing instructions from the owner

- Finish v1 (plan of record: `docs/reconstruction/V1-PLAN-RECUT.json`, 210 packets). Keep going until it is done.
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

## 2. Rulings given on 2026-11-22 (all on #80; D-240..D-248 also in BUILD-MAP via PR #220)

D-239 wave merge authority. D-240 CI-repair merge authority. D-241 reordering and parallel sessions.
D-242, D-243 BIZ-SETTINGS-WEB currency select and the two Release 0 evidence edits. D-244, D-245 booking page pays via
the invoice link; packet FU-BOOKING-PAGE-PAYMENT-METHOD. D-246 packet FU-CONTRACT-FETCH-OUTBOUND-GUARD (P0).
D-247 withdrawn. D-248 packet FU-KEY-INVOICE-EMAIL-PAY-LINK. D-249 PAID invoice with no payment row counts at its
total; packet FU-MARKETPLACE-PAID-PAYMENT-ROW. D-250 partly-rowed PAID invoice counts its full total. D-251 fix the
A/R aging now, inside SWP-INV-MONEY-TOTALS. D-252 headline "X to collect".
NOT YET IN THE PLAN FILES: D-249..D-252 and FU-MARKETPLACE-PAID-PAYMENT-ROW (write them in the next rulings commit).

## 3. Where each piece of work stands

On main: 58 packets (main at 5c17e7b4 when this was written).

| Work | Branch / PR | State | Next action |
| --- | --- | --- | --- |
| Wave 3c: BIZ-SETTINGS-WEB, W11-DISPATCH-REFUSAL-FINAL, SWP-BOOKING-PAYMENT-GATE, rulings D-240..D-248 | PR #220, `wave/v1-wave-3c` @ 1fe5f550 | Local suite 768/768, R0 MET, web checks clean; Codex no findings; CI green except Windows worker proof (running) | Merge under D-239 when that check is green |
| FU-PROPOSAL-REVENUE-SIGHT + Codex fixes | PR #218, `wave/v1-wave-3b-proposal` @ 08eaf7a3 | Local suite 773/773, R0 MET; final reviews: security ACCEPT, correctness ACCEPT WITH MINORS, fit to merge; CI running | Merge under D-239 when CI is green. Two Codex P1 threads stay open for the owner |
| FU-KEY-GENOME-READS-RESIDUAL (D-235) | `pkt/V1-FU-KEY-GENOME-READS-RESIDUAL` (local in `/home/user/kf-wt-prop`, head bd95bc84, NOT pushed) | Suite 775/775 and R0 MET at bd95bc84; based on an old #218 commit | After #218 merges: merge main in, re-run suite and R0, confirm reviews, compact into wave 3d. Add the missing test: two fields with worded cuid runs must be financial (kills the `budget.left -= rawCost` mutant) |
| SWP-INV-MONEY-TOTALS | `pkt/V1-SWP-INV-MONEY-TOTALS` @ c7531a19, child session_017o9EBhDZ91nbpSx6WwePLx | Acceptance: ACCEPT WITH MINORS, conditional on D-249..D-252 | Worker is applying D-250 (repair) and D-251 (aging); then acceptance of the delta |
| W11-RUNWAY-LEDGER-CASH | `pkt/V1-W11-RUNWAY-LEDGER-CASH` @ 55c99772, child session_017o9EBdzUFY5Daty71h48SF | Acceptance: ACCEPT WITH MINORS; repairs C1 (negative cash) and C2 (failed detector not superseded) requested | Wait for return. Default: merge in the same wave as W11-RUNWAY-BURN-CURRENCY (not started) |
| W11-INV-SET-MOVEMENT | child session_017o9EBem9bU9xZUGR8tpmQo | Building | Acceptance review on return |
| SWP-FIN-LEDGER | child session_017o9EBfDmVepjoB3FBR8QoJ | Building | Acceptance review on return |
| SWP-COA-UNIQUE-CODE | child session_017o9EBhYG2it1hhkbyTt7pS | Building | Acceptance review on return |

Next to start when #220 is on main: NAV-A1 (next on the critical path), FU-CONTRACT-FETCH-OUTBOUND-GUARD (P0),
FU-KEY-INVOICE-EMAIL-PAY-LINK, W11-RUNWAY-BURN-CURRENCY, FU-BOOKING-PAGE-PAYMENT-METHOD (needs
W11-STOREFRONT-PAYPAL-LIST), then by "unblocks most" from the plan. Recommended early: FU-PROPOSAL-MONEY-TAG (the
structural fix that ends the free-text money classifier rounds).

## 4. Open questions waiting for the owner (ask together)

1. Finance doors open to any member (pre-existing): POST intelligence/scan, actions/:id/resolve and /dismiss need only
   membership. Proposed P0 packet: revenue write for resolve/dismiss, revenue read for scan.
2. FIN8 command-item mirrors show cash, burn and runway to operations readers; D-100 reads as no money signals without
   revenue read. Proposed packet: strip figures from the mirrors.
3. Runway rollout order (default applied: merge with W11-RUNWAY-BURN-CURRENCY).
4. Other status-based money figures on the Sales screen (one small follow-up packet proposed).

## 5. How to work here (learned the hard way)

- Node 22.23.4 at `/opt/node-22.23.4/bin`. Load env for DB tests: `set -a; . /home/user/KEYFLOWOS/.env; set +a`.
- One local Postgres and Redis: never run two DB suites at once, never edit a worktree while its suite runs. After a
  worker restart, `service postgresql start; service redis-server start`. An ECONNREFUSED run is not a result.
- Proof at a head: `rm -f dist/.tsbuildinfo; pnpm build; pnpm vitest run; pnpm proof:release0 -- --skip-build` in
  `apps/server`. Web: set NEXT_PUBLIC_API_BASE_URL and NEXT_PUBLIC_SITE_URL, `npx next typegen`, `npx tsc --noEmit`,
  `pnpm vitest run`, `pnpm lint --max-warnings 26`. tsc needs `NODE_OPTIONS=--max-old-space-size=6144`.
- Branch-divergence gate: a PR may differ from main by at most 25 commits and 50 files. Compact each packet into one
  tests-only RED commit and one fix commit (`scratchpad/compact.sh` shows how); keep full history on the pkt/* branch.
  Release 0 evidence edits ride the fix commit. `.agent-control/*` stays at main's copy in wave PRs.
- Release 0 manifests bind cases exactly: new tests go in new spec files. Never edit a Release 0 evidence file without
  an owner ruling.
- Plan premises can be false (three were today): check what a packet says about the code before building on it, and
  trace callers before claiming who is affected.
- A reviewer's acceptance is by reading unless it says it ran something; re-run suite and R0 yourself at the wave head.
- Worktrees: `/home/user/kf-wt-3b` (wave 3c), `kf-wt-3b2` (#218), `kf-wt-prop` (D-235), `kf-wt-rul` (rulings),
  `kf-wt-disp`, `kf-wt-book`, `kf-wt-biz`, `kf-wt-money`, `kf-wt-runway` (read-only review checkouts).
- The v1 packet list with status, for the owner: https://claude.ai/artifact/3jRzGxzXvPXtVZeRoJuraK
