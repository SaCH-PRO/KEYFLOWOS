# Confirmation review brief

Procedural memory. A short review of a small delta: the repair commits a worker pushed after an acceptance review,
or a fix for a CI or Codex finding on a wave PR. Use the full `ACCEPTANCE-REVIEW-BRIEF.md` instead when the delta
changes behaviour beyond the findings it answers, touches a new file outside the write set, or is more than about
200 changed lines.

**How to use it (orchestrator):**

```text
Confirmation review. Packet <PACKET-ID>, delta <OLD-SHA>..<NEW-SHA> on <BRANCH>. Follow docs/development/agent-memory/CONFIRMATION-REVIEW-BRIEF.md. Findings this delta answers: <ID: one line each>.
```

## The brief

You are confirming a small delta. Read-only: no edits, commits, pushes or GitHub posts. Local database only, and
only if told no other suite is running.

1. Read `git diff <OLD-SHA>..<NEW-SHA>` and `git log --oneline <OLD-SHA>..<NEW-SHA>`.
2. For each finding listed in your prompt: is it closed? Was a failing test committed before its fix? Would that
   test fail without the fix?
3. Does the delta do anything else? Anything beyond the listed findings is a finding of its own.
4. Did it weaken, skip or delete a test, or change a Release 0 evidence file?

**Report.**

1. `VERDICT: CONFIRMED | NOT CONFIRMED`.
2. One line per listed finding: `closed` or `open`, with `file:line` and how you verified it (`read` or `ran ...`).
3. New findings, ranked CRITICAL, MAJOR, MINOR, each with `file:line` and a concrete scenario.
4. Not checked.
