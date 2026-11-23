# Orchestrator state (live checkpoint)

Last written: 2026-11-23 01:50 UTC by the orchestrator (Claude Code). Rewrite in place on every merge, packet return
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

D-255 to D-260, seven follow-up packets, the 13 memory packets and three ruling packets (plan now 346) are recorded on `pkt/V1-RULINGS-3E` (main merged in): it
joins wave 3e. D-249 to D-254 are on main (wave 3d, #221).

## 3. Work in flight (what git on main cannot show)

Main is at `b94477a7` (wave 3e, #223, merged 2026-11-23 01:10 UTC). 70 packets done on main; plan 346 (this branch).
Workers run on Opus (Fable spent until 2026-11-25 19:00 UTC); hold four. A second Claude account works the RR-* P2/P3
lane (`docs/development/agent-memory/SECOND-ACCOUNT-SETUP.md`); it claims by pushing `pkt/V1-<ID>` and posts RETURN on
#80; scan #80 every ~2 h and give each RETURN the two acceptance reviews. Its first claim: RR-SCRIPT-SPECS-IN-CI.

| Work | Branch / head | State | Next action |
| --- | --- | --- | --- |
| Wave 3f: NAV-A1, FU-SITE-ANALYTICS-REVENUE-SCOPE, AGENT-MEMORY-FIXES, rulings | `wave/v1-wave-3f` @ 07e6f3eb | Server 784/784, R0 MET, web tsc+lint clean; 1 web unit fails: NAV-A1 NMS-18 line-number citations went stale after wave 3e | NAV-A1 worker making NMS-18 cite by route/identifier on its branch; then re-compact NAV-A1 into 3f, re-prove, open PR, merge under D-239 |
| Wave 3g (after 3f): MEM-TEMPORAL-SCOPE @ 69d163b2, FU-FINANCE-INTEL-DOORS @ 122b68bc, MEM-SALIENCE-SIGHT @ b142c8f0, FU-TEMPORAL-FLOW-INBOX-SCOPE @ 34c03a09, RR-UNTRUSTED-CONTENT-FENCE @ 629c7db9, RR-STREAM-ERROR-NO-EFFECTS @ 825cf137 | `pkt/V1-*` | All ACCEPTED (both lenses) | Build after 3f merges; ~38 files |
| NAV-A1 | `pkt/V1-NAV-A1`, session_017o9EBfkZtn5ec3BPuoARuf | Citation fix | Swap into 3f |
| MEM-DOC-EXTRACTION-SIGHT (P0) | `pkt/V1-MEM-DOC-EXTRACTION-SIGHT` @ 8b79d98c, session_017o9EBex4SFxVszCoCSY2Uk | Correctness REJECT: flow semantic section + agent/memory/search serve extraction copies; plus profile-interview cache keyed by business only (cross-member leak) and its "Monthly revenue" line | Worker: exclude copies by default, key cache by business+user, withhold revenue line; delta review |
| MEM-SEMANTIC-SIGHT (P0) | `pkt/V1-MEM-SEMANTIC-SIGHT` (on MEM-DOC branch), session_017o9EBfbTxe462hkGyBUyNV | Building | Acceptance review on return |
| FU-KEY-GENOME-READS-RESIDUAL | session_017o9EBgiXttRc2ENe8Q9pK9 | Merge main + one test | Acceptance review |
| FU-VITEST-DECORATOR-METADATA (P1) | session_017o9EBevZsyK5zcP7bWPk8g | Building (turns DTO validation on in vitest; triage every red test) | Acceptance review |
| RR-ERASURE-BUSINESS-EVENTS (P1) | session_017o9EBdBXjnpsSAeyU91LYT | Building | Acceptance review |

Next to start, in order, when a slot frees: the P1 follow-ups (FU-UNTRUSTED-INBOUND-FENCE, FU-STORE-ORDERS-MONEY-SCOPE,
FU-TIMELINE-CALLERS-SCOPE, FU-KEY-ACTION-GENOME-PROJECTION, FU-PAY-LINK-STATUS-GATE), MEM-CENSUS, RR P1 packets
(RR-MCP-TENANT-BOUND, RR-BANK-TOKEN-ENCRYPT, RR-WEBHOOK-INGRESS-CENSUS, RR-ADMIN-LOGOUT, ...), then the ready list.
Not yet in the plan (add with the next rulings commit): FU-FLOW-SAVE-EXECUTED-TOOL-TURN (P1: a failed flow follow-up
does not save the tool turn that already ran), finish-reason checks for the six OpenAI-compatible adapters,
FU-PHONE-VOICE-TAMPER-TEST (1/4096 collision), FU-PROFILE-INTERVIEW (if not closed in MEM-DOC-EXTRACTION-SIGHT).
Vercel previews: free-tier quota of 100 deployments/day was hit on 2026-11-23; not an admission gate.
Container restarts happen; every proof run checks Postgres/Redis and a run with real ECONNREFUSED does not count.

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

11. Should D-258 extend to the mirror doors (RevenueAction FIN_* complete/dismiss, command MONEY items complete/dismiss/
    bulk, command generate/auto-scan, signals resolve/dismiss) and refuse a non-member SUPER_ADMIN the intelligence scan?
    (Default: tracked, unchanged.)
12. Should a PARTIALLY_CREDITED invoice that still owes be remindable (D-260 counts it as sent; the gate refuses it)?
    (Default: refused.)
13. release0-live AMEND: contacts page h1 "Customers" (spec ~286, ~475)? (Default: h1 stays "Contacts", menu says
    "Customers".)
14. Should the menu fail open (show every hub) when the my-access read fails? (Default: yes; the server is the gate.)

15. The research index's 41 owner questions (`docs/reconstruction/research-recommendations/README.md` section 6 on
    branch `docs/v1-research-recommendations`): OQ-1 (MCP servers in production) and OQ-4 (bank access tokens in
    production) decide whether RR-MCP-TENANT-BOUND and RR-BANK-TOKEN-ENCRYPT become P0. (Defaults: as recommended.)

16. Store order lists/detail for members without revenue read: money-stripped rows (default), queue-status rows only,
    or none? Also: should store analytics routes require storefront read, and are checkout_complete counts and
    confirmed/shipped order counts "sales volume" under D-234? (Defaults: money-stripped rows; no storefront gate;
    counts visible.)
17. Should a failed KEY turn still save the member's question? (Default: no, as built.) Attachment caps 24k per file
    and 96k per turn, with a visible note to the member when truncated: acceptable? (Default: yes.)

18. Hand-written (MANUAL) timeline notes are visible to every member ("client paid $12,000" reaches bookings-only
    members): treat as revenue-owned? (Default: as built.)
19. Production facts that set two RR priorities: is MCP_REMOTE_SERVERS set in production (RR-MCP-TENANT-BOUND -> P0)?
    Are there BankConnection rows with access tokens (RR-BANK-TOKEN-ENCRYPT -> P0)?

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
