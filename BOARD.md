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
| M4 | Wave 3j split | **M4a PR #232 MERGED (`054cac4b`)** (8 pkts on main). **M4b PR #234** (`wave/v1-wave-3j-part2` @ `462b0509`, base `054cac4b`; 7 pkts / 14 commits / 33 files, exact `+2464/-176` parity with `2a11fdd7..a1e6a649`). **2 fresh wave reviews CONFIRMED (0 findings)**; local full proof + GitHub CI running | antigravity | pr-open | local proof + CI at `462b0509` | Merge PR #234 (`--merge --match-head-commit 462b0509...`) once local proof & CI green, unblocking M5 (PR #233) |
| M5 | Wave 3n, **PR #233** | `wave/v1-wave-3n` @ bfcf4d4c: SWP-CONTACT-QUICKADD, SWP-INV-LIST. **Proven at bfcf4d4c:** server 833/833 files, 15419 tests exit 0; R0 MET 39/39 exact-head; web 199/1808 exit 0, tsc 0, lint 25 of 26 | claude | pr-open; Codex P2 (Duplicate kept an unknown discount's value) fixed on the wave: RED d0cc17db, fix 2aaf028e | M4a, M4b (queue order on #80 7130344208) | waits for M4a (PR #232) and M4b to merge (D-272 order); then merge main in, CI at the new head, re-verify, merge. CI green at 2aaf028e (24/24; Vercel quota only), both reviews accept the Codex repair |
| M6 | `wave/v1-wave-3o` @ fae21e17 on main 054cac4b: NAV-A3, NAV-A2, SWP-KEY-CHAT-WEB compacted (6 commits, 30 files; each packet's files equal its head) | `wave/v1-wave-3o` @ 705c3ac5 on main 054cac4b: NAV-A3, NAV-A2 compacted (4 commits, 24 files; the two guard-spec exemption lists keep both packets' deletions; combined touched folders 61 files / 722 tests). SWP-KEY-CHAT-WEB joins when returned (A1, full waves) | proving | assembling | wave-head proof running (server suite + R0 + web); then open the PR early (A2); merge after M4b and M5 | add SWP-KEY-CHAT-WEB; wave-head proof (server suite + R0, web); open the PR early (A2); merge after M4b and M5 |

## Packets and tasks

| Row | Item | Owner | Status | Waits on | Next step |
| --- | --- | --- | --- | --- | --- |
| P1 | SEC-KEY-CUSTOM-LOGIC (P0, D-272.4): tenant KEY's `execute_custom_logic` runs JS in a child process on the API host | antigravity | returned | — | Returned @ `d136d090` (both reviews CONFIRMED 0 findings; full server suite 821/821 / 15,287 passed; exact-head `proof:release0` 39/39 SATISFIED — R0 EXIT GATE MET) |
| P2 | Switch off the agent-control autopilot's #80 posting (D-272.4) | antigravity | returned | — | Returned #80 (7122760762) @ `8c536bbf` (RED `8021448d`, 644/644 agent-control specs + DAG OK, both reviews CONFIRMED) |
| P3 | FU-VITEST-DECORATOR-METADATA (Q20, D-272.2 / D-273) | antigravity | claimed | — | Owner APPROVED AMEND in D-273 (#80 7129981422); applying the 2 R0 AMENDs on `pkt/V1-FU-VITEST-DECORATOR-METADATA` (`83b6dfc8`) while PR #234 CI finishes |
| P4 | FU-OUTBOUND-ATTACHMENT-URL (D-272.3) | antigravity | returned | — | Returned #80 (7121498630) @ `41e1a419` (RED `597b953b`, 7/7 84/84, tsc 0, both confirmation reviews CONFIRMED) + D-265 exact-head `proof:release0` 39/39 SATISFIED — R0 EXIT GATE MET |
| P5 | First-lane WIP: FU-STRATEGIC-ROUTES-SIGHT, FU-GENOME-DNA-WRITES-AND-INTEGRITY, FU-AI-APPROVALS-MONEY-SIGHT | antigravity | returned | — | 3/3 returned: `AI-APPROVALS` (#80 7121845152 @ `a0c650a6`), `STRATEGIC-SIGHT` (#80 7122456412 @ `b474ec39`), `DNA-WRITES` (@ `f616cf67`, both reviews CONFIRMED 0 findings; `SEC-DW-3a` flagged for R0 AMEND on `D11G-G04`). P6 unblocked |
| P6 | FU-PENDING-OWED-SERVER, then FU-PENDING-OWED-WEB (money-first, P0, D-256) | antigravity | returned | — | 2/2 RETURNED: `FU-PENDING-OWED-SERVER` (#80 7127921193 @ `ae4bf75f`, 834/834 server, R0 39/39 MET, 2 R3 reviews CONFIRMED) + `FU-PENDING-OWED-WEB` (#80 7130066870 @ `d645c31f`, 182/182 web / 1,720 passed, tsc 0, eslint 25/26, 2 R3 reviews CONFIRMED) |
| P7 | SWP-CONTACT-QUICKADD (BUG-009, 034, 035; journey C1's New > Contact): `pkt/V1-SWP-CONTACT-QUICKADD` @ d859ba0f, stacked on wave 3m. Two reviews + confirmation ACCEPT WITH MINORS. Live at d859ba0f: sweep 2/2, C1 and C3 green both widths (red at the base), release0-live green; C4/C6/C8 red at the base too | claude | returned | M3 | Enters the next wave after M3 (main merged in, wave-head proof) |
| P8 | SWP-INV-LIST (P0; BUG-007, 050, 070, 089, 131, 047): `pkt/V1-SWP-INV-LIST` @ 388925d9, stacked on P7. Reviews and three confirmations closed (final ACCEPT WITH MINORS). Live at 049fe735: sweep 2/2 (dark and light), D8, E3, E11 green both projects (red at the base), release0-live green; web 199/1808; tsc --types node 0 | claude | returned | M3 | Enters the next wave with P7 after M3 (main merged in, wave-head proof) |
| P9 | FU-WEB-PAYLINK-STATUS-BUTTONS (P0, size S, web; D-256 / D-248) | antigravity | returned | — | Returned #80 (7132926980) @ `7b615847` (RED `5d190b05`, fix `2b8c20f4`, R1 test matrix `7b615847`; 198/198 web / 1,791 passed, tsc 0, eslint 0 errors, 2 fresh R2 reviews CONFIRMED); ready for M6 |
| P10 | NAV-A3 `pkt/V1-NAV-A3` @ 6dff1113 **RETURNed** (#80 7132240611); NAV-A2 `pkt/V1-NAV-A2` @ ca84aec4 **RETURNed** (#80 7133214989): RED ab188d95, 84585d9c; fix ac38b1e0, ca84aec4; reviews ACCEPT WITH MINORS x2 + repair ACCEPT; live H: 19 'Money offers' findings at base -> 0, H2 green both projects. Plan: SWP-KEY-SHELL-SMOKE owns the index's KEY entry (docs-p19 c8afd062). Wave note: the two conflict only in 2 guard-spec exemption lists (keep both deletions) | claude | returned | — | one claude wave (NAV-A3 + NAV-A2) after M4a, M4b, M5 |
| P11 | SWP-KEY-CHAT-WEB `pkt/V1-SWP-KEY-CHAT-WEB` @ 65ec17e6 **RETURNed** (#80 7134257288): fix 2c6fe0f0 + root fix 3806dd79 (loadSessions stable: no loop in the drawer or /app/key/chat); confirmation REJECT at 2c6fe0f0 closed; reviews ACCEPT WITH MINORS (all closed). Live: sweep 2/2 and A3 2/2 RED at base, green at head | claude | returned | — | in wave 3o (M6) |
| P12 | SWP-STORE-LISTING-SERVER (unblocks 51, including DECIMALS-SERVER and CLAIM-LOOP) | antigravity | blocked | owner: setup-only R0 AMEND (#80 7135195185) | RED `b0857ffb` + fix `9f6a0268` pushed (`7/7` integration suites / `200/200` tests + `10/10` unit / `138/138` green); awaiting 1-line owner setup-only AMEND on `public-catalog-projection.integration.test.ts` `beforeAll` (0 assertion/manifest changes) |
| P13 | FU-BILLING-TEMPLATES-GUARD `pkt/V1-FU-BILLING-TEMPLATES-GUARD` @ 0a57e48b **RETURNed** (#80 7135012909): RED b1fd71d6, fix bac5e57d, review repairs cb48305a/0a57e48b; both reviews ACCEPT WITH MINORS (closed) | claude | returned | M3 | next claude wave (3p) |
| P16 | Follow-up rulings docs, **PR #231**: **merged** as 04730333 (#80 7131306748). Open wording minors and the state rewrite ride `wave/v1-docs-p19` @ e63d5dea | claude | merged | — | wording minors on wave/v1-docs-p19; PR it with the next docs batch |
| P17 | Re-cut by pre-flight (#80 7134656316): (a,b,c) FU-CONTACT-REFUSED-WRITES (web: 16 call sites in use-contact-actions.ts ignore error) -> claude, after M5; (d) FU-KEY-CONTACT-NAME (server: flow-orchestrator.service.ts:5036/5074/5103, contactDisplayName; R0 anchors untouched) -> antigravity proposed; (e) dropped (link never rendered) | claude / antigravity (d) | split | P7 merged | claude takes (a,b,c) after M5 merges; antigravity ACK on (d) |
| P18 | Re-cut by pre-flight: (a) FU-ESCAPE-OVERLAYS (web: keydown respects defaultPrevented, handleEscape no-ops under an open dialog/menu, mobile-gesture-provider.tsx:64, redirect-source landing) -> claude; (b),(e) accurate; (c,d) held until FU-PENDING-OWED-WEB merges (invoices/page.tsx) | claude | split | P8 merged | FU-ESCAPE-OVERLAYS after SWP-CONTACT-DETAIL |
| P19 | FU-SETTINGS-MANUAL-STEP-FENCE `pkt/V1-FU-SETTINGS-MANUAL-STEP-FENCE` @ df0b5d0c: RED 8890f90c (component race: 'products' over 'services'), fix df0b5d0c (beginBusinessWrite + numbered noteBusinessSettings); web tsc 0, suite 198/1787 | claude | in-review | — | two reviews running; then RETURN |
| P20 | SWP-CONTACT-DETAIL (web, M, journey C; plan corrected 21806719: BUG-127/128/129/062) | claude | next | — | after P19 |
| P21 | W1F-STORE-PAYPAL (lane both; plan corrected 21806719) | antigravity (proposed) | todo | NAV-A2 (M6), FU-PENDING-OWED-WEB | ACK on #80 7134656316; start after those merge |
| P22 | FU-OVERLAY-LAYER-TABLE (size L; plan corrected 21806719) | — | todo | open waves | alone, after the open waves |
| P14 | Owner: "Batch 2 safe defaults #5–#10" (not approved in D-272) | owner | blocked | the owner's review | The owner reviews the list |
| P15 | Owner: redeploy production (D-266) | owner | blocked | M1–M4 | The owner deploys from main |

Last updated: 2026-11-24 by the claude lane (P13 RETURNed 7135012909; P19 in review; wave 3o proof running; pre-flight split awaiting Antigravity ACK 7134656316).
