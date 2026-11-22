# Measuring what the memory layer saves

Measured on 2026-11-22 at main `5c17e7b4` plus this packet's files. Sizes are characters (`wc -c`, or string length
for prompt texts). **Tokens were not measured**: no tokenizer was run. As a rough guide only, English prose is about
4 characters per token and JSON is denser; every token figure derived from that would be an estimate, so none is given.

Nothing here measures a real run yet. Section 4 says what to record on the next packets to find out.

## 1. Briefs: inline versus pointer (measured)

What the orchestrator writes into its own context each time. Whatever it writes stays in its context for the rest
of the session, so this is the number that fills the orchestrator.

| Prompt | Inline today | Pointer form | Ratio |
|---|---|---|---|
| Packet worker brief | 2,739 (the brief as used on 2026-11-22) | 284 (the prompt in `PACKET-WORKER-BRIEF.md`, before ids are filled in) | 9.6 to 1 |
| Acceptance review, per lens | not measured: no inline review brief was available to this packet | 342 | - |
| Confirmation review | not measured, same reason | 197 | - |

For the two review prompts the only honest statement is the size of what a pointer replaces if the orchestrator had
typed the same procedure inline: 3,226 characters (acceptance, the part under "The brief") and 854 (confirmation).
The orchestrator's real inline review briefs may have been shorter or longer. To close this gap: paste one real
inline acceptance brief from the orchestrator's session into this table.

**What the pointer does not save.** The child session still reads the brief: the file is 4,189 characters, more
than the 2,739 inline, because of the usage notes. The saving is in the orchestrator's context, not the child's.

## 2. First read on resume (measured)

| What a fresh session reads first | Characters |
|---|---|
| New: `ORCHESTRATOR-STATE.md` + `V1-STATUS.md` + this folder's `README.md` | 9,645 + 4,107 + 11,556 = 25,308 |
| The `CLAUDE.md` list, files only: `AGENTS.md`, `EXECUTION_CONTROL_STANDARD.md`, `AGENT_CONTROL_PLANE.md`, `MULTI-AGENT-EXECUTION-PROTOCOL.md`, `IMPLEMENTATION-WAVE-EXECUTION-BOARD.md`, `V1-HANDOFF-2026-11-20.md` | 14,446 + 12,691 + 45,555 + 5,479 + 14,064 + 12,077 = 104,312 |
| The same list plus the plan of record, as `CLAUDE.md` item 6 names it | 104,312 + 734,525 = 838,837 |
| Issue #80 (item 7) | not measured |

The new first read does not replace the `CLAUDE.md` list: `CLAUDE.md` still requires it, and this packet may not
edit `CLAUDE.md`. Until the owner rules on the proposed edit, the new files are an addition of 25,308 characters
that makes the rest skimmable, not a replacement. The 104,312 to 25,308 figure is what a replacement would be.

## 3. One packet's context (measured)

| What a worker or reviewer loads for one packet | Characters |
|---|---|
| Bundle (`bundle.mjs <ID>`, Markdown), all 206 packets on main | min 2,749, median 4,955, mean 5,498, max 18,648 |
| The two files it is compiled from | 734,525 (plan) + 237,504 (build map) = 972,029 |

A careful agent never read those two files whole: it searched them. How much each worker actually read to find its
entry and its rulings was not recorded, so the saving against real behaviour is unknown. The bundle's measured
property is that it is complete for the packet (every cited ruling in full) at a median of 5 KB.

## 4. What to record next (so the saving is measured, not claimed)

For the next five packets assigned with the pointer form, the orchestrator records one line each in its RETURN
comment: characters it wrote to assign the packet; characters it wrote to start each review; whether the worker
asked for anything the bundle lacked; and whether the worker reported opening the plan or build map directly.
Compare the first two against 2,739 and against one real inline review brief.

## 5. Resume test

Give a fresh agent only this: "Read `docs/development/agent-memory/README.md` in SaCH-PRO/KEYFLOWOS and follow it.
Then answer these ten questions. Do not open issue #80." Pass: ten correct, from the README's first-read files and
the two scripts, without opening the plan or build map whole. Record the answers, the files opened and the
characters read.

Expected answers as of 2026-11-22 (main `5c17e7b4`, state file written 16:05 UTC). They go stale at the next merge:
regenerate them from the same files then.

| # | Question | Expected answer | Where |
|---|---|---|---|
| 1 | How many packets are in the plan on main, and how many are done? | 206; 58 done (25.3% of points), 148 todo | `V1-STATUS.md` |
| 2 | How certain is that done count? | 50 certain; 8 uncertain (a code commit names the packet, but not in the compacted form) | `V1-STATUS.md` |
| 3 | What is the next packet on the plan's critical path, and is it free to start? | BIZ-SETTINGS-WEB is next on main, but it is in flight in wave 3c (PR #220); after it, NAV-A1 | `V1-STATUS.md`, state file section 3 |
| 4 | Which PRs are open for v1 waves and what is each waiting for? | #220 (wave 3c): the Windows worker proof check, then merge under D-239. #218 (FU-PROPOSAL-REVENUE-SIGHT): CI green, then merge; two Codex P1 threads stay open for the owner | state file section 3 |
| 5 | Which packets are being built in child sessions right now? | SWP-INV-MONEY-TOTALS and W11-RUNWAY-LEDGER-CASH (repairs after acceptance), W11-INV-SET-MOVEMENT, SWP-FIN-LEDGER, SWP-COA-UNIQUE-CODE (building) | state file section 3 |
| 6 | Is any work at risk of being lost? | Yes: FU-KEY-GENOME-READS-RESIDUAL is local in a worktree at bd95bc84 and NOT pushed | state file section 3 |
| 7 | Which rulings are not yet in any plan file? | D-249 to D-253 (D-240 to D-248 are on the wave 3c branch, not on main) | state file section 2 |
| 8 | Under what conditions may the orchestrator merge a wave PR? | CI green at the exact head, both independent reviews accept, head, mergeability and scope re-verified, merge commit with the head sha pinned; never a production deploy (D-239) | state file section 1, `WAVE-RUNBOOK.md` section 5 |
| 9 | How many questions are waiting for the owner, and what is the first? | Four; the first is the finance doors open to any member (scan, resolve, dismiss) | state file section 4 |
| 10 | Which rulings does SWP-COA-UNIQUE-CODE cite, and which of its files do not exist yet? | D-167 (`migrations`) and D-171 (`coawrite`); `apps/server/test/coa-unique-code.integration.test.ts` is new | `bundle.mjs SWP-COA-UNIQUE-CODE` |

This test was written, not run, by the packet that built the layer: the independent reviewer of that packet read
the files but was not asked these questions cold.
