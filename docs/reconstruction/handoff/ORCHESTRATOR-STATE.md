# Orchestrator state (live checkpoint)

Last written: 2026-11-24 ~20:05 UTC by the acting orchestrator (second-lane account, Claude Code), after M7a (PR #237, 10e3c97e, Antigravity) merged, P29 returned and P32 was claimed. Rewrite in place on every merge, packet return
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

Every ruling to D-272 is on main (PR #230, merged 2026-11-24 as 05f04f2c). Given since, not yet in BUILD-MAP-001:
- **D-274** (2026-11-24, owner in chat): "Just do all you can to speed up. Record decisions that enhance our
  operations. As we are improving the workflow we should be doing R&D to implement the best strategies." Read with
  "speed up without any compromise": every gate stays. Recorded with its adopted rules in
  `docs/development/agent-memory/WORKFLOW-IMPROVEMENTS.md` (this branch).
- **P12 setup-only Release 0 AMEND approved** (owner, relayed on #80 7136747457): SWP-STORE-LISTING-SERVER may amend
  its Release 0 suite's setup only; assertions unchanged.

## 3. Work in flight (what git on main cannot show)

Main is at `10e3c97e` (2026-11-24): M7a PR #237 (Antigravity: P24 sharded CI, C3-C5; P25 planner step order; FU-PENDING-OWED-WEB) after M6 PR #235 (c7fb73eb). Production runs `f5d58ef7` (16 Nov), far behind main: the owner redeploys (D-266). The second-lane account acts as orchestrator and posts on #80. How we work faster (D-274: adopted rules A1-A10, owner proposals P1-P2, R&D, experiments): `docs/development/agent-memory/WORKFLOW-IMPROVEMENTS.md`. Who holds which row: `BOARD.md` on `coord/board`.

| Work | Branch / head | State | Next action |
| --- | --- | --- | --- |
| **M8: wave 3p (Claude lane)** | PR #236, `wave/v1-wave-3p` @ 68c9ed7e = 771bfc3c (P13, P19, P23/C1, P20, FU-NAV-A3-CODEX-235; CI was green there) + main 10e3c97e | Main merged in cleanly (divergence gate OK). CI at 68c9ed7e: green so far except **GitGuardian, red on a CI service-container password that P24 copied into the sharded job** (inherited from main, red on #237 too; owner question 35, #80 7142554825). Wave-head proof chain running (`scratchpad/chain-w3p2.sh`: server suite, R0, web, agent-control, then live sweep, journey C, release0-live) | When CI is complete and question 35 is answered, re-verify and merge under D-239/D-272 with the head pinned |
| P27 FU-CONTACT-DELETE-LEAVE | `pkt/V1-FU-CONTACT-DELETE-LEAVE` @ 6f2cf8df | RETURNed (#80 7140922048), both reviews ACCEPT | Next Claude wave, after M8 |
| P29 FU-C4-FOCUS-OPEN | `pkt/V1-FU-C4-FOCUS-OPEN` @ cdf2ac66 | RETURNed (#80 7142275052), both reviews ACCEPT; C4's list step live green, R0 live green; web suite 209/1887 | Next Claude wave, after M8 |
| P32 FU-C4-CMDK-SEARCH | `pkt/V1-FU-C4-CMDK-SEARCH` @ daa64373 (claim 762e7c0f on 10e3c97e, RED 99c140c5) | CLAIM #80 7142322814. Root causes: Ctrl+K had two owners (the layout's useKeyboardShortcuts and KeyAgent's toggle; KeyAgent mounts after the Genome check, so one press opened and shut the palette), and the palette's results were plain buttons. Fix: KeyAgent alone owns Ctrl+K; combobox/listbox/option markup. CPO-01..05; two reviews running | Live C4 once the M8 live run frees the ports (A5); RETURN |
| `wave/v1-docs-p19` (Claude lane) | this branch | Plan corrections (pre-flight, A3), follow-up rows, WORKFLOW-IMPROVEMENTS, this file; status regenerated | Open as a docs PR after M8, or ride the next wave |
| **Antigravity lane** | see #80 and the board | P30 FU-NOTIFICATIONS-PREFS-GUARD claimed (#80 7142239879) on 10e3c97e; P21 W1F-STORE-PAYPAL next; P12 SWP-STORE-LISTING-SERVER (setup-only Release 0 AMEND approved); FU-SEARCH-MONEY-SCOPE (server) proposed | Their wave after M8 |
| **Claude lane, next** | - | P28 FU-CONTACT-PAGES-RAW-STATUS and P31 FU-CONTACT-PANEL-PRUNE (read removal) after M8; FU-CONTACTS-OPEN-DOORS (P29 review: unencoded contactId in send_quote/payment_reminder, focus cards not keyboard-reachable, deals' `/app/crm?contactId=` loses the id); FU-KEY-CTRLJ-OWNERS (new, P32: Cmd/Ctrl+J has the same two owners; its fix makes Ctrl+J open KEY, which the KEY_DISABLED smoke check counts, and nothing in the web hides KEY under KEY_DISABLED, so it needs its own packet and a live check first); FU-ESCAPE-OVERLAYS; P17(a-c) FU-CONTACT-REFUSED-WRITES (with P27's silent refused DELETE); C2 (shard the Windows controls). Pre-flight each (A3) | Claim atomically (CHECKLISTS B1) |
| First lane, as it left them (2026-11-23 ~09:30 UTC) | `wave/v1-wave-3j` a2e9f3f0, `wave/v1-wave-3k` 88268a01; FU-INSIGHTS-SIGHT 28cdbccb; child sessions for FU-STRATEGIC-ROUTES-SIGHT, FU-GENOME-DNA-WRITES-AND-INTEGRITY, FU-GENOME-SURFACES-REVENUE, FU-OUTBOUND-ATTACHMENT-URL, FU-AI-APPROVALS-MONEY-SIGHT | Proven or building when the account stopped; not re-verified since | Re-verify each head before it enters a wave |
| FU-VITEST-DECORATOR-METADATA | @ 83b6dfc8 | Question 20 ruled by D-272.2: the AMEND only if the before/after shows a tightening | Antigravity shows the before/after (board P3) |

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
32. SWP-CONTACT-DETAIL retired the list side panel's tabs (BUG-062). The full contact route has no page for the panel's
    Conversations thread, Deals list, per-contact Audit log or Network graph, nor the rich timeline (health, journey
    CTAs, conversation context, suggested message). Re-home them, or let them go? (Default: let them go for v1; files
    kept until FU-CONTACT-PANEL-PRUNE.) Bulk contact delete has no Undo (its dialog says Trash only): add one?
    (Default: no.)
33. Invite & Earn (the member's own referral link) is every member's in the settings tab strip; Notifications (the
    business's customer emails) is offered to every member in the Me menu while the settings index gates it on
    settings, and its server endpoints have no module guard (FU-NOTIFICATIONS-PREFS-GUARD). Should Notifications be
    settings-only? (Default: yes, with the server guard.)
34. P1 (WORKFLOW-IMPROVEMENTS): move the repository into a free GitHub organization to get the merge queue. P2: run the
    Windows worker proof only when its paths change. (Default: neither until ruled; with C1 and A8, P1 matters less.)
35. GitGuardian is red on every head that carries main's `10e3c97e` (#237 merged over it; M8 #236 holds on it): it flags
    `POSTGRES_PASSWORD` of CI's throwaway Postgres service container, which P24 copied into the sharded job (incident
    32402479; #80 7142554825). Recommended: mark the incidents "test credential / false positive" in the GitGuardian
    dashboard and re-run the check. Or rule that such a finding, confined to main-merge content already on main, does
    not block a wave merge. Or move the password to a repository secret (its own CI packet). (Default: M8 holds.)

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

- Release 0 and the server suite need `.env` loaded in the shell that runs them (`set -a; . ../../.env; set +a`);
  without it a database suite fails to start and R0 is REJECTED for no product reason.
- Never chain proof runs with a waiter that greps a log for words a previous run also printed ("chain finished at"
  matched "previous chain finished at"): another run checked out a different head mid-suite. Run heads in one strict
  sequential script that checks the head before and after each step.
- A container restart stops Postgres and Redis. Check `pg_isready` and `redis-cli ping` before every proof run.
- jsdom cannot show React event timing between the capture and bubble listeners: a menu closed in the capture phase
  passed its unit test and broke every menu item in a browser. Menu, focus and animation changes need the live run.


