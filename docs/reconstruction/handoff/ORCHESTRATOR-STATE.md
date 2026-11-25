# Orchestrator state (live checkpoint)

Last written: 2026-11-25 ~01:10 UTC by the acting orchestrator (second-lane account, Claude Code), after the repository moved to the KEYFLOWOS organization (D-278). Rewrite in place on every merge, packet return
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
- **D-275 to D-279** (2026-11-24, the owner in chat, question by question with research; #80 7143988551, 7144117000):
  - D-275 (Q35): GitGuardian's CI test-database password was tagged a test credential (done; M8 merged on it), and CI's
    throwaway Postgres went password-less (FU-CI-PG-NO-PASSWORD, P36, in M9). Remove a false-positive literal; never
    suppress the detector.
  - D-276 (Q33): the Me menu's Notifications only for settings readers (FU-ME-NOTIFICATIONS-SCOPE).
  - D-277 (Q32): the conversation thread moves into the contact Timeline with a channel filter
    (FU-CONTACT-TIMELINE-CHANNELS); Deals, per-contact Audit and Network go for v1. D-277b: bulk delete gets Undo by a
    one-call restore from Trash (FU-BULK-DELETE-UNDO).
  - D-278 (Q34 P1): after M8, the owner moves the public repo into a free GitHub organization for the merge queue
    (FU-CI-MERGE-QUEUE); D-239 then reads "enqueue once both reviews accept; the queue merges when CI passes on the
    combined head".
  - D-279 (Q34 P2): the Windows worker proof always reports but runs in full only when its inputs changed against the
    merge base (and nightly), sharded (FU-CI-WINDOWS-INPUT-GATE + C2).
- **P12 setup-only Release 0 AMEND approved** (owner, relayed on #80 7136747457): SWP-STORE-LISTING-SERVER may amend
  its Release 0 suite's setup only; assertions unchanged.

## 0. Next session starts here (2026-11-25 ~01:10 UTC)

**The repository moved (D-278): it is now `KEYFLOWOS/KEYFLOWOS`** (old `SaCH-PRO/KEYFLOWOS` URLs redirect; issue #80 and
all PRs moved with it; the owner reinstalled the Claude, GitGuardian and Vercel apps on the organization). The session
that wrote this could push through the redirect but could no longer reach the GitHub API, so these were NOT posted on
#80 and must be posted first by the next session (bodies below are summaries; evidence is in git):
1. **MOVED** note on #80: the new address; Antigravity to use `KEYFLOWOS/KEYFLOWOS` and start **FU-CI-MERGE-QUEUE**
   (board P38) now that the transfer is done; docs references to `SaCH-PRO/KEYFLOWOS` (CLAUDE.md, AGENTS.md,
   agent-memory docs, scripts using `gh ... --repo SaCH-PRO/KEYFLOWOS`) to be updated in a docs packet.
2. **RETURN SWP-REMOVED-MEMBER-NOTICE** (`pkt/V1-SWP-REMOVED-MEMBER-NOTICE` @ `21defe66`, stacked on P35 `2c3ef7ab`):
   - Commits, tests first: claim cad5a47b; RED c09a8ee7 (RMN-01..08, RBN-01..07, e2e/sweep-removed-member.spec.ts);
     harness e753a547, 3601a9d6 (the notice mocked as its own module, so the R0-06 proof use-genome-gate.test.ts is
     untouched); fix 1be13828; security round tests 77c8e356 -> fix b5c7ded8; pins a7a30d02, 096b9a20, ee5ec5e0
     (RMN-12..14, RMN-15 RED); fix 21defe66 (sign-in/out clear the notice silently).
   - Files: lib/workspace.ts, lib/removed-business-notice.ts (new), hooks/use-genome-gate.ts,
     components/layout/removed-business-notice.tsx (new), app/app/layout.tsx; tests workspace-removed-member.test.ts,
     components/layout/__tests__/removed-business-notice.test.tsx, hooks/__tests__/use-genome-gate.removed-notice.test.tsx,
     e2e/sweep-removed-member.spec.ts. Write set departure (declared): the notice module and the gate test file.
   - Suites: full web 214 files / 1,916-1,917 tests at 096b9a20 (mine and both reviewers); tsc 0; eslint clean;
     the touched set 64/64 at 21defe66.
   - Live (local e2e DB): base 2c3ef7ab RED (sweep: no notice; J8: "a lasting notice that they were removed",
     silently in their own empty workspace = BUG-117); head 096b9a20 GREEN: sweep-removed-member 1 passed, journey J8
     1 passed, release0-live 1 passed. Not re-run at 21defe66 (delta: silent dismissal at sign-in/out + one test).
   - Reviews: security REJECT at 1be13828 (MAJOR-1 shared-device leak: the notice was not bound to its person) ->
     ACCEPT WITH MINORS at 096b9a20 (m1, m2 pinned in ee5ec5e0: RMN-13, RMN-14); correctness ACCEPT WITH MINORS at
     1be13828 and 096b9a20 (R-MINOR-1 sign-out announcing -> fixed 21defe66 with RMN-15; R-MINOR-2 pinned RMN-14;
     R-MINOR-3 recorded: a sign-in over another account's leftover user cache while the list read fails loses the
     fresh business id until the next refresh; MINOR-3 recorded: no notice when /identity/me fails at that moment,
     the deliberate fail-quiet side of the same-person guard). **Both reviewers should confirm 21defe66 (small delta)
     before the RETURN is final.**
3. Then: M11 (Claude, wave 3q) after M9 (#238) and M10 merge: P27, P29, P32, P35, SWP-REMOVED-MEMBER-NOTICE.

Local-only state of the old session (scratchpad, NOT needed to continue): live run scripts and logs. Everything needed
is pushed: packet branches, `coord/board`, this branch.

## 3. Work in flight (what git on main cannot show)

Main is at `892bb0dd` (2026-11-25): M8 PR #236 (wave 3p: P13, P19, P23/C1, P20, P26) after M7a PR #237 (10e3c97e,
Antigravity). Production runs `f5d58ef7` (16 Nov), far behind main: the owner redeploys (D-266). The second-lane account
acts as orchestrator and posts on #80; Antigravity works in tandem under the split agreed on #80 (7142635342, ACK
7143076311; COORDINATION 2 7144774208, ACK 7145311083): Antigravity takes server packets and the server halves of
"both" packets, Claude takes web packets and stacks the web halves. Who holds which row: `BOARD.md` on `coord/board`.
Wave order: M9 (#238, Antigravity) > M10 (Antigravity) > M11 (Claude, wave 3q).

| Work | Branch / head | State | Next action |
| --- | --- | --- | --- |
| **M9 (Antigravity)** | PR #238 `wave/v1-wave-m9`: P36 FU-CI-PG-NO-PASSWORD, P6a, P4, P17(d), P30, P33 | CI green on its base 10e3c97e (GitGuardian green thanks to P36) | Antigravity merges main 892bb0dd in, re-runs CI, merges (D-239/D-272) |
| **Claude lane, returned (M11)** | P27 `pkt/V1-FU-CONTACT-DELETE-LEAVE` @ 6f2cf8df; P29 `pkt/V1-FU-C4-FOCUS-OPEN` @ cdf2ac66; P32 `pkt/V1-FU-C4-CMDK-SEARCH` @ d9a436f0; P35 `pkt/V1-W11-WEB-OWNER-MEMBERSHIP-REFUSAL` @ 2c3ef7ab | All returned with two reviews accepted (#80 7140922048, 7142275052, 7144766888, 7144767176). C4 live: list and Cmd/K steps green on P29+P32; it now stops at "from Today" (FU-C4-TODAY-LINK) | Assemble wave 3q after M10 (compaction, divergence gate, wave-head proof) |
| **Claude lane, next** | - | SWP-REMOVED-MEMBER-NOTICE built (section 0: RETURN pending); P37 FU-BULK-DELETE-UNDO web half on Antigravity's server half `61e50c0f`; P42 FU-C4-TODAY-LINK (pre-flight; server half to Antigravity if server-side); P40 FU-ME-NOTIFICATIONS-SCOPE after M9; P39 FU-CI-WINDOWS-INPUT-GATE + C2; P41 FU-CONTACT-TIMELINE-CHANNELS after P46; P34 FU-KEY-CTRLJ-OWNERS (live check first); P28, P31, P18a, P17(a-c) | Claim atomically (CHECKLISTS B1), pre-flight first (A3) |
| **Antigravity lane** | see #80 and the board | Returned: P43 MIGRATION-SET-A (fcb83115), P37 server half (61e50c0f), P44 TOF-FINANCE-CANONICAL-TOOLS, P45 SWP-INV-DETAIL server half; claimed P46 WEDGE-WA-INBOUND-CAPTURE server half; M10 = P6b + P3 | Their waves M9, M10 |
| **Owner** | - | D-278 done: the repository is `KEYFLOWOS/KEYFLOWOS`; apps reinstalled on the organization | Antigravity's FU-CI-MERGE-QUEUE (P38) |
| `wave/v1-docs-p19` (Claude lane) | this branch | Plan rows, WORKFLOW-IMPROVEMENTS, this file; status regenerated; over the 25-commit divergence cap, so compact before it ships | Docs PR in M11, compacted |
| First lane, as it left them (2026-11-23 ~09:30 UTC) | `wave/v1-wave-3j` a2e9f3f0, `wave/v1-wave-3k` 88268a01; FU-INSIGHTS-SIGHT 28cdbccb; child sessions for FU-STRATEGIC-ROUTES-SIGHT, FU-GENOME-DNA-WRITES-AND-INTEGRITY, FU-GENOME-SURFACES-REVENUE, FU-OUTBOUND-ATTACHMENT-URL, FU-AI-APPROVALS-MONEY-SIGHT | Proven or building when the account stopped; not re-verified since | Re-verify each head before it enters a wave |

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


