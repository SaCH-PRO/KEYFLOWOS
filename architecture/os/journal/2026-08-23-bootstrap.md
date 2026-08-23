---
kind: journal
cycle: bootstrap (hand-run)
started: 2026-08-23
head_at_start: 3f431dd3
outcome: corrected
---

# Bootstrap session — the operating layer lands

## Actions
- Wrote OS.md, STATE.md, ROUTE_PARITY.md, DOC_DEBT.md, inbox/README.md,
  scripts/os/{lib,ledger-sizes,count-flow-tools,probe-routes}.mjs.
- `node scripts/os/ledger-sizes.mjs` → all 12 rows parse; every value matches
  the 2026-08-11 snapshot exactly (calibration pass).
- `node scripts/os/count-flow-tools.mjs` → 286 (matches snapshot).
- Regenerated all five YAML registries (first time since 2026-07-26; 937
  insertions / 297 deletions of drift), both capability-map outputs, both
  scanner JSONs. Determinism verified: two consecutive registry runs
  byte-identical by md5.
- First drift caught: server spec/test files 405 → 406 since the snapshot.

## Corrections
- **Untracked oracles die.** apps/server/probe-{boot,nest,listen}.js were read
  by an agent this morning and were gone from disk by afternoon. The route
  oracle is now a committed script (scripts/os/probe-routes.mjs). Playbook
  rule: cycle tooling is always committed, never scratch.
- **The codebase-architect scanners print to stdout.** Running them bare
  "succeeds" while writing nothing. The derivation command must include the
  redirection: `py -3 .../inventory.py > architecture/inventory.json`.
- **Cycles share the tree with live human work.** Mid-bootstrap, a concurrent
  session modified 10 files (schema.prisma, api.ts, a new migration…).
  Commits must be surgical — `git add <own paths only>`, never `git add -A`.
  This is now assumed by every playbook.
- **Re-derive, don't transcribe, even for ledgers.** The first draft of
  ROUTE_PARITY.md guessed `/api/whatsapp/...` prefixes from the snapshot's
  prose; the client source says `/whatsapp/...`. The no-ghosts gate would
  have caught it; grepping the drawer caught it first. Ledger entries are
  quotes from source, not summaries of summaries.
- **A determinism check compares run N to run N+1, not run N to HEAD.**
  Diffing regenerated output against the committed baseline measures drift
  (which was real) and says nothing about generator stability. Hash two
  consecutive runs.
