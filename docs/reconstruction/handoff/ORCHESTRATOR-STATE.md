# Orchestrator state (live checkpoint)

Last written: 2026-11-25 ~04:45 UTC by the acting orchestrator (second-lane account, Claude Code), after M12 (Antigravity) merged as 8dbcb03c and M13 was cut. Rewrite in place on every merge, packet return
or owner ruling; never append. What you remove stays in git history and on issue #80.

Purpose: everything a fresh session, on any account or tool, needs to carry on the v1 programme without the
conversation that produced it. Read `docs/development/agent-memory/README.md` first.

**This file holds only what cannot be generated.** Who does what next lives on the live board: `BOARD.md` on branch `coord/board`, one owner per row. The checklists every lane ticks are in `docs/development/agent-memory/CHECKLISTS.md`.

| Fact | Where it lives |
|---|---|
| Which packets are done, counts, critical path, what is ready to start | `V1-STATUS.md` in this folder (generated: `node scripts/agent-memory/status.mjs`) |
| One packet's scope, rulings, write set, dependencies | `node scripts/agent-memory/bundle.mjs <PACKET-ID>` |
| Rulings | `docs/reconstruction/BUILD-MAP-001.md` (rulings given after the last rulings commit: section 2 below) |
| How to brief a worker, review a return, build and merge a wave, ask the owner | `docs/development/agent-memory/` |
| What happened, in order, with evidence | GitHub issue #80 (control room) and git history |

## 1. Standing instructions from the owner

- **D-274 (2026-11-24): speed up with no compromise, record every operating decision, and do R&D on the best
  strategies.** The adopted rules (full waves, early wave PRs, plan pre-flight, root fixes, live-run hygiene), the
  owner proposals (a GitHub organization plus the merge queue; a path-scoped Windows proof) and the research in
  progress are in `docs/development/agent-memory/WORKFLOW-IMPROVEMENTS.md`. Every lane reads it at session start.
- **D-271 (2026-11-24): v1 is the priority. D-268's pause is lifted, and packet work resumes in the D-263 wedge
  order.**
  - The KEY Builder design and plan (D-268 to D-270) are parked until v1 is completed. They stay on branch
    `ccr-1eadc8f4-aqfqne`: `docs/key-builder/KEY-BUILDER-DESIGN-001.md`, `KEY-BUILDER-PLAN-001.md` and `research/`.
  - Sessions in other tools (Antigravity) claim like every lane: an atomic claim push (CHECKLISTS B1) and a CLAIM on #80.
- **D-272 (2026-11-24, #80 comment 7121024415): the owner's merge go and four answers.**
  - Merge under D-239, one at a time, in this order: (1) PR #228, merged as 142e5f9e; (2) PR #230, the rulings and the
    wedge re-cut (`wave/v1-rulings-3n`); (3) PR #229, wave 3m (money first); (4) `wave/3j-second-lane` after it is
    split. Each needs main merged in, CI green at the exact head, both reviews accepted, head, mergeability and scope
    re-verified, and a merge commit with the head pinned. Only an owner ruling changes the order. The production deploy
    stays the owner's (D-266).
  - The Release 0 AMEND for FU-VITEST-DECORATOR-METADATA only if the before/after shows a tightening (question 20).
  - Contract term extraction refuses external URLs (FU-OUTBOUND-ATTACHMENT-URL, now in the plan).
  - SEC-KEY-CUSTOM-LOGIC (P0, now in the plan) and switching off the autopilot's #80 posting: approved, Antigravity
    lane. "Batch 2 safe defaults #5-#10": held for the owner.
- Finish v1 (plan of record: `docs/reconstruction/V1-PLAN-RECUT.json`). Keep going until it is done.
- **v1 is re-cut to one wedge (D-263, 2026-11-24, #80 comment 7118009265):** a Trinidad and Tobago service business
  gets paid faster from WhatsApp, in TTD. The launch gate runs on packets with `track: launch` only; `track:
  follow-on` packets (research D-261, memory D-254, store, quick sale, KEY capability) stay in v1 and ship after launch
  (D-264, reversible). Money truth first: packets with `wedge_first` go first. Store and quick sale are hidden for new
  businesses at launch (WEDGE-HIDE-STORE). Ten real businesses run the launch build before the gate (GATE-PILOT-10,
  D-267). Production is redeployed by the owner (D-266).
- **Proof per wave (D-265):** each packet gets tests-first commits, two reviews, touched-folder tests and the type
  check; the full server suite and Release 0 run once at each wave head before its PR (per packet only when it edits a
  Release 0 bound suite or a manifest-bound file).
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
  seven-day Fable limit is spent (it was due to reset 2026-11-25 19:00 UTC; check before relying on it), so every
  session runs on Opus (`model:
  claude-opus-5-5` in create_session), which shares the 5-hour limit with the orchestrator.
- Owner decisions are asked in batches with a recommendation first. Record each ruling on issue #80 as D-nnn at once.
- Agent memory layer (D-253, "Both, in parallel"): Track 1 is `docs/development/agent-memory/` and
  `scripts/agent-memory/` (docs and scripts only); Track 2 is a separate research session.
- KEY's memory system is built inside v1 once the owner approves the Track 2 design (D-254).
- Everything needed to continue must be pushed to GitHub (owner, 2026-11-22: "ensure every step of the way our work
  is accessible so that it can be continued by another account or software").

## 2. Rulings not yet on main

Every ruling to D-272 is on main (PR #230). **D-274 to D-279 are now rows in BUILD-MAP-001 on `wave/v1-docs-p19`
(`46023215`) and reach main with M11.** Summaries: D-274 speed up with no compromise (WORKFLOW-IMPROVEMENTS.md);
D-275 GitGuardian and password-less CI Postgres (done, M9); D-276 the Me menu's Notifications for settings readers
(FU-ME-NOTIFICATIONS-SCOPE, returned); D-277 the contact Timeline with a channel filter, and D-277b bulk delete with
Undo; D-278 the organization and merge queue (repository moved 2026-11-25; FU-CI-MERGE-QUEUE returned by
Antigravity; the owner switches the queue on); D-279 the Windows proof gated by its inputs and sharded.
D-273 (Antigravity's FU-VITEST-DECORATOR-METADATA Release 0 AMENDs) is referred to on the board but is not yet a row
in BUILD-MAP-001: Antigravity to record it with M10.
- **P12 setup-only Release 0 AMEND approved** (owner, relayed on #80 7136747457): SWP-STORE-LISTING-SERVER may amend
  its Release 0 suite's setup only; assertions unchanged.

## 0. Next session starts here (2026-11-25 ~04:45 UTC)

Main is `8dbcb03c`: M11 (Claude, `293d7f39`) then M12 (Antigravity, PR #241: P43, P44, P45 = SWP-INV-DETAIL server,
P46 = WEDGE-WA-INBOUND-CAPTURE server, P52 READY-TO-SEND, P38 FU-CI-MERGE-QUEUE, P37 server, P51, P53).

**M13 (Claude, wave 3r)** is being assembled on `wave/v1-wave-m13` from `8dbcb03c`: P37 web half
(`pkt/V1-FU-BULK-DELETE-UNDO-WEB` @ `39364399` = reviewed `3e0ef2ad` + main merged in), P39
(`pkt/V1-FU-CI-WINDOWS-INPUT-GATE` @ `e497786e` = reviewed `8743e437` + main), P54 SWP-INV-DETAIL web half
(`pkt/V1-SWP-INV-DETAIL-WEB` @ `90276ed0` = reviewed `c8f9a24f` + main), and this docs branch. Each packet branch got main
merged in first (keeping main's copy of files main now owns: the server halves, P38's ci-cd.yml), so each compacts to
its own files only; the wave confirmations must check the 3-way results in `use-contact-actions.ts` and `client.ts`
(P37 over M11's P27/P35). Then: wave-head proof (real install from the head's lockfile, never symlinked deps), live
journeys E (invoice detail) and C, the mocked CI specs **as CI runs them** (a mocked production build:
`NEXT_PUBLIC_API_BASE_URL=http://api.test.local`, `E2E_WEB_COMMAND=standalone`; `E2E_NO_SERVER=1` cannot serve
public-flows), PR, CI, two wave confirmations, merge (D-239).

**Held: P55 WEDGE-WA-INBOUND-CAPTURE web half** (`pkt/V1-WEDGE-WA-INBOUND-CAPTURE-WEB`, repair round in progress at
the time of writing). It stays out of every wave until the server-side **SEC-WAW-1** fix is on main: KEY's hourly
intuition scan reads every ContactNote body, so pasted third-party WhatsApp text would reach an LLM prompt (#80
7153059391, 7153185403; asked of Antigravity as FU-WA-INBOUND-KEY-EXCLUDE). Its live journey C/D step is part of the
repair round.

GitHub from a cloud session: REST works; GraphQL is refused. Subagents spawned here cannot spawn reviewers; the
orchestrator runs each worker's two reviews.

## 3. Work in flight (what git on main cannot show)

Main is at `293d7f39` (2026-11-25 ~03:35 UTC): M11 PR #240 after M10 PR #239 (`45d302ef`, Antigravity). Production
runs `f5d58ef7` (16 Nov), far behind main: the owner redeploys (D-266). Lanes as agreed on #80 (Antigravity server
and server halves, Claude web and web halves); the board (`coord/board`) has one owner per row.

| Work | Branch / head | State | Next action |
| --- | --- | --- | --- |
| **P37 web half (Claude)** | `pkt/V1-FU-BULK-DELETE-UNDO-WEB` @ 3e0ef2ad | Returned (#80 7150677995), both reviews and confirmations CONFIRMED; browser RED at base, green at head | Next Claude wave, with the server half |
| **P39 (Claude)** | `pkt/V1-FU-CI-WINDOWS-INPUT-GATE` @ 8743e437 (on P38 b5a3c63a) | Returned (#80 7150759326); reviews by four cloud sessions tagged `p39-review` | A wave with P38 |
| **Antigravity lane** | see #80 and the board | Returned: P38, P47, P49, P50 and the earlier server halves (P37, P43-P46); claimed P51 | Their next wave; COR-P37-3 (CRM caches after restore) and `deletedIds` asked of them (#80 7150334442) |
| **Owner** | - | - | Switch the merge queue on for `main` once P38 merges (D-278); the question batch; production redeploy (D-266) |
| `wave/v1-docs-p19` (Claude lane) | merged main 293d7f39 | Review minors fixed (c91c5bc2), follow-up rows FU-UNDO-TOAST-SIGNOUT and FU-FOCUS-QUEUE-PENDING-DELETE, this file | Next Claude wave |
| First lane, as it left them (2026-11-23 ~09:30 UTC) | `wave/v1-wave-3j` a2e9f3f0, `wave/v1-wave-3k` 88268a01; FU-INSIGHTS-SIGHT 28cdbccb; child sessions for FU-STRATEGIC-ROUTES-SIGHT, FU-GENOME-DNA-WRITES-AND-INTEGRITY, FU-GENOME-SURFACES-REVENUE, FU-OUTBOUND-ATTACHMENT-URL, FU-AI-APPROVALS-MONEY-SIGHT | Not re-verified since | Re-verify each head before it enters a wave |

How every proof was run (the server proof at an exact head, the web proof, live journeys and sweeps with the API on
`keyflowos_e2e`, browser RED at the base, and reviews in detached worktrees) is written down step by step in
`docs/development/agent-memory/LIVE-PROOF-RUNBOOK.md`. Any tool can repeat it.

## 4. Open questions waiting for the owner (ask together)

Format: `docs/development/agent-memory/OWNER-QUESTION-FORMAT.md`. Safe defaults apply until ruled, but never to Release 0 evidence: that changes only by an owner ruling.

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

20. **Ruled by D-272.2: the AMEND goes ahead only if the before/after shows a tightening; otherwise it holds.** (a)
    reads as a tightening (a bad email now gets its 400); (b) widens an expected message, so it holds unless the diff
    shows otherwise. Background: Turning DTO validation
    on in vitest broke two bound cases whose premise came from unvalidated tests: (a) crm-contact-duplicate "whitespace-
    padded email passes the DTO ... 409" (release0-landed.json): production answers 400 at @IsEmail. Default: restate
    as 400 (service trim still proven by the next case). (b) key-cortex-tenant-binding "SUPER_ADMIN naming no tenant is
    refused" on GET conscious/stream: still refused, no service called, but the message is the pipe's "Bad Request".
    Default: widen that route's expected message only. The packet also fixed a real production defect: every POST
    create-event (and ticket types with a sale window) was 400 (@IsISO8601 after @Type(Date)).
21. MEM-SEMANTIC-SIGHT gated the semantic backfill to settings:admin (STAFF were allowed before). Ratify? (Default: yes.)
22. With sells unknown (first settings read failed, nothing cached), a services business loses Schedule until refocus
    (FU-NAV-A1-CODEX-224). Differs from the "unknown hides nothing" rule for member levels. (Default: accept.)
23. RR-GATEWAY-TYPED-FAILURES: should an Anthropic 400 "credit balance is too low" count as exhausted quota (opens the
    platform circuit)? (Default as built: bad_request, not counted.)
24. MEM-TEMPORAL-MEMORY-ROUTES-SIGHT (orchestrator chose B): structured temporal memory rows now also apply the
    money/expense text taint and provenance rule, so a member with a partial module map (e.g. no crm) loses contact
    summaries and provenance-less pattern summaries; FU-TEMPORAL-FLOW-INBOX-SCOPE's v71w:515 expectation narrowed.
    Every-module readers and owners unchanged. (Default: B.)
25. RR-REDACTION-BY-CONTENT: ~9.6% of random 15-digit ids (and 17-digit platform ids) pass Luhn and become <card>,
    now also in KEY tool answers (externalPostId, platformId). Exempt *Id/_id keys from card matching? (Asked the lane
    to exempt them; confirm.) Also: add sk_live_, xoxp-, AIza prefixes?
26. FU-CORTEX-PATTERNS-SIGHT: KEY goals_create_plan plans as KEY_SYSTEM_ACTOR_ID, so an owner's goal plans lose money
    patterns (plans are readable business-wide). Plan as the turn's member instead? (Default: keep as built.)
27. Codex on #227: AGENTS.md asks architecture/ maps to be regenerated after architecture changes; CLAUDE.md forbids a
    programme-map refresh without authority. Approve one reviewed packet FU-ARCH-MAP-REFRESH for waves 3a-3k? (Default: yes, after 3k lands.)
28. MOUNT-QUOTES: Money's "Invoice" buttons and the hub's "Invoices & Pipeline" push a bare `?tab=pipeline`, which now
    opens Quotes. Repoint them to `/app/commerce/invoices`? (Default: a small follow-up packet repoints them.)
29. MOUNT-QUOTES: keep the explicit, confirmed bulk Delete on the Quotes list? (Default: keep; no status option deletes.)
30. MOUNT-QUOTES: FinancePipeline and the payment-record modal screen are now mounted by no route. Remove them, or
    remount the modal? (Default: remove in a follow-up.)
31. D-264: should the launch wait for the research (D-261) and memory (D-254) packets after all? (Default: no; they
    follow launch.) And confirm the precedence used in PR #230: where D-263 and D-264 differ on a research or
    memory packet that fixes KEY, D-263 wins, so KEY correctness fixes are on launch. Seven packets rest on it:
    RR-INTENT-PARSER-ONE-TOOL-LIST, RR-CORTEX-TYPED-RESULT, RR-LEARNING-OUTCOME-SEMANTICS, RR-REFLECTION-HONEST,
    FU-FLOW-SAVE-EXECUTED-TOOL-TURN, FU-OPENAI-FINISH-REASON, FU-CORTEX-EXECUTE-STRUCTURED-DTO (the rule and all 17
    moves: the plan's `wedge.correction_2026_11_24`). Under the same rule's tiebreak MEM-HONEST-RETRIEVAL,
    MEM-TEMPORAL-EMBED-DEDUP, MEM-CONSOLIDATION-CHECKPOINT and RR-UNDO-DURABLE stay on follow-on; say if any should
    be on launch. (Default: as applied.)
Questions 32 to 35 were ruled as D-277, D-276, D-278/D-279 and D-275 (section 2).

36. FU-ME-NOTIFICATIONS-SCOPE (D-276) leaves a settings-none member (front desk) with no menu path to the
    Notifications page's Push tab, the only place to turn on push for their own device (the push routes are every
    member's own). Move the push opt-in under My account in a follow-up? (Default: ship as ruled; follow-up proposed.)
37. Three follow-ups from today's reviews are in the plan as `follow-on` for you to assign or drop:
    FU-NOTIFICATIONS-PAGE-REFUSED, FU-STUDIO-PAGE-SCOPE, FU-E2E-MOCKED-SESSION-TOKEN. (Default: Claude lane after M11.)
38. An earlier session's pre-flight (A3) narrowed FU-OVERLAY-LAYER-TABLE's definition of done from "no z-index literal
    outside the table" to "no position:fixed z-index literal >= 30" without a ruling (found by M11's security
    confirmation). Keep the narrowing? (Default: keep, it is layering only; say if the full guard is wanted.) Two more
    follow-ups are in the plan as `follow-on`: FU-UNDO-TOAST-SIGNOUT, FU-FOCUS-QUEUE-PENDING-DELETE.

## 5. How to work here (learned the hard way)

The procedures themselves are in `docs/development/agent-memory/WAVE-RUNBOOK.md`. Kept here: what is specific to
this machine and this week.

- Node 22.23.4 at `/opt/node-22.23.4/bin` where it exists; this week's container has only `/opt/node22` (22.23.5). Load env for DB tests: `set -a; . /home/user/KEYFLOWOS/.env; set +a`.
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

- Release 0 and the server suite need `.env` loaded in the shell that runs them (`set -a; . ../../.env; set +a`);
  without it a database suite fails to start and R0 is REJECTED for no product reason.
- Never chain proof runs with a waiter that greps a log for words a previous run also printed ("chain finished at"
  matched "previous chain finished at"): another run checked out a different head mid-suite. Run heads in one strict
  sequential script that checks the head before and after each step.
- A container restart stops Postgres and Redis. Check `pg_isready` and `redis-cli ping` before every proof run.
- jsdom cannot show React event timing between the capture and bubble listeners: a menu closed in the capture phase
  passed its unit test and broke every menu item in a browser. Menu, focus and animation changes need the live run.


