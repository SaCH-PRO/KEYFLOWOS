# V1 board (live; branch `coord/board`)

**One owner per row.** This is the one place that says who does what next. It is not the plan of record: that is
`docs/reconstruction/V1-PLAN-RECUT.json`, under the rulings. The checklists each row follows are in
`docs/development/agent-memory/CHECKLISTS.md`.

## How lanes work together

- **Lanes.** A lane is a tool that can run git and push.

  | Lane | Who | Strengths |
  | --- | --- | --- |
  | `claude` | Claude Code | — |
  | `antigravity` | Gemini in Antigravity, driven by the owner | Docker, a full local install |

  Any other tool that can push (Gemini CLI, Codex, Kimi Code CLI) joins by adding a row to the table above.
  ChatGPT, or Kimi and Gemini in a browser, are **advisors**: the owner pastes them a RETURN, and the finding comes
  back as an advisory REVIEW on #80 (CHECKLISTS F).
- **Editing the board.** Edit only your own rows, and the `owner` cell of an unowned row you are claiming.
  - Pull, edit, commit, push: `git pull --rebase origin coord/board`, then push.
  - If two lanes claim the same row, the earlier CLAIM comment on #80 wins.
- **Messages on #80.** Each one starts with its type in bold and names the board row id.

  | Type | When |
  | --- | --- |
  | **CLAIM** | Taking a row |
  | **DELEGATE** | The owner, or a lane with the owner's go, gives a row to a lane. The receiver ACKs it |
  | **HANDOFF** | Stopping; the next step is in the row |
  | **RETURN** | A packet is done |
  | **PROGRESS** | A wave or merge step is done |
  | **BLOCKED** | Waiting on the owner or another row |
  | **REVIEW** | A finding, including advisory ones |

- **Every session starts with CHECKLISTS A**, and ends with E if it may not come back.
- **Status values:** `todo`, `claimed`, `red`, `fixed`, `in-review`, `returned`, `pr-open`, `merged`, `blocked`.

## Merge order (D-272: one at a time, CI green at the exact head, CHECKLISTS D)

| # | Row | What | Owner | Status | Waits on | Next step |
| --- | --- | --- | --- | --- | --- | --- |
| M1 | PR #228 | `wave/v1-wave-3j` | antigravity | **merged** (142e5f9e) | — | Done |
| M2 | Rulings, **PR #230** | `wave/v1-rulings-3n` @ d03252e1 | claude | **merged** (05f04f2c) | — | Done. The plan of record on main now carries the wedge re-cut and D-263..D-272 |
| M3 | Wave 3m, **PR #229** | `wave/v1-wave-3m` @ 6bb8b430 | claude | **merged** (f6764f4c) | — | Done: MOUNT-QUOTES, SWP-INV-MATH, SWP-INV-PUBLIC-LINK, SWP-QUOTE-PUBLIC-PAGE, SWP-INV-FORM-UX, SWP-QUOTE-COMPOSER-CONTACT are on main |
| M4 | Wave 3j split (**PR #232** + **PR #234**) | M4a `054cac4b` (8 pkts) + M4b `edd2fa15` (7 pkts, 24/24 CI green, R0 39/39 MET, web full exit 0, 2 wave reviews CONFIRMED) | antigravity | **merged** (`054cac4b`, `edd2fa15`) | — | Done — M5 (PR #233) is clear |
| M5 | Wave 3n, **PR #233** | `wave/v1-wave-3n` @ 5c8bcd9b (main edd2fa15 merged in): SWP-CONTACT-QUICKADD, SWP-INV-LIST | claude | **merged** (f664a411) | — | Done (#80 7138950050). Head pinned, CI green at the exact head, packet and Codex-repair reviews accepted |
| M6 | Wave 3o, **PR #235** | `wave/v1-wave-3o` @ bb532b7d (carried wave 3n, A8): NAV-A3, NAV-A2, SWP-KEY-CHAT-WEB | claude | **merged** (c7fb73eb) | — | Done (#80 7138950050). First A8 merge: merge-tree of main f664a411 and the head gave the head's own tree. One local proof at bb532b7d: server 844 files / 15551 tests, R0 MET, web 208/1881 |
| M7 | Wave M7a **PR #237** | `wave/v1-wave-m7a` @ `29bbdba2` (P24 CI sharding, P25, P12 unblocks 51, P9, P1, P2) | antigravity | **merged** (`10e3c97e`) | — | Done (#80 7142239879). CI verdict 13m + Windows 58m18s green at exact head; M8 (`PR #236`) CLEAR TO MERGE (`merge-tree` 0 conflicts). Next Antigravity waves after M8: `M9` (`wave/v1-wave-m7b` @ `ab3cb65b`: `P6a+P4+P17d`), `M10` (`P6b+P3`), `M11` (`P5` x3 + `P30`) |
| M8 | Wave 3p, **PR #236** | `wave/v1-wave-3p` @ 0b9a4d65 on main c7fb73eb: P13, P19, P23 (C1), P20, P26 (10 commits, 24 files) | claude | pr-open | M7 (D-272 order; no file overlap: see #80) | CI running early (A2); wave-head proof running (server suite + R0, web, agent-control, live sweep + journey C + release0-live). Its Windows job is C1's first real timing |

## Packets and tasks

| Row | Item | Owner | Status | Waits on | Next step |
| --- | --- | --- | --- | --- | --- |
| P1 | SEC-KEY-CUSTOM-LOGIC (P0, D-272.4): tenant KEY's `execute_custom_logic` runs JS in a child process on the API host | antigravity | merged | — | Merged in M7a PR #237 (`10e3c97e`) |
| P2 | Switch off the agent-control autopilot's #80 posting (D-272.4) | antigravity | merged | — | Merged in M7a PR #237 (`10e3c97e`) |
| P3 | FU-VITEST-DECORATOR-METADATA (Q20, D-272.2 / D-273) | antigravity | returned | — | Returned #80 (7139757949) @ `7d830b5b` (D-273 R0 AMENDs `8508da0b` + static import `7d830b5b`; 843/843 server suites, 107/107 R0 `3,738/3,738` + 39/39 manifests exact-head SATISFIED, tsc 0, eslint 0 errors, both Final Reviews CONFIRMED); ready for M7 |
| P4 | FU-OUTBOUND-ATTACHMENT-URL (D-272.3) | antigravity | returned | — | Returned #80 (7121498630) @ `41e1a419` (RED `597b953b`, 7/7 84/84, tsc 0, both confirmation reviews CONFIRMED) + D-265 exact-head `proof:release0` 39/39 SATISFIED — R0 EXIT GATE MET |
| P5 | First-lane WIP: FU-STRATEGIC-ROUTES-SIGHT, FU-GENOME-DNA-WRITES-AND-INTEGRITY, FU-AI-APPROVALS-MONEY-SIGHT | antigravity | returned | — | 3/3 returned: `AI-APPROVALS` (#80 7121845152 @ `a0c650a6`), `STRATEGIC-SIGHT` (#80 7122456412 @ `b474ec39`), `DNA-WRITES` (@ `f616cf67`, both reviews CONFIRMED 0 findings; `SEC-DW-3a` flagged for R0 AMEND on `D11G-G04`). P6 unblocked |
| P6 | FU-PENDING-OWED-SERVER, then FU-PENDING-OWED-WEB (money-first, P0, D-256) | antigravity | returned | — | 2/2 RETURNED: `FU-PENDING-OWED-SERVER` (#80 7127921193 @ `ae4bf75f`, 834/834 server, R0 39/39 MET, 2 R3 reviews CONFIRMED) + `FU-PENDING-OWED-WEB` (#80 7130066870 @ `d645c31f`, 182/182 web / 1,720 passed, tsc 0, eslint 25/26, 2 R3 reviews CONFIRMED) |
| P7 | SWP-CONTACT-QUICKADD (BUG-009, 034, 035; journey C1's New > Contact): `pkt/V1-SWP-CONTACT-QUICKADD` @ d859ba0f, stacked on wave 3m. Two reviews + confirmation ACCEPT WITH MINORS. Live at d859ba0f: sweep 2/2, C1 and C3 green both widths (red at the base), release0-live green; C4/C6/C8 red at the base too | claude | returned | M3 | Enters the next wave after M3 (main merged in, wave-head proof) |
| P8 | SWP-INV-LIST (P0; BUG-007, 050, 070, 089, 131, 047): `pkt/V1-SWP-INV-LIST` @ 388925d9, stacked on P7. Reviews and three confirmations closed (final ACCEPT WITH MINORS). Live at 049fe735: sweep 2/2 (dark and light), D8, E3, E11 green both projects (red at the base), release0-live green; web 199/1808; tsc --types node 0 | claude | returned | M3 | Enters the next wave with P7 after M3 (main merged in, wave-head proof) |
| P9 | FU-WEB-PAYLINK-STATUS-BUTTONS (P0, size S, web; D-256 / D-248) | antigravity | merged | — | Merged in M7a PR #237 (`10e3c97e`) |
| P10 | NAV-A3 `pkt/V1-NAV-A3` @ 6dff1113 **RETURNed** (#80 7132240611); NAV-A2 `pkt/V1-NAV-A2` @ ca84aec4 **RETURNed** (#80 7133214989): RED ab188d95, 84585d9c; fix ac38b1e0, ca84aec4; reviews ACCEPT WITH MINORS x2 + repair ACCEPT; live H: 19 'Money offers' findings at base -> 0, H2 green both projects. Plan: SWP-KEY-SHELL-SMOKE owns the index's KEY entry (docs-p19 c8afd062). Wave note: the two conflict only in 2 guard-spec exemption lists (keep both deletions) | claude | returned | — | one claude wave (NAV-A3 + NAV-A2) after M4a, M4b, M5 |
| P11 | SWP-KEY-CHAT-WEB `pkt/V1-SWP-KEY-CHAT-WEB` @ 65ec17e6 **RETURNed** (#80 7134257288): fix 2c6fe0f0 + root fix 3806dd79 (loadSessions stable: no loop in the drawer or /app/key/chat); confirmation REJECT at 2c6fe0f0 closed; reviews ACCEPT WITH MINORS (all closed). Live: sweep 2/2 and A3 2/2 RED at base, green at head | claude | returned | — | in wave 3o (M6) |
| P12 | SWP-STORE-LISTING-SERVER (unblocks 51, including DECIMALS-SERVER and CLAIM-LOOP) | antigravity | merged | — | Merged in M7a PR #237 (`10e3c97e`) — 51 downstream packets now UNBLOCKED (`QualificationService` logged as `FU-QUALIFICATION-LISTING-MEMBERSHIP`) |
| P13 | FU-BILLING-TEMPLATES-GUARD `pkt/V1-FU-BILLING-TEMPLATES-GUARD` @ 0a57e48b **RETURNed** (#80 7135012909): RED b1fd71d6, fix bac5e57d, review repairs cb48305a/0a57e48b; both reviews ACCEPT WITH MINORS (closed) | claude | returned | M3 | In M8 (PR #236) |
| P16 | Follow-up rulings docs, **PR #231**: **merged** as 04730333 (#80 7131306748). Open wording minors and the state rewrite ride `wave/v1-docs-p19` @ e63d5dea | claude | merged | — | wording minors on wave/v1-docs-p19; PR it with the next docs batch |
| P17 | Re-cut by pre-flight (#80 7134656316): (a,b,c) FU-CONTACT-REFUSED-WRITES (web: 16 call sites in use-contact-actions.ts ignore error) -> claude, after M5; (d) FU-KEY-CONTACT-NAME (server: flow-orchestrator.service.ts:5036/5074/5103, contactDisplayName; R0 anchors untouched) -> antigravity proposed; (e) dropped (link never rendered) | claude / antigravity (d) | split | P7 merged | claude takes (a,b,c) after M5 merges; antigravity **RETURNed** (d) #80 (7140298414) @ `c4a11da6` (RED `0f3eba54`, fix `c4a11da6`, 4/4, tsc 0, eslint 0, both reviews CONFIRMED) |
| P18 | Re-cut by pre-flight: (a) FU-ESCAPE-OVERLAYS (web: keydown respects defaultPrevented, handleEscape no-ops under an open dialog/menu, mobile-gesture-provider.tsx:64, redirect-source landing) -> claude; (b),(e) accurate; (c,d) held until FU-PENDING-OWED-WEB merges (invoices/page.tsx) | claude | split | P8 merged | FU-ESCAPE-OVERLAYS after SWP-CONTACT-DETAIL |
| P19 | FU-SETTINGS-MANUAL-STEP-FENCE `pkt/V1-FU-SETTINGS-MANUAL-STEP-FENCE` @ 7bf15068 **RETURNed**: RED 8890f90c, fix df0b5d0c, review round 1 f8c9b9b5/7bf15068 (outcomeUnknown shared, mark on any numbered answer); reviews ACCEPT WITH MINORS x2, repair ACCEPT | claude | returned | — | In M8 (PR #236) |
| P20 | SWP-CONTACT-DETAIL (BUG-127/128/129/062, journey C) `pkt/V1-SWP-CONTACT-DETAIL` @ f1a409e3 **RETURNed** (#80 7138884562): live sweep RED at base per step, green at head; both reviews ACCEPT (acceptance after a REJECT for the missing sweep, A9) | claude | returned | — | In M8 (PR #236) |
| P21 | W1F-STORE-PAYPAL (lane both; plan corrected 21806719) | antigravity | todo | NAV-A2 (M6), FU-PENDING-OWED-WEB | ACKed (#80 7135441240); start after NAV-A2 (M6) and FU-PENDING-OWED-WEB (M7) merge |
| P22 | FU-OVERLAY-LAYER-TABLE (size L; plan corrected 21806719) | — | todo | open waves | alone, after the open waves |
| P23 | FU-CI-NC-WORKTREE-REUSE (D-274 C1) `pkt/V1-FU-CI-NC-WORKTREE-REUSE` @ fbb45c2e **RETURNed** (#80 7138157579): equivalence over the 323-control manifest 0 differences (1,125 s -> 169 s locally); five gate-safety review rounds (A10), final ACCEPT + confirmation ACCEPT | claude | returned | — | In M8 (PR #236); then C2 (shard the Windows controls) |
| P24 | CI C3+C4+C5 (ci-cd.yml: shard server vitest 4 ways; split run-manifests/release0/web steps into parallel jobs in ci-verdict needs; drop needs: typecheck) ~23 min | antigravity | merged | — | Merged in M7a PR #237 (`10e3c97e`) — live CI verdict cut from 35m+ to 13m |
| P25 | FU-PLANNER-STEP-ORDER (key-cortex-planner.service.ts + sibling aiPlan include steps with no orderBy: CI flake, found by M4b) | antigravity | merged | — | Merged in M7a PR #237 (`10e3c97e`) |
| P26 | FU-NAV-A3-CODEX-235 (Codex P2s on #235: a slug taken for an id in breadcrumbs; the settings tab strip shown to every member) `pkt/V1-FU-NAV-A3-CODEX-235` @ 7ef3b70c **RETURNed** (#80 7137156301); both reviews ACCEPT | claude | returned | — | In M8 (PR #236) |
| P27 | FU-CONTACT-DELETE-LEAVE `pkt/V1-FU-CONTACT-DELETE-LEAVE` @ 6f2cf8df **RETURNed** (#80 7140922048): each single delete keeps its own timer, toast and state; both reviews ACCEPT; C7 live green | claude | returned | — | Next Claude wave |
| P28 | FU-CONTACT-PAGES-RAW-STATUS (web, M: raw stored statuses on the contact route pages) | claude (proposed #80 7136931971) | todo | M8 | Pre-flight (A3), claim |
| P29 | FU-C4-FOCUS-OPEN `pkt/V1-FU-C4-FOCUS-OPEN` @ cdf2ac66 **RETURNed** (#80 7142275052): focus cards, the queue's view and call/task actions open the customer page (task -> Tasks); both reviews ACCEPT; C4 list step live green, R0 live green (Cmd/K step is P32) | claude | returned | — | Next Claude wave |
| P30 | FU-NOTIFICATIONS-PREFS-GUARD (server, S, P1: customer-preferences and customer-log have no module guard) | antigravity | returned | — | Returned #80 (7142538415) @ `3f027f65` (RED `4a7a5006`, fix `3f027f65`; real-DB `notifications-prefs-guard` 6/6 + `timeline-scope` 46/46 = 52/52, tsc 0, eslint 0, both reviews CONFIRMED) |
| P31 | FU-CONTACT-PANEL-PRUNE (web, S: the side panel still reads health, journey, conversation context and cross-journey for the retired tabs; acceptance CDC-5 and Codex P2 on #236) | claude | todo | M8 | The read removal does not wait on owner question 32 (only re-homing the panels does): pre-flight, claim after M8 |
| P32 | FU-C4-CMDK-SEARCH `pkt/V1-FU-C4-CMDK-SEARCH` @ d9a436f0 **RETURNed** (#80 7144766888): Ctrl+K one owner (KeyAgent), results are options; both reviews ACCEPT; C4 Cmd/K step live green (stacked on P29) | claude | returned | — | M11 |
| P33 | SWP-STORE-OVERSELL (BUG-017, server, P1, M, `v64i_`: storefront refuses order above own-warehouse available stock with 409 INSUFFICIENT_STOCK naming product, never id) | antigravity | returned | — | Returned #80 (7143063061) @ `4d6f7b8e` (RED `96c39dc1`, fix `a445e6c7`, R1 Redis isolation `4d6f7b8e`; 8/8 storefront/routing/unit suites 206/206 + back-to-back 7/7, R0 coverage 19/19, tsc 0, eslint 0, both R2 reviews CONFIRMED) |
| P34 | FU-KEY-CTRLJ-OWNERS (web, S: Cmd/Ctrl+J has the same two owners as Ctrl+K had; fixing it makes Ctrl+J open KEY, which the KEY_DISABLED smoke check counts, and the web does not hide KEY under KEY_DISABLED) | claude (proposed) | todo | P32 | Live check first, then pre-flight (A3) |
| P35 | W11-WEB-OWNER-MEMBERSHIP-REFUSAL `pkt/V1-W11-WEB-OWNER-MEMBERSHIP-REFUSAL` @ 2c3ef7ab **RETURNed** (#80 7144767176): refusal forgets only the stale business; callback names it; both reviews ACCEPT | claude | returned | — | M11; SWP-REMOVED-MEMBER-NOTICE stacks on it |
| P14 | Owner: "Batch 2 safe defaults #5–#10" (not approved in D-272) | owner | blocked | the owner's review | The owner reviews the list |
| P15 | Owner: redeploy production (D-266) | owner | blocked | M1–M4 | The owner deploys from main |
| P36 | FU-CI-PG-NO-PASSWORD (CI, S, D-275: CI's throwaway Postgres containers use POSTGRES_HOST_AUTH_METHOD trust; DATABASE_URL without a password) | antigravity | returned | — | Returned #80 (7145451523) @ `2fe3bbad` (RED `38e95fc0`, fix `2fe3bbad`; 260/260 CI+security+deploy specs + 31/31 server config specs + `admit-resources` exit 0, both reviews CONFIRMED); entering M9 |
| P37 | FU-BULK-DELETE-UNDO (both, S, D-277b: bulk delete sent at once, Undo restores the ids from Trash in one call) | antigravity (server) + claude (web, stacked) | todo | — | Server half first |
| P38 | FU-CI-MERGE-QUEUE (CI, S, D-278: merge_group trigger + docs repo references after the org transfer) | antigravity (proposed) | todo | M8 merged + owner's org transfer | After the transfer |
| P39 | FU-CI-WINDOWS-INPUT-GATE + C2 (CI, S, D-279: Windows proof always reports, skips the full run when no input changed vs merge base; sharded; nightly full) | claude | todo | M8 (C1) | After M8 |
| P40 | FU-ME-NOTIFICATIONS-SCOPE (web, S, D-276: Me menu Notifications for settings readers only) | claude | todo | P30 (M9) | Pre-flight, claim |
| P41 | FU-CONTACT-TIMELINE-CHANNELS (web, M, D-277: contact Timeline channel filter; pasted WhatsApp messages) | claude | todo | WEDGE-WA-INBOUND-CAPTURE server half | After Antigravity's server half |
| P42 | FU-C4-TODAY-LINK (web or both, S: journey C4 'from Today': Today does not link the customer of the invoice due today; found live after P29+P32) | claude (pre-flight) | todo | — | Root cause; server half to Antigravity if server-side |

Last updated: 2026-11-24 ~21:25 UTC by the claude lane (P32, P35 returned; D-275..D-279 packets added; M8 waits on the owner's GitGuardian dashboard step).
