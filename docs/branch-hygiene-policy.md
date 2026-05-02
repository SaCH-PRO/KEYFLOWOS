# Branch Hygiene Policy

**Owner:** Repo maintainer (currently SaCH-PRO)
**Effective:** 2026-05-02
**Replaces:** the implicit "use `develop` as integration branch" rule from
`docs/repo-consolidation-runbook.md`.

This policy exists because the repo recently accumulated:

- Two long-lived branches (`main`, `develop`) that drifted into different
  product surfaces — 60 commits on one side, 31 on the other, **247 files
  diverged** (see `docs/develop-vs-main-triage.md`).
- 115 local `subrepl-*` per-task agent branches, only 2 of which were ever
  merged into `main`.
- A `replit-agent` mirror branch with **1,029 unique commits** that overlapped
  `main` in confusing ways.

The rules below make all three failure modes visible — and easy to clean up
without losing work.

---

## Rule 1 — `main` is the only integration branch

- **`main` is the single source of truth.** All feature branches, hotfix
  branches, and agent branches target `main` directly via PR.
- **`develop` is retired.** After Task #240, `develop` on origin is
  fast-forwarded to match `main` (or, if it cannot fast-forward, left frozen
  with an `archive/develop-<date>` tag and a note in
  `BRANCH_CLEANUP_REPORT.md`). New work must not branch from `develop`.
- **No new long-lived integration branches** (no `develop`, `staging`,
  `next`, `v2`, etc.) without a written owner, a written sunset date,
  and CI enforcement via the `Branch divergence` workflow (Rule 5).
  Equivalent manual reconciliation: `scripts/check-branch-divergence.sh
  main <branch> --max-commits 25 --max-files 50`.
- **GitHub default branch and required-status-checks point at `main`.**
  Branch protection on origin enforces: PRs only, no force-push, no direct
  push from non-admin accounts.

## Rule 2 — One PR per scope, one branch per PR

- A "scope" is one feature, one bug fix, one refactor, or one
  dependency-bump batch. **Do not stack unrelated work into the same PR.**
- A scope owns exactly one branch. If a follow-up is needed, open a new PR
  off `main` (not off the original branch) once the first one merges.
- Stale PRs (no commits in 14 days) are closed by the maintainer.
  Reopening is fine; the freshness clock just resets.

## Rule 3 — `subrepl-*` agent branches are short-lived

- A `subrepl-*` branch represents one autonomous task agent run. It exists
  while the task is in progress and for a brief verification window after
  merge.
- **On task merge, the platform should auto-archive the branch.**
  Equivalent manual command (re-run after every merge wave):

  ```bash
  scripts/archive-stale-subrepl-branches.sh --days 7 --apply
  ```

  This tags every eligible branch as `archive/<branch>-<date>`, pushes the
  tag to `origin`, verifies it landed, and only then deletes the local
  branch. **Nothing is deleted before the archive tag is confirmed on
  origin.**
- **Never** delete a `subrepl-*` branch tied to an `IN_PROGRESS` task.
  Pass that branch via `--skip <branch>` to the archive script.
- The `subrepl-*` remote (the per-branch `git+ssh://...` remote each task
  agent registers) does not need to be touched by this script — the local
  branch deletion is what matters.

## Rule 4 — Archive-first deletion, always

- Every branch deletion (local or remote) is preceded by an
  `archive/<branch>-<YYYY-MM-DD>` tag on origin. **No exceptions.**
- Recovery is one command:
  ```bash
  git fetch origin --tags
  git checkout -b <branch> archive/<branch>-<YYYY-MM-DD>
  ```
- We never force-push and never `--mirror`. The only acceptable remote-
  reference moves are: fast-forward updates and tag pushes.

## Rule 5 — Detect divergence early

- Any branch that the team intends to keep alive longer than 7 days must
  be checked weekly with `scripts/check-branch-divergence.sh` against
  `main`. Default thresholds: **25 commits / 50 files** (lines disabled).
  Exceeding either is a signal to either rebase, merge, or archive — not
  to continue diverging silently.
- **CI enforces this automatically** via
  `.github/workflows/branch-divergence.yml`. The workflow runs on:
  - every PR targeting `main` (compares the PR head against
    `origin/main`), and
  - every push to a known long-lived branch (`develop`, `staging`,
    `next`, `release/**`, `long-lived/**`).

  The job is `Branch divergence / Check divergence vs main`; mark it
  **required** in GitHub branch protection for `main` so a drifting
  branch cannot merge.
- **Re-run the same check locally** before pushing:
  ```bash
  scripts/check-branch-divergence.sh main HEAD \
    --max-commits 25 --max-files 50 --fetch
  ```
- **Need a temporary threshold bump?** Two options, in order of
  preference:
  1. Rebase or merge `main` into the branch, or split the work into
     smaller PRs. This is almost always the right answer.
  2. If a one-off bump is genuinely needed, dispatch the workflow
     manually via GitHub Actions → **Branch divergence** → **Run
     workflow** with elevated `max_commits` / `max_files` inputs, link
     the run in the PR description, and explain why. Bumping the
     defaults in `branch-divergence.yml` requires a PR that updates this
     doc in the same change.

## Rule 6 — Mirror branches are not allowed

- The `replit-agent` mirror branch (1,029 unique commits versus `main`) is
  the cautionary tale. **No new mirror branches.** A long-running agent
  that needs its own branch must own a single named branch, follow Rule 2
  (one PR per scope), and reconcile to `main` weekly under Rule 5.

---

## Enforcement & cadence

| Cadence  | Action                                                                 |
| -------- | ---------------------------------------------------------------------- |
| Per PR   | Reviewer enforces Rule 2 (one scope per PR, no piggy-backed work).     |
| Per PR   | CI runs `Branch divergence / Check divergence vs main` (Rule 5).       |
| Per push | CI re-runs the divergence check on long-lived branches (Rule 5).       |
| Daily    | Platform auto-archives `subrepl-*` branches on task merge (Rule 3).    |
| Weekly   | Maintainer runs `scripts/archive-stale-subrepl-branches.sh --days 14`. |
| Weekly   | Maintainer spot-checks `scripts/check-branch-divergence.sh` for any    |
|          | branch that still exists outside `main` (CI is the primary gate).      |
| Quarterly| Audit: `git for-each-ref refs/heads/ refs/remotes/origin/` plus a      |
|          | manual scan of GitHub branches for anything missing an `archive/*` tag. |

## Recovery cheat-sheet

| Situation                                           | Command                                                                |
| --------------------------------------------------- | ---------------------------------------------------------------------- |
| Need a deleted branch back                          | `git fetch origin --tags && git checkout -b <name> archive/<name>-<d>` |
| Need to inspect what was on `develop` before retire | `git fetch origin --tags && git log archive/develop-2026-05-02`        |
| Need to compare a current branch to `main` safely   | `scripts/check-branch-divergence.sh main <branch>`                     |
| Need to do a paranoid bulk cleanup                  | `scripts/archive-stale-subrepl-branches.sh --days 14` (dry-run first)  |

## Related documents

- `docs/develop-vs-main-triage.md` — why `main` was chosen as the survivor.
- `docs/repo-consolidation-runbook.md` — the consolidation procedure (now
  superseded by Rule 1's "single integration branch" stance, but still
  useful for incident response).
- `BRANCH_CLEANUP_REPORT.md` — what Task #240 actually archived/deleted
  and how to recover any of it.
