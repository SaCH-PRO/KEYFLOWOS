---
kind: playbook
cycle: reflect
cadence: "0 18 * * 0"   # weekly, Sunday evening — after the week's burndown PR met a human
budget: 30 minutes
---

# Reflect cycle — corrections compound or they repeat

**The NEVER list of `architecture/os/OS.md` binds this run. This cycle may
touch only: journals (including pruning), and — via PR — `AGENTS.md` Known
Gotchas and `architecture/os/playbooks/*`. It may never touch `OS.md`;
constitution changes are PROPOSED in the PR description for a human to make.**

## Correction sources (enumerate ALL, count each)

1. `## Corrections` sections in `architecture/os/journal/*` since last reflect.
2. Reverts of agent commits: `git log --grep=Revert --oneline` since last
   reflect, cross-referenced against commits carrying the
   `Co-Authored-By: Claude` trailer.
3. `os-cycle` PRs closed WITHOUT merge (`gh pr list --state closed --label
   os-cycle`) — rejection is a correction.
4. Issues labeled `gate-integrity` or `runtime-finding` closed since last
   reflect — what closed them is the lesson.

## Steps

1. For each correction, distill into exactly one durable home:
   - a fact about the CODEBASE → new `AGENTS.md` "Known Gotchas" bullet
     (house format: bold one-liner, mechanism, the do/don't);
   - a fact about the PROCESS → a playbook amendment (a new command, a new
     outcome branch, a tightened prohibition).
   A correction is closed only when the journal links it to the line that
   would have prevented it.
2. Prune journal files older than 8 weeks (git history is the archive; the
   lessons now live in gotchas/playbooks).
3. One PR: `reflect: week of <date>`, touching only AGENTS.md, playbooks,
   journal deletions. Labeled `os-cycle`.
4. Journal the run itself: each source enumerated with its count and each
   correction's disposition (`distilled | noise`). "Nothing to distill" is
   valid ONLY with the counts shown — a measured zero, not an assumed one.

## DONE means
Every correction source enumerated with counts; PR open or measured-zero
journal entry; journals pruned.
