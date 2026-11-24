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
| M3 | Wave 3m, **PR #229** | `wave/v1-wave-3m` @ 6bb8b430 (main 05f04f2c merged in): MOUNT-QUOTES, SWP-INV-MATH, SWP-INV-PUBLIC-LINK, SWP-QUOTE-PUBLIC-PAGE, SWP-INV-FORM-UX, SWP-QUOTE-COMPOSER-CONTACT. **Proven at 6bb8b430:** server 833/833 files, 15419 tests exit 0 (rerun after one ECONNRESET); R0 MET 39/39 exact-head; web 197/1784 exit 0, tsc 0, lint 25 of 26. Merge confirmation ACCEPT | claude | blocked | the owner: GitGuardian incident 40952282 | Owner marks 40952282 a false positive; then CI green at the exact head, merge (D) |
| M4 | Wave 3j split | `wave/3j-second-lane` (16 packets; fails 25/50; duplicates RR-REDACTION-BY-CONTENT with #228) | antigravity | todo | M3 | Split into parts within 25 commits / 50 files without the duplicate; prove each; PR; merge in turn |

## Packets and tasks

| Row | Item | Owner | Status | Waits on | Next step |
| --- | --- | --- | --- | --- | --- |
| P1 | SEC-KEY-CUSTOM-LOGIC (P0, D-272.4): tenant KEY's `execute_custom_logic` runs JS in a child process on the API host | antigravity | returned | — | Returned @ `d136d090` (both reviews CONFIRMED 0 findings; full server suite 821/821 / 15,287 passed; exact-head `proof:release0` 39/39 SATISFIED — R0 EXIT GATE MET) |
| P2 | Switch off the agent-control autopilot's #80 posting (D-272.4) | antigravity | returned | — | Returned #80 (7122760762) @ `8c536bbf` (RED `8021448d`, 644/644 agent-control specs + DAG OK, both reviews CONFIRMED) |
| P3 | FU-VITEST-DECORATOR-METADATA (Q20, D-272.2) | antigravity | blocked | the owner sees the diff | Show the before/after of the two expectations. If it is a tightening, AMEND per D-272.2; else hold |
| P4 | FU-OUTBOUND-ATTACHMENT-URL (D-272.3) | antigravity | returned | — | Returned #80 (7121498630) @ `41e1a419` (RED `597b953b`, 7/7 84/84, tsc 0, both confirmation reviews CONFIRMED) + D-265 exact-head `proof:release0` 39/39 SATISFIED — R0 EXIT GATE MET |
| P5 | First-lane WIP: FU-STRATEGIC-ROUTES-SIGHT, FU-GENOME-DNA-WRITES-AND-INTEGRITY, FU-AI-APPROVALS-MONEY-SIGHT | antigravity | returned | — | 3/3 returned: `AI-APPROVALS` (#80 7121845152 @ `a0c650a6`), `STRATEGIC-SIGHT` (#80 7122456412 @ `b474ec39`), `DNA-WRITES` (@ `f616cf67`, both reviews CONFIRMED 0 findings; `SEC-DW-3a` flagged for R0 AMEND on `D11G-G04`). P6 unblocked |
| P6 | FU-PENDING-OWED-SERVER, then FU-PENDING-OWED-WEB (money-first) | antigravity | claimed | — | Claimed `FU-PENDING-OWED-SERVER` (`pkt/V1-FU-PENDING-OWED-SERVER` from `main`); 27-site server census + 13-site web census complete; writing RED suite now |
| P7 | SWP-CONTACT-QUICKADD (BUG-009, 034, 035; journey C1's New > Contact): `pkt/V1-SWP-CONTACT-QUICKADD` @ d859ba0f, stacked on wave 3m. Two reviews + confirmation ACCEPT WITH MINORS. Live at d859ba0f: sweep 2/2, C1 and C3 green both widths (red at the base), release0-live green; C4/C6/C8 red at the base too | claude | returned | M3 | Enters the next wave after M3 (main merged in, wave-head proof) |
| P8 | SWP-INV-LIST (P0, critical path; BUG-007, 050, 070, 089, 131, 047): `pkt/V1-SWP-INV-LIST` @ 35a47153, stacked on P7 (d859ba0f). RED 2103a852 (unit: 7 RED + 2 controls) and 1d8ea32a (sweep); fix 35a47153; commerce+finance+lib 93 files / 928 tests exit 0 | claude | in-review | — | Live run (sweep RED at 1d8ea32a, green at 35a47153; journeys D, E) and two reviews running |
| P9 | FU-WEB-PAYLINK-STATUS-BUTTONS | — | todo | — | Any lane may claim |
| P10 | NAV-A2 (P0), NAV-A3 (unblocks 33) | — | todo | — | Any lane may claim; NAV-A3 first |
| P11 | SWP-KEY-CHAT-WEB (P0, unblocks 33) | — | todo | — | Any lane may claim |
| P12 | SWP-STORE-LISTING-SERVER (unblocks 51, including DECIMALS-SERVER and CLAIM-LOOP) | — | todo | — | Any lane may claim |
| P13 | Follow-up: guard `res.data.templates` in `billing-form-modal.tsx:200` (an empty answer throws) | — | todo | M3 | A small web packet; any lane |
| P16 | Follow-up rulings docs, **PR #231** (`wave/v1-docs-p16` @ 3b2f7011): launch-track status (`ready_launch`, `by_track`), plan text, the KEY fix rule and tiebreak (RR-REFLECTION-HONEST to launch), runbook §1-§3 wrong-head fixes, CHECKLISTS B1. Correctness, process and confirmation reviews: ACCEPT WITH MINORS (wording minors listed open on the PR) | claude | pr-open | M3 merged | After M3: merge main in (regenerate V1-STATUS), CI green at the exact head, merge (D) |
| P17 | Follow-up from SWP-CONTACT-QUICKADD's reviews (not regressions; each tests-first): (a) the contact edit form ignores a refused update and says "Contact updated" (`use-contact-actions.ts` ~117-125); (b) device import counts refused rows as created; (c) a refused first note is dropped while "Contact created" shows; (d) KEY tool answers build `${firstName} ${lastName}` and say "Kavita null" (`flow-orchestrator.service.ts` ~4947, ~4976); (e) `?action=add` in `semantic-routes.ts` opens nothing (the page handles `action=new`); (f) the full form's two practically unreachable edge paths reset it; (g) its refusal is toast-only behind aria-hidden siblings; (h) the test helper's comment names the wrong cause (the empty list's call to action); (i) a `?action=new` request lingers if the workspace fails to load; (j) a second New > Contact on the mounted page dispatches nothing (`page.tsx:94`) | — | todo | P7 merged | Any lane may claim; a small web packet plus one server line |
| P14 | Owner: "Batch 2 safe defaults #5–#10" (not approved in D-272) | owner | blocked | the owner's review | The owner reviews the list |
| P15 | Owner: redeploy production (D-266) | owner | blocked | M1–M4 | The owner deploys from main |

Last updated: 2026-11-24 by the claude lane (P7 returned; P8 in review @ 35a47153; M3 blocked on GitGuardian 40952282; P16 is PR #231).
