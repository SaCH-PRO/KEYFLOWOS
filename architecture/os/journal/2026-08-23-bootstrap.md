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
- **public-surface.spec.ts reads class guards only between the Controller
  decorator and the class keyword.** A UseGuards placed ABOVE the Controller
  decorator is invisible to it — Nest accepts either order, the parser only
  one. Guarding diagnostics stayed green-but-wrong until the decorators were
  reordered. Convention: Controller decorator first, then guards.
- **Comments that quote decorator-call syntax break the same parser.** An
  explanatory comment containing the literal Controller-decorator text made
  `search()` anchor inside the comment and report 6 open handlers instead
  of 0. Prose in code must not look like the code the gates parse.
- **Full-suite counts are unreliable while peer sessions edit the tree.**
  A full unit run showed test-config-coverage.spec.ts failing (31 > its cap
  of 30 default-only test files) and 354 collected files; the same command
  reseeded showed 355 files and a full green (3470/0), and the gate passed in
  isolation (13/13). The file COUNT itself moved between runs — vitest
  collection caught apps/server mid-edit while keyflowos-13 and the peer were
  working. Lesson for the cycles and for me: a suspected failure on the shared
  tree must be reproduced in isolation and by reseed before it is attributed;
  the truth cycle avoids this class entirely by running on an isolated clone
  of origin/main, which is exactly why it does. My four OS-layer fixes were
  stash-verified independent of the failure and pass on their own.
- **The review's top finding had the right defect and the wrong history.**
  The sw.js authenticated-cache leak was reported as introduced by removing
  the `_t` cache-buster; re-derivation (by the fixing session, 98fdb231)
  showed 62 authenticated call sites never carried `_t`, so the leak
  pre-existed and the removal only widened it from 62 paths to all of them.
  Two lessons: a masked defect reads as an introduced one from the diff
  alone — check whether the "old behavior" actually held on every path
  before calling a change a regression; and the fixer's framing beat the
  reviewer's because they fixed at the layer that STORES (credentialed
  requests bypass Cache Storage; cache version bumped to evict poisoned
  entries) instead of restoring the mask. Related root cause on their side,
  worth a playbook line: they had verified the wrong PROPERTY — freshness
  (network-first + no-store) instead of storage (cache.put is a different
  layer no-store does not govern). Name the property at risk before
  verifying anything.
- **Explicit `git add <path>` does not make a commit surgical — the INDEX is
  shared.** 35f42129 was `git add <one playbook> && git commit`, and it swept
  four files a concurrent session had staged (their guard hooks + a
  .gitignore edit) into a one-file docs commit. `git add -A` was never run;
  the sweep is what plain `git commit` does to a shared staging area. Rule
  now in both cycle playbooks: `git diff --cached --name-only` must equal the
  intended path list before every commit; scoped `git reset -- <foreign
  paths>` evicts a peer's staged files first. (Cloud routines are immune —
  isolated clones — but any local session running a playbook is not.)
