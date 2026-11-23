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

Main is at `6ccb6b4e` (wave 3f, #224, merged 2026-11-23 05:03 UTC). 72 packets done on main; plan 361 (this branch).
Workers run on Opus (Fable spent until 2026-11-25 19:00 UTC); hold four. A second Claude account works the RR-* P2/P3
lane (`docs/development/agent-memory/SECOND-ACCOUNT-SETUP.md`); it claims by pushing `pkt/V1-<ID>` and posts RETURN on
#80; scan #80 every ~2 h and give each RETURN the two acceptance reviews. Its first claim: RR-SCRIPT-SPECS-IN-CI.

| Work | Branch / head | State | Next action |
| --- | --- | --- | --- |
| Wave 3g: PR #225 | `wave/v1-wave-3g` @ cbb61d04: MEM-TEMPORAL-SCOPE, FU-FINANCE-INTEL-DOORS, MEM-SALIENCE-SIGHT, RR-UNTRUSTED-CONTENT-FENCE, RR-STREAM-ERROR-NO-EFFECTS, FU-PAY-LINK-STATUS-GATE, RR-SCRIPT-SPECS-IN-CI | Proven: 796/797 (only A9-R2 known flake, 3/3 alone), R0 MET; auto-merge review CLEAN | Merge under D-239 when CI is green |
| Wave 3h | `wave/v1-wave-3h` @ a78053fe (stacked on 3g, 48 files): RR-ERASURE-BUSINESS-EVENTS, FU-TEMPORAL-FLOW-INBOX-SCOPE @ d2af8fc13, FU-NAV-A1-CODEX-224 @ 7b2a7995, RR-MCP-TENANT-BOUND @ d71ba902, MEM-DOC-EXTRACTION-SIGHT, MEM-SEMANTIC-SIGHT @ 09bdc807 (applied as its own delta over main+DOC) | Proof running (server, R0, web); assembly review running | PR after 3g merges |
| Wave 3i | FU-KEY-GENOME-READS-RESIDUAL @ 3336ab2a5 + next returns | Accepted | Build after 3h (expect a key-cortex-consciousness.service.ts import conflict with MEM-SALIENCE: keep both) |
| FU-VITEST-DECORATOR-METADATA | `pkt/V1-FU-VITEST-DECORATOR-METADATA` @ 83b6dfc8, session_017o9EBevZsyK5zcP7bWPk8g | STOPPED on owner question 20 (R0 REJECTED 37/39) | Owner ruling, then AMEND rows and re-prove |
| MEM-PATTERNS-SIGHT (P0) | session_017o9EBeafoWPQry9ggXEDDK (on MEM-SEMANTIC branch) | Building | Acceptance review |
| MEM-UNIFIED-SEMANTIC-SIGHT (P0) | session_017o9EBea375ryCZG7k6cSZh (on MEM-SEMANTIC branch) | Building | Acceptance review |
| FU-KEY-ACTION-GENOME-PROJECTION (P1) | session_017o9EBfKdTMK1cKeLRzg5q6 | Building | Acceptance review |
| RR-MCP-TENANT-BOUND (P1) | session_017o9EBdXHPD49Rc4zHwMj4K | Building (OQ-1 open) | Acceptance review |
| RR-BANK-TOKEN-ENCRYPT (P1) | session_017o9EBdeAPCJoxrnvjWpV8w | Building (OQ-4 open) | Acceptance review |
| Second lane: RR-GATEWAY-TYPED-FAILURES | other account | Building | Review its RETURN on #80 |

Added to the plan 05:10 UTC: FU-NAV-A1-CODEX-224, FU-CORTEX-EXECUTE-STRUCTURED-DTO, FU-UNIT-MOCK-ISOLATION-2, FU-BARE-400-AUDIT, FU-SETTINGS-MANUAL-STEP-FENCE, FU-WEB-PAYLINK-STATUS-BUTTONS, FU-KEY-SEND-INVOICE-PAID-REFUSE. Still to do: label v86s_ in fixture-prefixes.json; MEM-TEMPORAL-MEMORY-ROUTES-SIGHT must also cover temporal-adapter searchMemories/getRecentMemories. From FU-PAY-LINK-STATUS-GATE review: web hides
"Copy payment link" / WhatsApp share unless status is payable; KEY commerce_send_invoice refuses PAID up front (today it
emails then fails the PAID->SENT move); KEY invoice findFirst lacks `deletedAt: null`. Recorded deviation: the
pay-link packet touched flow-orchestrator.service.ts (+7, D-248) and invoice-send-delivery.spec.ts mock outside its write set.

Next to start, in order, when a slot frees: the P1 follow-ups (FU-UNTRUSTED-INBOUND-FENCE, FU-STORE-ORDERS-MONEY-SCOPE,
FU-TIMELINE-CALLERS-SCOPE, FU-FLOW-SAVE-EXECUTED-TOOL-TURN, FU-CONTACTID-WRITER-VALIDATION: each after its dependency merges), MEM-CENSUS, RR P1 packets
(RR-WEBHOOK-INGRESS-CENSUS, RR-ADMIN-LOGOUT, ...), then the ready list.
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

20. **Release 0 ruling needed (blocks FU-VITEST-DECORATOR-METADATA, R0 REJECTED without it).** Turning DTO validation
    on in vitest broke two bound cases whose premise came from unvalidated tests: (a) crm-contact-duplicate "whitespace-
    padded email passes the DTO ... 409" (release0-landed.json): production answers 400 at @IsEmail. Default: restate
    as 400 (service trim still proven by the next case). (b) key-cortex-tenant-binding "SUPER_ADMIN naming no tenant is
    refused" on GET conscious/stream: still refused, no service called, but the message is the pipe's "Bad Request".
    Default: widen that route's expected message only. The packet also fixed a real production defect: every POST
    create-event (and ticket types with a sale window) was 400 (@IsISO8601 after @Type(Date)).
21. MEM-SEMANTIC-SIGHT gated the semantic backfill to settings:admin (STAFF were allowed before). Ratify? (Default: yes.)
22. With sells unknown (first settings read failed, nothing cached), a services business loses Schedule until refocus
    (FU-NAV-A1-CODEX-224). Differs from the "unknown hides nothing" rule for member levels. (Default: accept.)

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
