# Orchestrator state (live checkpoint)

Last written: 2026-11-25 ~21:05 UTC by the acting orchestrator (second-lane account, Claude Code), right after M18
merged; main `6f67c91e`. Rewrite in place on every merge, packet return
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

Every ruling to D-285 is on main (M16, PR #248). D-273 (Antigravity's FU-VITEST-DECORATOR-METADATA Release 0 AMENDs) is
referred to on the board but is not yet a row.
- **P12 setup-only Release 0 AMEND approved** (owner, relayed on #80 7136747457).
- **The merge queue is on for main** (D-278, ruleset 28066634). Lanes enqueue and never merge directly. From a cloud
  session, GraphQL is refused: enqueue with `gh api -X PUT repos/KEYFLOWOS/KEYFLOWOS/pulls/<n>/ccr/auto_merge -f
  merge_method=merge` (M16 went in this way).

## 0. Next session starts here (2026-11-25 ~21:05 UTC)

Main is `6f67c91e` (M18 merged 20:57, PR #250). V1-STATUS: 175 of 395 done, 46% of points; launch 87 done of 254.

**The owner's standing instruction (2026-11-25):**
- Keep both lanes as full as possible.
- Coordinate with Antigravity on #80.
- Keep everything resumable by any account or AI at all times.

The throughput plan is on #80 7172896636. Server lane (Antigravity), in order:
1. TOF-KEY-SELF-MODEL, which starts the chain TOF-KEY-SELF-MODEL → TOF-KNOWLEDGE-UPLOAD → KEY-TOOL-ALLOWLIST → DECIMALS-SERVER → CLAIM-LOOP web.
2. DEMO-PREVIEW.
3. FU-REFUND-GATEWAY-REFUSE (S-1): **held for the owner** (question 51). Release 0 RF-10/RF-12 and D-121 use this door on purpose (#80 7172026342).
4. The server halves of EXPENSES-HUB-1 and VAT-BASICS.
5. The census and RR packets.
6. FU-TEST-FLAKES.

Antigravity's M25 is gathering P87, P88, P89, P91, P92 and P93. P90 is blocked on owner question 52.

**M18 merged** (`6f67c91e`, head `b0309cb2`): P62, FU-SIDESHEET-MOBILE-OFFSET, FU-STUDIO-PAGE-SCOPE, the SWP-FIN-CASH-SOURCES and SWP-FIN-OVERVIEW-TRUTH web halves, SWP-SERVICE-DEPOSIT web, and docs.
- Shard 3's supertest ECONNRESET passed on its one re-run.
- Both wave confirmations were CONFIRMED.
- A first base comparison flagged H2 desktop and B4 phone. Re-run 3× at head and base, both proved intermittent on main as well: head 10/12, main 5/12 (PR #250 comments).

**Claude packets in flight.** Every one of them goes into the next Claude wave once it is RETURNed.

| Packet | Branch @ head | State | Next |
| --- | --- | --- | --- |
| **SWP-INV-REFUND-UI** (P85, crit. path #1) | `pkt/V1-SWP-INV-REFUND-UI` @ `a1ab2d8a` | Repair round 1 done. Refund is offered by server-built manual id shape, not provider; WiPay gets "Record refund" (out of band); Stripe/PayPal link to the gateway refund. Security confirmation CONFIRMED (minor R-1: a WiPay-paid store order's invoice refund leaves the order PAID). Correctness confirmation running (agent a87a10720ea39eeb8). | On CONFIRMED: RETURN. R-1 is a follow-up or owner question |
| **CATALOG-1 web** (P86, P0) | `pkt/V1-CATALOG-1-WEB` @ `b3e6567d` | Both lenses ACCEPT WITH FOLLOW-UPS. Repair round 1 is in progress (worker a9dd428130de87b49): scope gating, bulk archive confirm, https-only image link, business-switch reload, PRODUCT default, product currency on edit, all pages loaded, forwarded fields, count parity with /book, Products door on Sales (commerce/page.tsx, allowed under CHECKLISTS B line 59; proof:release0 at the wave), /app/templates "already applied" | Confirmations, RETURN |
| **FU-CONTACT-SEND-QUOTE-DOOR** | `pkt/V1-FU-CONTACT-SEND-QUOTE-DOOR` @ `4d99b534` | Both lenses ACCEPT WITH FOLLOW-UPS. Repair round 1 sent (cloud session_01TnVBvEZbY4vXtvn1Rwe3fk): gate on revenue write, encode contactId on the other doors, remove the dead listener | Confirmations, RETURN |
| **FU-UNDO-TOAST-SIGNOUT** | `pkt/V1-FU-UNDO-TOAST-SIGNOUT` @ `aeb8608b` (RED for item 2) | Correctness REPAIR (a weak keep-check, fixed at 6691dd4c) plus both lenses' late-toast finding. Ruling: CONF-P37-1 is superseded by the stricter no-toast pin (#80 7174351286). Cloud session_01TnVBvDxNUYEcwZ9waPUH4z is finishing | Round-2 report, then confirmations |
| **FU-E2E-MOCKED-SESSION-TOKEN** | `pkt/V1-FU-E2E-MOCKED-SESSION-TOKEN` @ `faea7a1c` | Security ACCEPT WITH FOLLOW-UPS (add the spec to CI's mocked list as a follow-up; check the redirect hop). Correctness review running (agent afb0e8c6873e5349f) | Repair round, then RETURN |
| **P67 FU-TIMELINE-LOAD-OLDER** | `pkt/V1-FU-TIMELINE-LOAD-OLDER` @ `8bbd3d6f` | Two reviews running (agents a01c8d7712f5f7225, ab47df79ddf6a2852) | Repair or RETURN |
| **P94 SWP-CRM-WEB-POLISH** | `pkt/V1-SWP-CRM-WEB-POLISH` @ `769f8933` | BUG-080/130/082 done. C8 is split to its own packet (owner question 53). Two reviews running (agents a0216d7fa63f582db, a2be113e8926baeb3) | Repair or RETURN |

If any of those agents or sessions is gone, start fresh reviewers on the branch head with ACCEPTANCE-REVIEW-BRIEF.md (or CONFIRMATION-REVIEW-BRIEF.md for a delta). The worker's report is on #80.

**Queue:**
- **Owner-gated:** RR-OWNER-RULINGS-RECORD (docs; it records the answers to OQ-5/13/19/30 and two RR migrations).
- **Now free:** OWNER-ALERTS-WEB, FU-NOTIFICATIONS-PAGE-REFUSED.
- **After Antigravity's M25:** SWP-KEY-SHELL-SMOKE web (needs P89).
- **After the server lane:** EXPENSES-HUB-1 web, CLAIM-LOOP web (after DECIMALS-SERVER), TODAY-4BLOCK.

**Follow-ups found in reviews (not yet in the plan):**
- An invoice-for-customer URL, so Create Invoice and the payment_reminder doors open New invoice prefilled.
- Dead ContactDetail header actions.
- Bulk product delete has no audit or events on the server.
- An https-only image link on the server DTO.
- Other Your page item counters still use the old sum.
- /book name-dedupe hides a listed product.
- Delete the unmounted next-actions-widget.tsx.
- Dark-mode bg-white dashboard cards.
- FU-REFRESH-AFTER-SIGNOUT.
- An app-wide bottom-bar clearance fix (question 46: page-transition h-full).
- Add seed-workspace-session.spec.ts to CI's mocked list.

**Resume recipe for the Claude lane (any account or AI):**
1. **Read the live state.**
   - #80 since this file's time.
   - The board (`git show origin/coord/board:BOARD.md`).
   - `git ls-remote origin 'refs/heads/pkt/V1-*' 'refs/heads/wave/*'`.
   - Every branch named above is pushed after every commit. Worktrees and logs in a scratchpad do not survive, and are not needed.
2. **Finish a packet:** read its RETURN on #80. If it has not returned yet, check out the pkt branch and follow PACKET-WORKER-BRIEF.md. Reviews follow ACCEPTANCE-REVIEW-BRIEF.md and CONFIRMATION-REVIEW-BRIEF.md.
3. **Assemble a wave:**
   1. Create `git worktree add -b wave/v1-wave-<N> <dir> origin/main`.
   2. Copy the main checkout's `.env` in (three local DB/Redis URLs; no secrets).
   3. For each packet: `COMMIT_TRAILER=... scripts/agent-memory/compact.sh pkt/V1-<branch> <PACKET-ID> web`.
   4. Run `git merge --squash origin/wave/v1-docs-p19` and commit it as `docs: wave/v1-docs-p19 (compacted) at <sha>`.
   5. Verify every packet file equals its pkt tip, or a clean 3-way merge you inspect.
   6. Run `scripts/check-branch-divergence.sh origin/main HEAD --max-commits 25 --max-files 50`.
4. **Wave proof:**
   - Server:
     - `pnpm install --frozen-lockfile`
     - prisma generate
     - build the packages
     - server `tsc --noEmit`
     - `NODE_OPTIONS=--max-old-space-size=8192 pnpm --filter server build`
     - `vitest run` (with `.env`)
     - `pnpm proof:release0 -- --skip-build`
   - Web: `next typegen` + `tsc --noEmit`, `vitest run --minWorkers=1 --maxWorkers=2`, `pnpm lint --max-warnings 26`.
   - Mocked build (`NEXT_PUBLIC_API_BASE_URL=http://api.test.local`), then the 3 CI e2e specs and any mocked sweeps.
   - Live per LIVE-PROOF-RUNBOOK §3, with the API on 3001 and keyflowos_e2e: release0-live, the touched journeys and sweeps. Always run a base run on main for comparison.
5. **PR and merge:**
   - Open the PR with `gh api -X POST repos/KEYFLOWOS/KEYFLOWOS/pulls`, mirroring the M16 PR #248 body.
   - Get two wave confirmations.
   - When every required check is green at the exact head and the PR is mergeable/clean, ENQUEUE with `gh api -X PUT repos/KEYFLOWOS/KEYFLOWOS/pulls/<n>/ccr/auto_merge -f merge_method=merge`. GraphQL is refused from cloud sessions.
   - A failed job gets one re-run, after its run completes.
6. **After a merge or return:**
   - `node scripts/agent-memory/status.mjs`
   - rewrite this file in place
   - update the board
   - post on #80
7. **Recreate session-only things:**
   - The hourly #80 check, a scheduled task in the orchestrator session.
   - The PR subscriptions.
   - After a container restart, run `service postgresql start` (and redis if needed).

**Lessons this session:**
- Two packets confirmed alone can still clash in a wave (P62 + studio). The wave proof is the safety net, so never skip it.
- A test that matches on link text is fragile; match on href or exact names.
- A container restart kills agents: read their transcripts' last report and use fresh reviewers.
- The server build needs an 8 GB heap.
- Use 2 vitest workers under load.
- A new wave worktree needs `.env` copied in.
- When main moves while a wave PR waits, merge main in. A push cancels the old CI run, whose verdict then fails closed.

## 3. Work in flight (what git on main cannot show)

Main is at `6f67c91e`. Production runs `f5d58ef7` (16 Nov), far behind main; the owner redeploys (D-266).

| Work | Branch / head | State | Next action |
| --- | --- | --- | --- |
| **Claude packets** | the seven in section 0 | Review or repair rounds | RETURN each, then wave M20 (Claude) |
| **Antigravity** | M25: P87, P88, P89, P91, P92, P93; P90 blocked (question 52) | Building | Their wave |
| **Owner** | - | - | Section 4 questions 40-54; production redeploy (D-266) |
| `wave/v1-docs-p19` | main 6f67c91e merged in | This file, V1-STATUS | Squashed into each Claude wave |

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
**Ruled 2026-11-25 (D-280 to D-283, #80 7159721276):** SEC-WAW-1 excluded (D-280), FU-REQUIRE-AUTH-REMOUNT on launch (D-281), push opt-in under My account (D-282, answers 36), the six follow-ups to the Claude lane after P41 (D-283, answers 37). The merge queue is on (D-278 done, ruleset 28066634).
39. The runbooks now let a local proof run on Node 22.23.5 (/opt/node22) when the pinned 22.23.4 is absent, provided the
    proof says so; CI keeps its own pin. Accept? (Default: yes, disclosed.) Also: put FU-REQUIRE-AUTH-REMOUNT (the shell
    remounts on every navigation) on the launch track? (Recommended: yes.) And SEC-WAW-1: inbound WhatsApp text stays
    out of KEY's automatic prompts unless the owner asks (default: excluded).

**Ruled 2026-11-25 (D-284, D-285):** Timeline paging at launch; form submissions under All.
40. The contact Timeline never shows an ordinary note's text: `note.created` carries only `{ noteId }` (P41 worker,
    2026-11-25). Carry the body on the event, or read notes on the Timeline? (Default: not in v1; the Notes tab shows
    the text.)
41. P61's security review found an existing race (not in P61's diff): `lib/workspace.ts` refreshAccessToken writes the
    new token even if the user signed out while the refresh was in flight, which can leave a token on the device.
    Proposed follow-up FU-REFRESH-AFTER-SIGNOUT (web, S). (Default: follow-on unless you put it on launch.)

42. **Customer-referral privacy (server; found by FU-STUDIO-PAGE-SCOPE's security review).** `POST /site/storefront/public/:slug/customer-referral` is unauthenticated (10/min/IP). For any email it answers 404 or 200, which tells the caller whether this person is a customer. A 200 returns `stats.completedBookings` and `paidOrders`, and stamps a code on the contact. Verify the email (e.g. a magic link) before minting, and never return stats? Antigravity holds until you rule. (Default: hold.)
43. **Who may edit services, prices and deposits.** The service routes have only AuthGuard and BusinessGuard, so any member, STAFF included, can change prices and deposits. Require bookings or storefront write? (Default: as today until ruled.)
44. **Push after sign-out.** Signing out leaves the device's push on. Once owner alerts are live, a shared tablet keeps getting the previous owner's payment alerts. Unsubscribe the device on sign-out? (Default: follow-up web packet in handleLogout.)
45. **Owners of several businesses.** A device's push row holds one business, so an owner of X and Y gets Y's owner alerts by email, not push. One device for all the member's businesses? (Default: email fallback as today.)
46. **Shell bottom padding (BUG-004 family).** The scroll root's `pb-28` is not effective inside the `h-full` page box, so a phone page's last control can sit under the bottom nav. P62 and the deposit half added local `pb-24 md:pb-0`. Fix the whole shell in one packet? (Default: yes, follow-up web packet.)
47. **Same mount pattern as the SideSheet fix.** `record-detail-drawer.tsx` and `booking-side-sheet.tsx` have the same pattern, and the shared SideSheet has no focus trap (the commerce sheet does). Follow-up web packets? (Default: yes, follow-on.)
48. **Deposit journeys.** Journey B2 needs a "New service" dialog in Schedule > Services, and F4 needs the deposit shown at the customer checkout (`/book/<slug>`). Neither is in SWP-SERVICE-DEPOSIT's write set. Which packets own them? (Default: find or add them in the plan.)

49. **Payroll amounts and D-100 (server).** A member with operations read but no revenue read can read payroll gross: the runs list's `totalGross`, and `data.totalGross` on the P59 discard Activity row, which `canReadActivityRow` does not withhold. Treat payroll amounts as money under D-100? (Default: yes; a server follow-up gates them on revenue read.)
50. **USAGE-COUNT-SCRIPT for SWP-FIN-OVERVIEW-TRUTH.** The plan asks for the count of live businesses with DRAFT or APPROVED payroll runs. That needs production data, so only you can run it. (Default: run it before the production redeploy.)

51. **Bookkeeping refunds on gateway payments (S-1, server, money).** `POST /commerce/businesses/:b/payments/:p/refund` (markPaymentRefunded) checks no provider. A member with revenue write can mark a Stripe payment refunded: the invoice reopens and the posting reverses while Stripe keeps the money. `StoreOrderService.refundCheckoutPayments` does the same for storefront orders. But Release 0 RF-10/RF-12 and D-121 use this door on purpose, for out-of-band provider refunds (WiPay has no refund API; PayPal pairs the webhook). Options:
    - (a) refuse gateway rows with 409, keeping an explicit "refunded outside KEYFLOWOS" mode for providers without a refund API, and supersede RF-10/RF-12;
    - (b) keep as is.

    Also: should storefront refunds of gateway orders go through the gateway refund? (Default: hold, as today; #80 7171899154, 7172026342.)
52. **P90 SWP-CENSUS-V1-B (P0) Release 0 contradiction.** 10 of the 46 open write rows are pinned by Release 0 cases in which a STAFF member on role defaults writes them:
    - presence saveDraft and publish: D11-S02/S04/S05/S09/S13/S14/S15;
    - onboarding concierge chat, dismiss, snooze and resume: D11-C07/C09;
    - connector test, smoke, sync and inbox-config: R0-CMF6-K04/K05/M02, V94D-F02.

    Options:
    - **Option A:** gate all 46 and supersede those cases (the test actors get the scope, or expect 403).
    - **Option B:** mark the 10 exempt-ruled in the census and gate the other 36.

    (No default for Release 0 evidence: Antigravity holds P90 until you rule; #80 7172637493.)

53. **Contacts list in the first phone screen (Journey C8).** At 375×812 the first contact row is at y≈1660 and C8 needs it above 406. Above the list sit:
    - Pulse;
    - the Action Center;
    - the Priority Queue;
    - a four-row toolbar;
    - smart chips;
    - the focus view's "Next actions" and "Contacts requiring action".

    C8 is also red on desktop. Reordering alone gets the row to y≈720 at best. Should a contacts-screen layout packet put the list first on phones (and what on desktop)? (Default: split C8 into its own packet; P94 ships without it; #80 7174372256.)
54. **Journey B1 asks for Tax and Stock fields when creating a product.** The product model has neither: stock lives in InventoryStock, and there is no tax field. Add them (a server packet), or change B1? (Default: B1 stays red on those two fields until you rule.)

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


