# Orchestrator state (live checkpoint)

Last written: 2026-11-28 ~05:05 UTC by the acting orchestrator (`session_017o9EBfFipLMDKriFTiae7Y`, Claude Code), after
M44 merged. Main is `9e0f64c4`. Rewrite in place on every merge, packet return or owner ruling; never append. What you
remove stays in git history and on issue #80.

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

## 0. Current state: the next session starts here (2026-11-28 ~05:05 UTC)

**Control room: issue #273** (continuation of #80, which is full and read-only). Post with `gh api repos/KEYFLOWOS/KEYFLOWOS/issues/273/comments -F body=@<file>`. Wherever this file, CLAUDE.md or the agent-memory docs say "#80" for posting, read #273.

Everything below is on GitHub: this file (branch `wave/v1-docs-p19`), the board (`coord/board`), issues #80 and #273 and the
pushed `pkt/V1-*` branches. No local branch, worktree, log or agent of this session is needed.

**Orchestrator:** `session_017o9EBfFipLMDKriFTiae7Y` (since 2026-11-27 ~00:50 UTC). An hourly scheduled check
(`trig_01HUyoEU9w9zzJBNR3t5qFjL`) runs section 0.5 step 7 in this session.

**State:** main `2e4c7a7b` (M40 #284 merged 2026-11-28 04:58 UTC; M42 #285 at 01:25; Antigravity's M83 and M85 between). V1-STATUS: 269 of 396 done (70.5% of points; launch 179 of 255). Production still runs `f5d58ef7` (16 Nov). Under D-321 the owner redeploys only after every launch-track packet has merged, with ADMIN_EMAIL and ADMIN_PASSWORD_HASH set (D-290); the owner runs the Q50 query (#273 7228553117) before that.

**Board numbering (D-297):** Claude-lane rows number from P200 up; Antigravity keeps its own sequence below 200. Claude
waves are even-numbered, Antigravity's odd. Server follow-ups found in Claude reviews become Antigravity board rows.

### 0.1 Waves this session

**Checkpoint 2026-11-28 05:30 UTC: M40 (#284) and M44 (#295) merged; EXPENSES-HUB-3 is fully on main.**
- EXPENSES-HUB-3 (P221) was RETURNed after 29 repair rounds (#273 7233136312), each round confirmed by two reviews. It is 85 files, over the 50-file divergence gate, so it ships in two waves (WAVE-RUNBOOK 3, no override):
  - M40 = RED (7 changed + 21 new specs) + FIX (18 code files) + docs; merged.
  - M44 = the other 39 specs, tests only; PR #295 @ `db181693`, merged 05:28 UTC after two wave confirmations.
  - M40 + M44 equal `pkt/V1-EXPENSES-HUB-3` @ `f600c545`. Five business-switch guards are pinned only by M44's specs (now on main).
- M40 proof at `782275fa` against `4fc49343`: Release 0 and release0-live passed at both. Journeys H and J have no head-only failures, and the wave fixes H4 (phone), H10 and J6. The receipt sweep passed. Confirmations: two at `e2f5e444` and two merge-delta at `782275fa`.
- **Proof-harness fix:** a leftover `next-server` from a stopped proof held port 5000. `lsof` did not show it, and Playwright's `reuseExistingServer` reused it after `.next` was rebuilt, so every live page got 404s and 500s and stuck on "Verifying session…". Before a proof: `pgrep -f next-server` must be empty and `curl 127.0.0.1:5000` must fail. The proof script now checks both. Never `pkill` a proof without also killing its `next-server`.
- **Main-moves loop:** M85 merged during the first M40 proof (it was already queued before the merge-window request), which forced one more merge and proof. Antigravity ACKed and held after that. Ask for the window when a Claude proof starts, and release it on MERGED.
- **Speed tracker (D-320), running totals:** EH3 took about 33 h from first review to M40's merge (29 rounds; about 1 h of re-proofs for main moves; about 25 min lost to the harness incident). P231 is at about 27 h and 15 rounds. No restart losses since 02:15 UTC.

**Checkpoint 2026-11-28 01:40 UTC: M42 merged (#285, main `f8ed5984`).**
- M42 = WEDGE-HIDE-STORE parts 1 and 2 (P225) + P233 + P248 (server failsafe, Antigravity) + P232 FU-PORTAL-WEB-OPTIONAL-TOKEN + a B5 journey wait (`69bc3d5a`) + docs. Final head `7f3e7c76`.
- Proof under D-313 (suites in CI; Release 0 and live journeys locally), re-run after each main merge (M77, M79, M81): Release 0 and release0-live passed at head and base; live B/F/G failed identical steps at head and base (all pre-existing, P247); G5 passed. Phone B5 was a test race (the step navigated before the save finished): 2 of 4 failed before the wait, 5 of 5 passed with it.
- Confirmations: correctness and security CONFIRMED at `69bc3d5a`; merge-delta correctness and security CONFIRMED at `51b24c01` and at `7f3e7c76` (storefront gate integration 13/13 at each).
- Follow-ups: P253 FU-STORE-GATE-SIDE-DOORS (server, launch-track).
- **Main-moves loop:** main moved during three consecutive M42 proofs, each time pushing the wave past the 50-file divergence gate. Fix used: a merge-window request on #273 (7230989545); Antigravity held its enqueue (ACK 00:43 UTC) until M42 merged. Use the same request for the next Claude wave once its proof starts. Tell the server lane the window is open again after each Claude merge.
- **Speed tracker (D-320), running totals:** M42 took about 10 h from first review to merge (three re-proofs for main moves, about 2.5 h of that). EH3 is at about 30 h and 27 rounds; P231 about 24 h and 13 rounds. Restart losses since 22:33 UTC on 2026-11-27: 0 min (no restart since).

**Earlier checkpoints on 2026-11-27** (M38 merged at 05:53 UTC; M40 #284 is held on EH3 and is rebuilt as EH3 plus docs once EH3 is confirmed twice; the re-cut of the store gate into M42 at 15:55 UTC) are in git history and on #273.

- **Container restarts:** after each, `service postgresql start; service redis-server start`; recover finished reviewers' reports from `subagents/agent-<id>.jsonl`. A proof running across a restart does not count; the resumable proof script (done.txt plus `ran:` markers) skips finished steps.

### 0.2 Claude packets in flight (heads as of this file)

| Packet | Branch @ head | State | Next |
| --- | --- | --- | --- |
| **P221 EXPENSES-HUB-3** | merged (M40 #284 + M44 #295) | done | — |
| **P231 TRUST-BADGES-TRUE-ONLY** | `pkt/V1-TRUST-BADGES-TRUE-ONLY` @ `386318a` | R15 CONFIRMED by both; R16 (six small clip() items + main merge) with worker `session_017o9EBgz5HFUDMDrWzuesH1` | Two reviews of R16, then a wave |

**Cloud workers** (on the `keyflowos` environment, Opus; at most three at once):
- `session_017o9EBhDj4SCaLaHVacciEC`: EXPENSES-HUB-3 (returned; free for the next packet).
- `session_017o9EBgz5HFUDMDrWzuesH1`: P231.
- `session_017o9EBgPURGAKurygwgEU8p`: reviewer (WEDGE work merged). Owner answers D-299 to D-303 were given in this session.

### 0.3 Antigravity (server lane)

Active on #80 and on the board (rows below 200). Server rows Claude raised for them under D-297: P202
RR-ADMIN-API-SIGNIN-KIND (D-291), P203 FU-TODAY-AGGREGATE-TZ-SEED, P204 FU-STORE-ADD-IDEMPOTENT, P205
FU-TODAY-ORDERS-PREMISE, P206 FU-TODAY-APPROVALS-STAFF, P207 FU-TODAY-OVERVIEW-PARITY (absorbs FU-TODAY-PULSE-OVERVIEW), P213 FU-RECURRING-EXPENSE-SERVER (returned 7204446156), P214 FU-TODAY-QUOTE-HREF, P222 FU-RECEIPT-READ-ROUTE (blocks EXPENSES-HUB-3's cross-session leg), P223 FU-REPORTS-DATE-RANGE-STABLE, P226 FU-PUBLIC-BOOKING-GRID, P227 FU-SLOTS-HOURS-READER (merged in M47), P228 FU-PUBLIC-BOOKING-RELEASE-ON-REBOOK, P229 FU-SLOTS-OVERNIGHT-HOURS (owner question 70). Asked on #80 7204091370. P202 returned. Under D-298, Journey I2/I3/I4 are the done condition of P206/P205/P207.

### 0.4 Queue and follow-ups (Claude lane)

- Owner-gated: RR-OWNER-RULINGS-RECORD (docs; answers to OQ-5/13/19/30 and two RR migrations); NAV-B-HIDE needs the
  owner to re-run USAGE-COUNT-SCRIPT on production, and its dependencies SWP-CALENDAR-TRUTH, W11-WEB-INVENTORY-REFUSALS
  and HARNESS-REMOVAL are still todo.
- Web rows on the board: P209 FU-PALETTE-INERT, P210 FU-CONTACT-PAGE-FLAKE, P212 EXPENSES-HUB-1-WEB (the Pay dialog; the plan counts EXPENSES-HUB-1 done on its server half only). P211 was absorbed into TODAY-4BLOCK.
- **Follow-ups found in reviews, not yet in the plan:**
  - FU-KEY-DISABLED-NAV-TODAY, FU-CENSUS-HARDENING, FU-SW-QUEUE-NO-AUTH (request bodies too),
    FU-CONTACT-SOURCE-CHIPS-PLAIN (raw `source` on the timeline and notes, ai-insights `bestChannel`/`trend`).
  - **Smaller items:**
    - the CRM walkthrough targets hidden while the panel is closed (P98 MINOR-2);
    - "Highest Revenue" sort and the High Value/Unpaid chips shown to every CRM viewer (already on main; a D-100 check);
    - the `store-tab-deep-links` mock lacks `canSave*`/`listingRefused`;
    - P28's C6 detector checks leaf HTML elements only.
  - **Carried:** SEC-CJ-1 and COR-CJ-1 (Ctrl+J); an invoice-for-customer URL; app-wide `h-5.5`/`h-4.5`; the bottom-bar
    clearance (question 46); `pwa-install-prompt` via `lib/install-prompt`; the server `getInventory` money projection;
    bulk product delete has no audit or events; https-only image links on the server DTO; refund-door scope gating;
    dead ContactDetail header actions; other Your page counters use the old sum; /book name-dedupe hides a listed
    product; delete `next-actions-widget.tsx`; dark-mode `bg-white` dashboard cards; FU-REFRESH-AFTER-SIGNOUT; add
    `seed-workspace-session.spec.ts` to CI's mocked list; the PKCE verifier's `Math.random` fallback.

### 0.5 Resume recipe for the Claude lane (any account or AI)

1. **Read the live state.**
   - #80 since this file's time (`gh api 'repos/KEYFLOWOS/KEYFLOWOS/issues/80/comments?per_page=100&since=<ISO>'`).
     `gh issue comment` is refused from cloud sessions (GraphQL): post with
     `gh api repos/KEYFLOWOS/KEYFLOWOS/issues/80/comments -F body=@<file>`.
   - The board: `git show origin/coord/board:BOARD.md`.
   - `git ls-remote origin 'refs/heads/pkt/V1-*' 'refs/heads/wave/*'`.
2. **Finish a packet:** read its RETURN or PACKET REPORT on #80. If it has not returned, check out the pkt branch and
   follow PACKET-WORKER-BRIEF.md. Claims are an atomic empty-commit push (CHECKLISTS B1) plus a CLAIM on #80.
3. **Assemble a wave:**
   1. `git worktree add -b wave/v1-wave-<N> <dir> origin/main`, and copy the main checkout's `.env` in (local DB and
      Redis URLs only; no secrets).
   2. For each packet: `COMMIT_TRAILER=... scripts/agent-memory/compact.sh pkt/V1-<branch> <PACKET-ID> web`. When two
      packets conflict, squash-merge by hand and split the tests (RED) and fix commits the same way compact.sh does.
   3. `git merge --squash origin/wave/v1-docs-p19`, committed as `docs: wave/v1-docs-p19 (compacted) at <sha>`. Check
      that no file has conflict markers: `git grep -n '^<<<<<<< ' HEAD`.
   4. Verify every packet file equals its pkt tip, or a clean 3-way merge you inspect (`git merge-file`).
   5. `scripts/check-branch-divergence.sh origin/main HEAD --max-commits 25 --max-files 50`.
4. **Wave proof** (one strict sequential script that checks the head before and after each step):
   - **Fresh container:** run SECOND-ACCOUNT-SETUP.md's setup script, then create `keyflowos_e2e`, alias the
     Playwright browsers and write `~/.kf-e2e-jwt-secret` (LIVE-PROOF-RUNBOOK §0).
   - **Turbo trap:** in a second worktree, `pnpm db:generate` can be a turbo cache hit replayed from another worktree,
     leaving `@prisma/client` empty. Use `TURBO_FORCE=1 pnpm db:generate`, or
     `cd packages/db && npx prisma generate --schema=./prisma/schema.prisma`.
   - **`next typegen`** needs `NEXT_PUBLIC_API_BASE_URL` set (as CI sets it), or tsc reports TS2688 and checks nothing.
   - **Server:** `pnpm install --frozen-lockfile`, prisma generate, build the packages, server `tsc --noEmit`,
     `NODE_OPTIONS=--max-old-space-size=8192 pnpm --filter server build`, `vitest run` with `.env` loaded,
     `pnpm proof:release0 -- --skip-build`. Avoid 02:00 to 04:00 UTC, or expect today-aggregate TD-01/02 to fail (0.3).
   - **Web:** `next typegen` + `tsc --noEmit`, `vitest run --minWorkers=1 --maxWorkers=2`, `pnpm lint --max-warnings 26`.
   - **Mocked build** (`NEXT_PUBLIC_API_BASE_URL=http://api.test.local`), then the 3 CI e2e specs and any mocked sweeps.
   - **Live** per LIVE-PROOF-RUNBOOK §3, API on 3001 against `keyflowos_e2e`: release0-live, the touched journeys and
     sweeps, and always a base run on main. Prove a flaky failure by re-running it alone at head and base.
5. **PR and merge:** open the PR with `gh api -X POST repos/KEYFLOWOS/KEYFLOWOS/pulls` (mirror PR #254). Two wave
   confirmations. When every required check is green at the exact head and the PR is mergeable, ENQUEUE with
   `gh api -X PUT repos/KEYFLOWOS/KEYFLOWOS/pulls/<n>/ccr/auto_merge -f merge_method=merge`. Never merge directly;
   never push to main. A failed job gets one re-run, after its run completes. If the queue dequeues it, find the root
   cause; if the base moved and the PR conflicts, merge main into the wave branch (no rebase or force-push).
6. **After a merge or return:** `node scripts/agent-memory/status.mjs` (commit, then `--ref HEAD` and amend), rewrite
   this file in place, update the board row, post on #80.
7. **Recreate session-only things** (they do not survive a session):
   - **An hourly #80 check:** a scheduled task bound to the new orchestrator session. This session's is
     `trig_01HUyoEU9w9zzJBNR3t5qFjL`. Delete it if you take over; it fires into this session.
   - **A PR subscription** for each open wave PR.
   - **Cloud workers:** tell each one, by `send_message` or on #80, the new orchestrator session id.
   - **After a container restart:** `service postgresql start; service redis-server start`. Results from background
     reviewers that finished during a restart are in their transcripts, under
     `~/.claude/projects/<project>/<session>/subagents/agent-<id>.jsonl`. Look for the last SubagentHandback tool call.
   - **Reviewers:** give each one its own worktree and scratch space inside it, never a shared `/tmp` path (two
     reviewers collided there on 2026-11-26).


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
- **D-286 to D-290** reached main with M22's docs squash (merged 2026-11-26). Each is
  on #80 (OWNER RULINGS 7178159751; D-290 7178888690). Summary in section 4's last paragraph.
- **D-291 to D-298** (owner answers to questions 57 to 63, 2026-11-26) are on main (docs squashes of M30 onwards). D-291 `/api/admin/*` requires the admin sign-in (server packet P202);
  D-292 favorites strip and duplicate banner stay above the search; D-293 CLIENT reads "Client"; D-294 a tab reads
  KEY_DISABLED once, until reload; D-295 Release 0 AMEND of WOS-C01's final assertion only (TODAY-4BLOCK); D-296 the
  role presets stay read-only; D-297 board numbering and server rows for Antigravity; D-298 (owner question 63) Journey I2/I3/I4 leave TODAY-4BLOCK for P206/P205/P207.
- **P12 setup-only Release 0 AMEND approved** (owner, relayed on #80 7136747457).
- **The merge queue is on for main** (D-278, ruleset 28066634). Lanes enqueue and never merge directly. From a cloud
  session, GraphQL is refused: enqueue with `gh api -X PUT repos/KEYFLOWOS/KEYFLOWOS/pulls/<n>/ccr/auto_merge -f
  merge_method=merge`.

## 3. Work in flight (what git on main cannot show)

Main is at `c1ea190d`. Production runs `f5d58ef7` (16 Nov), far behind main; the owner redeploys (D-266).

| Work | Branch / head | State | Next action |
| --- | --- | --- | --- |
| **Claude packets** | section 0.2 | Reviews, repairs, two returned | RETURNs, then the next Claude wave |
| **Antigravity** | their claims on #80 (0.3) | Building and merging (M25 to M31 merged) | Their waves; board rows P202 to P207 |
| **Owner** | - | - | Section 4 question 50 (production data); USAGE-COUNT-SCRIPT re-run for NAV-B-HIDE; production redeploy (D-266) with ADMIN_EMAIL and ADMIN_PASSWORD_HASH set (D-290) |
| `wave/v1-docs-p19` | main `c1ea190d` merged in | This file and V1-STATUS | Squashed into each Claude wave |

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


50. **USAGE-COUNT-SCRIPT for SWP-FIN-OVERVIEW-TRUTH.** The plan asks for the count of live businesses with DRAFT or APPROVED payroll runs. That needs production data, so only you can run it. (Default: run it before the production redeploy.)




**Ruled 2026-11-27 (D-309 to D-312, the orchestrator session):** 43 = D-309 (bookings or store write), 49 = D-310 (payroll is money), 70 = D-311 (overnight hours supported, P229), 66 = D-312 (case studies unpublished).

**Ruled 2026-11-27 (D-307, D-308, #273 7224705459):** 74 = D-307 (2-hour default after a notification; never irreversible), 75 = D-308 (no deferring minors).

**Ruled 2026-11-27 (D-304, D-305, #273 7215057644):** 72 = D-304 (gate the checkout, not the listing), 71 = D-305 (seed a past order in journey G).

**Ruled 2026-11-27 (D-299 to D-303, #273 7208594106 and 7209041016):** 65 = D-299, 67 (store gate) = D-300, 42 = D-301, 54 = D-302, 66 first half = D-303.

**Ruled 2026-11-26 (D-298, #80 7189605548):** 63 = D-298.

**Ruled 2026-11-26 (D-291 to D-296, #80 7188960928):** 57 = D-291, 58 = D-292, 59 = D-293, 60 = D-294, 61 = D-295, 62 = D-296.

**Ruled 2026-11-25/26 (D-286 to D-290, #80 7178159751 and 7178888690):** 52 (P90 gates all 46, Option A) = D-286; 51 and 55 (refunds stay as built; FU-REFUND-GATEWAY-REFUSE withdrawn) = D-287; 56 (only an OWNER changes owner alerts) = D-288; 53 (CONTACTS-LIST-FIRST, list first on phones, cards collapsed on desktop) = D-289; the Owner Console only via the separate admin sign-in = D-290 (owner step: set ADMIN_EMAIL and ADMIN_PASSWORD_HASH in production before the redeploy).

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

- Lessons from 2026-11-25/26: two packets confirmed alone can still clash in a wave, so never skip the wave proof;
  match tests on href or exact names, not link text; a container restart kills local agents (read their transcript's
  last report, then use fresh reviewers); the server build needs an 8 GB heap; when main moves while a wave PR waits,
  merge main in (a push cancels the old CI run, whose verdict then fails closed); after any docs merge, grep for
  conflict markers before committing (`git grep -n '^<<<<<<< '`): one slipped into this file on 2026-11-26.
