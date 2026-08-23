---
kind: playbook
cycle: truth
cadence: "0 7 * * *"   # nightly, UTC
budget: 30 minutes; one model-heavy step (drift interpretation) — the rest is running commands
---

# Truth cycle — re-derive everything, trust nothing

**The NEVER list of `architecture/os/OS.md` binds this run. A failing gate is
information; never make a gate pass by editing the gate. A vitest skip is a
failure. Commit surgically (`git add <own paths>`) — the tree may contain
live human work.**

Write targets (direct to main, only if the diff is confined to these and the
suite is green): `architecture/*.{yaml,json}`, `docs/architecture/
capability-map/*`, `apps/server/src/modules/ai/capability-map/
capability-map.seed.ts`, `architecture/os/state/**`, `architecture/os/
journal/**`. Anything else → PR. Push rejected → rebase once, else PR.

## Steps

1. Fresh state: `git fetch origin && git checkout main && git pull --ff-only`.
   If the working tree has uncommitted changes that are not yours: do not
   touch them; note in journal.
2. Build (rule 6 — a stale dist hangs rather than fails):
   `pnpm install --frozen-lockfile`, then
   `pnpm --filter @keyflow/shared --filter @keyflow/db --filter @keyflow/api build`,
   then `pnpm --filter server build`.
3. Gate suite: `cd apps/server && npx vitest run`.
   - Green with 0 skipped → continue.
   - Any failure or ANY skip → journal (quote the shuffle seed line), open
     issue `truth: main is red`, **stop**. Never fix a red main in this cycle.
4. Regenerate (all four families, in place; `PY` is `python3` on Linux/cloud,
   `py -3` on Windows):
   - `node scripts/architecture/generate-registries.js`
   - `node docs/architecture/capability-map/generate.js`
   - `$PY .agents/skills/codebase-architect/scripts/inventory.py > architecture/inventory.json`
   - `$PY .agents/skills/codebase-architect/scripts/dependency_scan.py > architecture/dependencies.json`
   (The scanners print to stdout — forgetting the redirection "succeeds" while
   writing nothing.)
5. Re-derive `architecture/os/state/STATE.md`: run the Command column of every
   row; move Value → Prev; write the new Value; update `derived:`. A command
   that cannot run tonight leaves Value as `—` with a journal note — never
   carry yesterday's number forward as today's.
6. **Ledger monotonicity** (`node scripts/os/ledger-sizes.mjs` vs Prev):
   - `shrink` rose, `grow` fell, or `fixed` moved → do NOT update that row;
     open issue `gate-integrity: <ledger> moved <prev> -> <now>`; attribute
     with `git log --oneline -- <gate file>`; journal.
7. **Gate-file integrity**: `git diff --name-only <last-truth-commit>..HEAD |
   grep -E '\.(spec|test)\.ts$'`, intersect with the gate files named in
   STATE.md's ledger table. Any hit from a commit carrying the agent trailer
   (`git log --format='%H %(trailers:key=Co-Authored-By)'`) → issue
   `gate-integrity: agent commit touched a gate`.
8. DOC_DEBT sweep: run each row's disproving command. A claim that now holds →
   journal "candidate for removal" (burndown does the removing). A NEW
   provably-false doc claim found along the way → propose the row via PR
   (a growing ledger is reviewed).
9. Commit + push per the write-target rule. **Before every `git commit`, run
   `git diff --cached --name-only` and confirm it lists exactly your intended
   paths** — on a shared working tree the index is shared too, and a plain
   `git commit` sweeps whatever a concurrent session has staged (this
   happened: 35f42129 swept four of a peer's staged files into a one-file
   docs commit). Extra staged paths that are not yours: `git reset -- <those
   paths>` (scoped) before committing. Journal
   (`architecture/os/journal/<date>-truth.md`): actions, deltas, corrections.

## DONE means
Every STATE row re-derived or honestly `—`; registries carry today's date;
zero unexplained ledger movement; journal written. Nothing else was touched.
