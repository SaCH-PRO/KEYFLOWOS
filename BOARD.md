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
| M4 | Wave 3j split | **PR #232** (`wave/v1-wave-3j-part1` @ `8645c38e`, main `04730333` merged in; 8 pkts / 17 commits / 33 files; drops dup `RR-REDACTION-BY-CONTENT`). Proven at `fb17b9e2` + exact-head `8645c38e`: R0 MET 39/39, 840/840 server (3 timing flakes rerun 3/3 green), CI green, 2 reviews CONFIRMED. Part 2 (`M4b`, 7 pkts) follows | antigravity | pr-open | CI at `8645c38e` | Merge PR #232 (`--merge --match-head-commit 8645c38e...`) when CI green, then assemble & merge M4b |
| M5 | Wave 3n, **PR #233** | `wave/v1-wave-3n` @ bfcf4d4c: SWP-CONTACT-QUICKADD, SWP-INV-LIST. **Proven at bfcf4d4c:** server 833/833 files, 15419 tests exit 0; R0 MET 39/39 exact-head; web 199/1808 exit 0, tsc 0, lint 25 of 26 | claude | pr-open; Codex P2 (Duplicate kept an unknown discount's value) fixed on the wave: RED d0cc17db, fix 2aaf028e | M4a, M4b (queue order on #80 7130344208) | waits for M4a (PR #232) and M4b to merge (D-272 order); then merge main in, CI at the new head, re-verify, merge. CI green at 2aaf028e (24/24; Vercel quota only), both reviews accept the Codex repair |

## Packets and tasks

| Row | Item | Owner | Status | Waits on | Next step |
| --- | --- | --- | --- | --- | --- |
| P1 | SEC-KEY-CUSTOM-LOGIC (P0, D-272.4): tenant KEY's `execute_custom_logic` runs JS in a child process on the API host | antigravity | returned | — | Returned @ `d136d090` (both reviews CONFIRMED 0 findings; full server suite 821/821 / 15,287 passed; exact-head `proof:release0` 39/39 SATISFIED — R0 EXIT GATE MET) |
| P2 | Switch off the agent-control autopilot's #80 posting (D-272.4) | antigravity | returned | — | Returned #80 (7122760762) @ `8c536bbf` (RED `8021448d`, 644/644 agent-control specs + DAG OK, both reviews CONFIRMED) |
| P3 | FU-VITEST-DECORATOR-METADATA (Q20, D-272.2 / D-273) | antigravity | todo | — | Owner APPROVED AMEND in D-273 (#80 7129981422); apply 2 R0 expectations and finish after M4 |
| P4 | FU-OUTBOUND-ATTACHMENT-URL (D-272.3) | antigravity | returned | — | Returned #80 (7121498630) @ `41e1a419` (RED `597b953b`, 7/7 84/84, tsc 0, both confirmation reviews CONFIRMED) + D-265 exact-head `proof:release0` 39/39 SATISFIED — R0 EXIT GATE MET |
| P5 | First-lane WIP: FU-STRATEGIC-ROUTES-SIGHT, FU-GENOME-DNA-WRITES-AND-INTEGRITY, FU-AI-APPROVALS-MONEY-SIGHT | antigravity | returned | — | 3/3 returned: `AI-APPROVALS` (#80 7121845152 @ `a0c650a6`), `STRATEGIC-SIGHT` (#80 7122456412 @ `b474ec39`), `DNA-WRITES` (@ `f616cf67`, both reviews CONFIRMED 0 findings; `SEC-DW-3a` flagged for R0 AMEND on `D11G-G04`). P6 unblocked |
| P6 | FU-PENDING-OWED-SERVER, then FU-PENDING-OWED-WEB (money-first, P0, D-256) | antigravity | returned | — | 2/2 RETURNED: `FU-PENDING-OWED-SERVER` (#80 7127921193 @ `ae4bf75f`, 834/834 server, R0 39/39 MET, 2 R3 reviews CONFIRMED) + `FU-PENDING-OWED-WEB` (#80 7130066870 @ `d645c31f`, 182/182 web / 1,720 passed, tsc 0, eslint 25/26, 2 R3 reviews CONFIRMED) |
| P7 | SWP-CONTACT-QUICKADD (BUG-009, 034, 035; journey C1's New > Contact): `pkt/V1-SWP-CONTACT-QUICKADD` @ d859ba0f, stacked on wave 3m. Two reviews + confirmation ACCEPT WITH MINORS. Live at d859ba0f: sweep 2/2, C1 and C3 green both widths (red at the base), release0-live green; C4/C6/C8 red at the base too | claude | returned | M3 | Enters the next wave after M3 (main merged in, wave-head proof) |
| P8 | SWP-INV-LIST (P0; BUG-007, 050, 070, 089, 131, 047): `pkt/V1-SWP-INV-LIST` @ 388925d9, stacked on P7. Reviews and three confirmations closed (final ACCEPT WITH MINORS). Live at 049fe735: sweep 2/2 (dark and light), D8, E3, E11 green both projects (red at the base), release0-live green; web 199/1808; tsc --types node 0 | claude | returned | M3 | Enters the next wave with P7 after M3 (main merged in, wave-head proof) |
| P9 | FU-WEB-PAYLINK-STATUS-BUTTONS (P0, size S, web; D-256 / D-248) | antigravity | returned | — | Returned #80 (7132926980) @ `7b615847` (RED `5d190b05`, fix `2b8c20f4`, R1 test matrix `7b615847`; 198/198 web / 1,791 passed, tsc 0, eslint 0 errors, 2 fresh R2 reviews CONFIRMED); ready for M6 |
| P10 | NAV-A3 `pkt/V1-NAV-A3` @ 6dff1113 **RETURNed** (#80 7132240611); NAV-A2 `pkt/V1-NAV-A2` @ ca84aec4 **RETURNed** (#80 7133214989): RED ab188d95, 84585d9c; fix ac38b1e0, ca84aec4; reviews ACCEPT WITH MINORS x2 + repair ACCEPT; live H: 19 'Money offers' findings at base -> 0, H2 green both projects. Plan: SWP-KEY-SHELL-SMOKE owns the index's KEY entry (docs-p19 c8afd062). Wave note: the two conflict only in 2 guard-spec exemption lists (keep both deletions) | claude | returned | — | one claude wave (NAV-A3 + NAV-A2) after M4a, M4b, M5 |
| P11 | SWP-KEY-CHAT-WEB (P0, unblocks 33): `pkt/V1-SWP-KEY-CHAT-WEB` @ 2c6fe0f0 (claim 7ed69ca3 on 04730333). RED 6409eb97 (6 RED, 2 control), sweep ab7d07fd, test repair 76d4a554; fix 2c6fe0f0 (Send/Deep think pass no event; actions take strings only; history loads once; messages scroll their own container). Web tsc 0, suite 198/1792 | claude | in-review | — | two reviews running; browser sweep at base (RED) and head running; then RETURN |
| P12 | SWP-STORE-LISTING-SERVER (unblocks 51, including DECIMALS-SERVER and CLAIM-LOOP) | antigravity | claimed | — | Claimed `pkt/V1-SWP-STORE-LISTING-SERVER` (`115fc2da` on `04730333`) while PR #232 Windows worker proof finishes; will pause for M4a merge + M4b as soon as PR #232 turns green |
| P13 | Follow-up: guard `res.data.templates` in `billing-form-modal.tsx:200` (an empty answer throws) | — | todo | M3 | A small web packet; any lane |
| P16 | Follow-up rulings docs, **PR #231**: **merged** as 04730333 (#80 7131306748). Open wording minors and the state rewrite ride `wave/v1-docs-p19` @ e63d5dea | claude | merged | — | wording minors on wave/v1-docs-p19; PR it with the next docs batch |
| P17 | Follow-up from SWP-CONTACT-QUICKADD's reviews (not regressions; each tests-first): (a) the contact edit form ignores a refused update and says "Contact updated" (`use-contact-actions.ts` ~117-125); (b) device import counts refused rows as created; (c) a refused first note is dropped while "Contact created" shows; (d) KEY tool answers build `${firstName} ${lastName}` and say "Kavita null" (`flow-orchestrator.service.ts` ~4947, ~4976); (e) `?action=add` in `semantic-routes.ts` opens nothing (the page handles `action=new`); (f) the full form's two practically unreachable edge paths reset it; (g) its refusal is toast-only behind aria-hidden siblings; (h) the test helper's comment names the wrong cause (the empty list's call to action); (i) a `?action=new` request lingers if the workspace fails to load; (j) a second New > Contact on the mounted page dispatches nothing (`page.tsx:94`) | — | todo | P7 merged | Any lane may claim; a small web packet plus one server line |
| P18 | Follow-up from SWP-INV-LIST's reviews (each tests-first): (a) the app's global Escape (`hooks/use-keyboard-shortcuts.ts` useRouteKeyboardShortcuts: Escape -> parent route, ignores `defaultPrevented`) leaves the page from any open menu or dialog on 11 routes (`/app/commerce/invoices` ConfirmDialog, invoices/[id], expenses/[id], crm/contacts, crm/pipeline, community/opportunities, presence/pages, settings/ai, autonomy, business, team; Radix layers too); fix in the hook (skip when defaultPrevented or a dialog/menu is open); (b) no unit test pins New Invoice's POST currency for a non-TTD business (`invoices/new/page.tsx`); (c) the Unpaid card counts business-currency invoices but its list shows every currency; (d) the Unpaid filter has no active state; (e) the sweep composites text colour as opaque (alpha ignored) | — | todo | P8 merged | Any lane; (a) is a small web packet with a hook test |
| P14 | Owner: "Batch 2 safe defaults #5–#10" (not approved in D-272) | owner | blocked | the owner's review | The owner reviews the list |
| P15 | Owner: redeploy production (D-266) | owner | blocked | M1–M4 | The owner deploys from main |

Last updated: 2026-11-24 by the claude lane (P11 SWP-KEY-CHAT-WEB fix pushed, in review; NAV-A3 and NAV-A2 RETURNed; PR #233 waits for M4a/M4b).
