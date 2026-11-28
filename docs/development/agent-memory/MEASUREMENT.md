# Measuring what the memory layer saves

Measured on 2026-11-22 at main `79ed2a57` plus this packet's files. Sizes are characters (`wc -c` for files, which
counts bytes: a few non-ASCII characters make that slightly higher than the character count; string length for
prompt texts and bundles). **Tokens were not measured**: no tokenizer was run. As a rough guide only, English prose
is about 4 characters per token and JSON is denser; any token figure derived from that would be an estimate, so
none is given. Sizes drift with every edit: re-measure before quoting them.

Only section 5 measures a real run. Section 4 says what to record on the next packets to find out the rest.

## 1. Briefs: inline versus pointer (measured)

What the orchestrator writes into its own context each time. Whatever it writes stays in its context for the rest
of the session, so this is the number that fills the orchestrator.

| Prompt | Inline today | Pointer form | Ratio |
|---|---|---|---|
| Packet worker brief | 2,739 (the brief as used on 2026-11-22) | 284 (the prompt in `PACKET-WORKER-BRIEF.md`, before ids are filled in) | 9.6 to 1 |
| Acceptance review, per lens | not measured: no inline review brief was available to this packet | 342 | - |
| Confirmation review, per lens | not measured, same reason | 256 | - |

For the two review prompts the only honest statement is the size of the procedure a pointer stands for: 3,226
characters (acceptance, from "The brief" down) and 959 (confirmation). The orchestrator's real inline review
briefs may have been shorter or longer. To close this gap: put the size of one real inline acceptance brief from
the orchestrator's session into this table.

**What the pointer does not save.** The child session still reads the brief: the file is 4,632 characters, more
than the 2,739 inline, because of the usage notes. The saving is in the orchestrator's context, not the child's.

## 2. First read on resume (measured)

| What a fresh session reads first | Characters |
|---|---|
| New: `ORCHESTRATOR-STATE.md` + `V1-STATUS.md` + this folder's `README.md` | 10,211 + 4,814 + 12,350 = 27,375 |
| The `CLAUDE.md` list, files only: `AGENTS.md`, `EXECUTION_CONTROL_STANDARD.md`, `AGENT_CONTROL_PLANE.md`, `MULTI-AGENT-EXECUTION-PROTOCOL.md`, `IMPLEMENTATION-WAVE-EXECUTION-BOARD.md`, `V1-HANDOFF-2026-11-20.md` | 14,446 + 12,691 + 45,555 + 5,479 + 14,064 + 12,077 = 104,312 |
| The same list plus the plan of record, as `CLAUDE.md` item 6 names it | 104,312 + 743,647 = 847,959 |
| Issue #80 (item 7; active control room rolled over to #273 after #80 hit 2,500 comments) | not measured |

The new first read does not replace the `CLAUDE.md` list: `CLAUDE.md` still requires it, and this packet may not
edit `CLAUDE.md`. Until the owner rules on the proposed edit, the new files are an addition of 27,375
characters, not a replacement. 104,312 to 27,375 is what a replacement would be.

## 3. One packet's context (measured)

| What a worker or reviewer loads for one packet | Characters |
|---|---|
| Bundle (`bundle.mjs <ID>`, Markdown), all 209 packets on main | min 2,882, median 5,094, mean 5,637, max 18,731 |
| The two files it is compiled from | 743,647 (plan) + 241,968 (build map) = 985,615 |

A careful agent never read those two files whole: it searched them. How much each worker actually read to find its
entry and its rulings was not recorded, so the saving against real behaviour is unknown. What was checked: 207 of
209 bundles are VALID (every cited ruling resolved to its row); two are DEGRADED (FU-FINANCE-SETTINGS-SCOPE and
FU-FINANCE-SETTINGS-PATCH cite "WH3-1", which has no D-nnn row). Whether a bundle is *sufficient* for a worker was
not measured.

## 4. What to record next (so the saving is measured, not claimed)

For the next five packets assigned with the pointer form, the orchestrator records one line each in its RETURN
comment: characters it wrote to assign the packet; characters it wrote to start each review; whether the worker
asked for anything the bundle lacked; and whether the worker reported opening the plan or build map directly.
Compare the first two against 2,739 and against one real inline review brief.

## 5. Resume test

Give a fresh agent only this: "Read `docs/development/agent-memory/README.md` in KEYFLOWOS/KEYFLOWOS and follow it.
Do not open `MEASUREMENT.md` or issue #273 (or archived #80), and do not read the plan or the build map whole. Then answer these ten
questions and list what you opened." Pass: ten correct. Record the answers, the files opened and the characters read.

**Run once, 2026-11-22, at main `5c17e7b4`** (one wave earlier than the answers below), by a fresh subagent of the
packet that built the layer: 10 of 10 matched the answers expected at that main. It opened the README, the state
file, `V1-STATUS.md` and `WAVE-RUNBOOK.md`, queried `V1-STATUS.json` and ran `status.mjs --check` and one bundle:
about 45,000 characters by its own count. It needed the JSON for question 2 and found the ready list misleading
about in-flight packets; `V1-STATUS.md` was changed to fix both. One run by a subagent of the author is weak
evidence: the test that counts is the orchestrator's next real resume.

Expected answers as of 2026-11-22 at main `79ed2a57`. Answers 4 to 6 and 9 come from state-file rows that are the
seed of 16:05 UTC. All of them go stale at the next merge or state rewrite: regenerate them from the same files.

| # | Question | Expected answer | Where |
|---|---|---|---|
| 1 | How many packets are in the plan on main, and how many are done? | 209; 61 done (26.3% of points), 148 todo | `V1-STATUS.md` |
| 2 | How certain is that done count? | 53 certain; 8 uncertain (counted done because a fix commit names the packet, but not in the compacted form) | `V1-STATUS.md` |
| 3 | What is the next packet on the plan's critical path, and is it free to start? | NAV-A1; its dependencies are done on main, but the state file says it was probably already started, to be confirmed by the orchestrator | `V1-STATUS.md`, state file section 3 |
| 4 | Which PRs are open for v1 waves and what is each waiting for? | #218 (FU-PROPOSAL-REVENUE-SIGHT): CI green, then merge under D-239; two Codex P1 threads stay open for the owner. (#220 has merged) | state file section 3 |
| 5 | Which packets are in child sessions right now? | SWP-INV-MONEY-TOTALS and W11-RUNWAY-LEDGER-CASH (repairs after acceptance), W11-INV-SET-MOVEMENT, SWP-FIN-LEDGER, SWP-COA-UNIQUE-CODE (building); NAV-A1 and FU-CONTRACT-FETCH-OUTBOUND-GUARD reported started, unconfirmed | state file section 3 |
| 6 | Is any work at risk of being lost? | Yes: FU-KEY-GENOME-READS-RESIDUAL is local in a worktree at bd95bc84 and NOT pushed | state file section 3 |
| 7 | Which rulings are not yet in any plan file? | D-249 to D-254 | state file section 2 |
| 8 | Under what conditions may the orchestrator merge a wave PR? | CI green at the exact head, both independent reviews accept, head, mergeability and scope re-verified, merge commit with the head sha pinned; never a production deploy (D-239) | state file section 1, `WAVE-RUNBOOK.md` section 5 |
| 9 | How many questions are waiting for the owner, and what is the first? | Four; the first is the finance doors open to any member (scan, resolve, dismiss) | state file section 4 |
| 10 | Which rulings does SWP-COA-UNIQUE-CODE cite, and which of its files do not exist yet? | D-167 (`migrations`) and D-171 (`coawrite`); `apps/server/test/coa-unique-code.integration.test.ts` is new | `bundle.mjs SWP-COA-UNIQUE-CODE` |
