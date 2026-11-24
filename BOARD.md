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
| M1 | PR #228 | `wave/v1-wave-3j` (RR-REDACTION-BY-CONTENT, FU-KEY-GENOME-READS-RESIDUAL, MEM-TEMPORAL-MEMORY-ROUTES-SIGHT) plus the Codex P1 fix | antigravity | in-review | — | Finish the CODEX-228 confirmation; compact; merge main in; prove; CI green; merge |
| M2 | Rulings | `pkt/V1-RULINGS-3E` + `pkt/V1-WEDGE-RECUT`: D-255 to D-272, the wedge plan, the agent-memory docs (LIVE-PROOF-RUNBOOK, CHECKLISTS), the state file | claude | todo | M1 | Build a docs-only wave from both branches on main; regenerate status; PR; CI green; merge |
| M3 | Wave 3m | `wave/v1-wave-3m`: MOUNT-QUOTES, SWP-INV-MATH, SWP-INV-PUBLIC-LINK, SWP-QUOTE-PUBLIC-PAGE, SWP-INV-FORM-UX, SWP-QUOTE-COMPOSER-CONTACT | claude | proving | M1, M2 | Wave-head proof (running at 7bd2f445); open the PR; after M2, merge main in, re-prove, merge |
| M4 | Wave 3j split | `wave/3j-second-lane` (16 packets; fails 25/50; duplicates RR-REDACTION-BY-CONTENT with #228) | antigravity | todo | M3 | Split into parts within 25 commits / 50 files without the duplicate; prove each; PR; merge in turn |

## Packets and tasks

| Row | Item | Owner | Status | Waits on | Next step |
| --- | --- | --- | --- | --- | --- |
| P1 | SEC-KEY-CUSTOM-LOGIC (P0, D-272.4): tenant KEY's `execute_custom_logic` runs JS in a child process on the API host | antigravity | todo | — | CLAIM; a RED test that proves the reach; sandbox it or turn it off for tenants; full server suite + R0 |
| P2 | Switch off the agent-control autopilot's #80 posting (D-272.4) | antigravity | todo | — | Find the posting workflow and step; turn off its posting (the smallest change); keep the modules and specs green |
| P3 | FU-VITEST-DECORATOR-METADATA (Q20, D-272.2) | antigravity | blocked | the owner sees the diff | Show the before/after of the two expectations. If it is a tightening, AMEND per D-272.2; else hold |
| P4 | FU-OUTBOUND-ATTACHMENT-URL (D-272.3) | antigravity | claimed | — | Refuse arbitrary external URLs on contract term extraction (an uploaded object or Drive file only) |
| P5 | First-lane WIP: FU-STRATEGIC-ROUTES-SIGHT, FU-GENOME-DNA-WRITES-AND-INTEGRITY, FU-AI-APPROVALS-MONEY-SIGHT | antigravity | claimed | — | Re-verify each head; finish its review rounds; RETURN |
| P6 | FU-PENDING-OWED-SERVER, then FU-PENDING-OWED-WEB (money-first) | antigravity | todo | P5 | CLAIM; CHECKLISTS B |
| P7 | SWP-CONTACT-QUICKADD (critical path, after SWP-QUOTE-COMPOSER-CONTACT) | claude | todo | M3 proof | CLAIM, stacked on d690bc41; CHECKLISTS B |
| P8 | SWP-INV-LIST (critical path) | claude | todo | P7 | CLAIM; CHECKLISTS B |
| P9 | FU-WEB-PAYLINK-STATUS-BUTTONS | — | todo | — | Any lane may claim |
| P10 | NAV-A2 (P0), NAV-A3 (unblocks 33) | — | todo | — | Any lane may claim; NAV-A3 first |
| P11 | SWP-KEY-CHAT-WEB (P0, unblocks 33) | — | todo | — | Any lane may claim |
| P12 | SWP-STORE-LISTING-SERVER (unblocks 51, including DECIMALS-SERVER and CLAIM-LOOP) | — | todo | — | Any lane may claim |
| P13 | Follow-up: guard `res.data.templates` in `billing-form-modal.tsx:200` (an empty answer throws) | — | todo | M3 | A small web packet; any lane |
| P14 | Owner: "Batch 2 safe defaults #5–#10" (not approved in D-272) | owner | blocked | the owner's review | The owner reviews the list |
| P15 | Owner: redeploy production (D-266) | owner | blocked | M1–M4 | The owner deploys from main |

Last updated: 2026-11-24 by the claude lane (board created).
