---
kind: playbook
cycle: burndown
cadence: "0 14 * * 6"   # weekly, Saturday
budget: 2 hours; hard cap 3 entries; if entry 1 exceeds half the budget, ship 1
rotation_cursor: events.known_dead   # advance after each run: events.known_dead → providers.unreachable → docs.debt → billing.unpriced → billing.unenforced_limits → tenant.acknowledged_unscoped → (repeat)
---

# Burndown cycle — shrink one ledger, prove the gate still bites

**The NEVER list of `architecture/os/OS.md` binds this run. The ONLY
permitted gate edit is removing a ledger entry you actually fixed, and every
removal requires the negative control below. All code ships as a PR — never
direct to main. Never merge your own PR.**

## Steps

1. Fresh main; full suite green with 0 skips (as truth §1–3). Red main →
   journal, stop.
2. Pick the ledger at `rotation_cursor` (skip a ledger with an open
   `gate-integrity` issue). Within it, pick ≤3 entries, smallest blast radius
   first. SKIP any entry whose ledger comment marks it deliberate or a
   product decision (e.g. the two safety interceptors in
   `unreachable-provider.spec.ts`, everything in `NEVER_SCOPE`, the
   ROUTE_PARITY missing features) — those need humans.
3. Branch `os/burndown-<date>`. Fix each entry in code; remove its ledger
   line in the gate file.
4. **Negative control, per removal, mandatory**: re-add the removed entry,
   run the gate, confirm it FAILS naming that entry, revert the re-add.
   Transcribe the failing assertion into the PR body. A removal whose
   re-add does not fail means the gate is blind — stop everything, open
   `gate-integrity` issue.
5. Full suite green, 0 skips. Dependency touched? →
   `apps/server/test/commonjs-compat.test.ts` must pass (ESM-only kills boot).
   Service touched? → confirm it returns no raw Prisma records with
   secret/tenant fields.
6. PR: entries fixed, ledger N → M, negative-control transcripts, labeled
   `os-cycle`. A fix that failed → revert fully, journal WHY (reflect's raw
   material); never leave a ledger half-shrunk.
7. Advance `rotation_cursor` in this file (via the same PR). Journal.

## DONE means
One PR open with suite green and controls transcribed, or a journal entry
explaining why nothing was safely shrinkable this week.
