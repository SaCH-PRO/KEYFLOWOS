---
kind: constitution
writers: [human]
# Cycles may propose changes to this file only via a PR labeled os-constitution.
# They may never edit it directly.
---

# KEYFLOWOS Operating System

The repo is the agent. Scheduled cycles (Claude Code cloud routines) read this
file first, follow exactly one playbook from `architecture/os/playbooks/`, and
write back only to the file kinds their playbook names. The loop is:

> read state → run gates and probes → fix drift → update the docs → reflect.

Nothing in this layer is advisory prose. Every file is one of eight kinds, each
with a named way of rotting and a named mechanism that keeps it honest.

## Doc taxonomy

Every file under `architecture/os/` declares `kind:` in front-matter. There is
no ninth kind; a document that fits none of these does not belong in the layer.

| Kind | Rots how? | Kept honest by |
|---|---|---|
| `constitution` | human negligence | human review only; cycles may not edit |
| `playbook` | instructions drift from reality | reflect cycle amends via PR |
| `state` | numbers drift | truth cycle re-derives nightly; every row carries its command |
| `ledger` | silently widens | a vitest gate asserts shrink-only + no-ghosts + anti-vacuity |
| `generated` | goes stale | truth cycle regenerates; header carries generator command + date |
| `journal` | grows unbounded | one file per run; reflect distills, then prunes >8 weeks |
| `inbox` | accumulates unread | audit cycle drains to zero every run |
| `snapshot` | never (immutable) | dated filename; edits prohibited after publication |

## The prime rule

**A failing gate is information. A cycle may never make a gate pass by editing
the gate.** No cycle may edit a spec assertion, widen a ledger, add
`@vacuity-ok`, or delete a gate file. The single permitted gate edit is the
burndown cycle removing a ledger entry it has actually fixed — and that edit
requires the negative control (re-add the entry, watch the gate fail naming
it, revert the re-add) transcribed into the PR body.

If a gate blocks you: stop, journal the failure with the full output (and the
vitest shuffle seed — `--sequence.seed=<n>` replays it), open an issue, end
the run. A vitest **skip is a failure**: a thrown `beforeAll` reports as
"skipped", so `0 skipped` is asserted, never assumed.

## Write matrix

| Cycle | May commit directly to main | May open PR for | May never touch |
|---|---|---|---|
| truth | `architecture/*.{yaml,json}`, `docs/architecture/capability-map/*` (regenerated), `architecture/os/state/**`, `architecture/os/journal/**` | anything else | `*.spec.ts`, `.env*`, `scripts/deploy.sh`, `.github/**`, `docker-compose*`, `.claude/**` |
| audit | `architecture/os/state/STATE.md` §Runtime only, `architecture/os/inbox/**` (deletion), `architecture/os/journal/**` | nothing (it opens issues) | all code |
| burndown | `architecture/os/journal/**` | code fixes + the matching ledger shrink | gate assertions, `.env*`, deploys, compose |
| reflect | `architecture/os/journal/**` (incl. pruning) | `AGENTS.md` Known Gotchas, `architecture/os/playbooks/**` | `OS.md`, `VERIFIED_STATE_*` snapshots |

Direct-to-main commits require the full gate suite green at HEAD and a diff
confined to the allowlisted paths. On push rejection: rebase once, else PR.
Cycles work on `os/<cycle>` branches, label PRs `os-cycle`, and never push to a
branch a human has pushed to.

## The NEVER list

1. Never run `scripts/deploy.sh`, `scripts/start-prod.sh`, or anything against
   the production VPS beyond read-only HTTP probes.
2. Never read into a commit, write, or echo `.env*`, routine secrets, or any
   value from the enc:v1 key-schedule table.
3. Never edit a `*.spec.ts` / `*.test.ts` assertion, widen a ledger, add
   `@vacuity-ok`, or delete a gate (sole exception: burndown ledger-entry
   removal with negative control).
4. Never edit `docker-compose*.yml`, `.github/workflows/**`, `.claude/**`, or
   this file.
5. Never modify or delete a `VERIFIED_STATE_*.md` snapshot. (The one
   grandfathered exception was the supersession header added at bootstrap.)
6. Never add a dependency outside a PR, and never an ESM-only one — the server
   is CommonJS on Node 20.18.1; one ESM-only dep kills boot
   (`apps/server/test/commonjs-compat.test.ts` guards this).
7. Never treat a vitest skip as a pass.
8. Never merge your own PR.

## Defense in depth against the critical failure mode

The failure mode this system must survive is an agent "fixing" a red gate by
weakening the gate. Layers, in order of firing:

1. **Playbook** — the prime rule and NEVER list are restated at the top of
   every playbook.
2. **Monotonicity** — `STATE.md` carries every ledger's cardinality with a
   Prev column. The truth cycle recomputes nightly; any growth → the row is
   not updated, a `gate-integrity` issue is opened, and the offending commits
   are attributed via `git log -- <gate-file>`.
3. **Negative control** — burndown must prove the gate still bites on every
   shrink.
4. **Attribution** — the truth cycle diffs all gate files since its last run;
   any agent-trailer commit (`Co-Authored-By: Claude`) touching a gate opens a
   `gate-integrity` issue.
5. **Process** — all code changes are PR-only; a human merges.

## Measurement methodology

Binding for every cycle. The six rules live in
`architecture/VERIFIED_STATE_2026-08-11.md` § "How to measure this codebase"
and are not duplicated here: parse, don't grep-count; find every mechanism
before counting; a green gate may be measuring nothing (prove non-empty
input); run the negative control; separate your variables; rebuild `dist`
before trusting a boot result.

## Index

| File | Kind |
|---|---|
| `architecture/os/OS.md` | constitution |
| `architecture/os/playbooks/truth.md` | playbook (nightly) |
| `architecture/os/playbooks/audit.md` | playbook (6-hourly) |
| `architecture/os/playbooks/burndown.md` | playbook (weekly, Sat) |
| `architecture/os/playbooks/reflect.md` | playbook (weekly, Sun) |
| `architecture/os/state/STATE.md` | state |
| `architecture/os/state/ROUTE_PARITY.md` | ledger (gate: `apps/server/src/core/config/route-parity-ledger.spec.ts`) |
| `architecture/os/state/DOC_DEBT.md` | ledger (gate: `apps/server/src/core/config/doc-debt-ledger.spec.ts`) |
| `architecture/os/inbox/README.md` | inbox contract |
| `architecture/os/journal/` | journal |
| `architecture/VERIFIED_STATE_2026-08-11.md` | snapshot |
| `architecture/*.yaml`, `architecture/*.json`, `docs/architecture/capability-map/*` | generated |
