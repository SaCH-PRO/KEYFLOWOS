# Branch Cleanup Report

**Task:** #240 — Branch cleanup, develop retirement, and divergence guardrails
**Generated:** 2026-05-02
**Working tree:** isolated task-agent environment (push to `origin` is restricted)
**Companion docs:** `docs/branch-hygiene-policy.md`, `docs/develop-vs-main-triage.md`

> **Reading order.** §1 explains why this report describes a planned cleanup
> rather than a completed one. §2 is the verified inventory. §3–§5 are the
> exact archive/delete/retire plan with recovery commands. §6 covers what was
> *actually* shipped on this branch (scripts + policy + report).

---

## 1. Pre-flight verification — RESULT: BLOCKED, do not delete yet

Three preconditions from the task plan are required before any branch is
deleted or `develop` is retired. Two of them currently fail. **No
destructive git operation should be executed against `origin` until all
three preconditions hold.**

| # | Precondition                                                                                | Status      | Evidence                                                                                                                                                                                                                                          |
| - | ------------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 | The develop → main consolidation PR (Task #239) is merged on `origin/main`.                 | **NOT MET** | `git merge-base --is-ancestor origin/develop main` → false. `git rev-list --left-right --count origin/main...origin/develop` → `36 31` (origin/main is 36 ahead of origin/develop, origin/develop is 31 ahead of origin/main). They have NOT met. |
| 2 | `pre-consolidation/main-2026-05-02` and `pre-consolidation/develop-2026-05-02` exist on `origin`. | **NOT MET** | `git tag -l 'pre-consolidation/*'` → empty. The Task #238 triage doc (§1, "Operator actions required") explicitly notes the agent isolate cannot push these tags; the operator has not yet run that snippet.                                       |
| 3 | No `subrepl-*` branch belonging to an `IN_PROGRESS` task is touched.                        | **MET (advisory)** | Task #240 itself runs on `subrepl-q7c8dyf2` (this isolate's working branch). It is added to the `--skip` list of the archive plan in §4. The `IN_PROGRESS` list must be re-checked at *operator run time*, not from this snapshot. |

**Decision:** the report stays in "plan + recovery commands" form. The
operator runs the destructive commands from §3–§5 *only after* fixing
preconditions 1 and 2 (or making an explicit, written exception in this
file). The guardrail scripts in §6 are committed regardless — they are
non-destructive on their own.

---

## 2. Verified inventory of branches in this working copy

Counts from `git branch` / `git for-each-ref` against the current working
tree (full TSV at `docs/triage-appendices/subrepl-branch-inventory.tsv`):

| Bucket                                                        | Count | Notes                                                                            |
| ------------------------------------------------------------- | ----: | -------------------------------------------------------------------------------- |
| `subrepl-*` local branches total                              |   115 | The original task said "96"; the working copy currently holds 115. Use 115.      |
| └─ merged into `main`                                         |     2 | `subrepl-cvibnjmy`, `subrepl-z1l79h1g` — safe-deletable with `git branch -d`.    |
| └─ NOT merged into `main`                                     |   113 | Must be archived as tags before any deletion.                                    |
| `subrepl-*` by tip-commit age (relative to 2026-05-02 UTC):   |       |                                                                                  |
| └─ ≤ 7 days                                                   |    49 | "Recent". Default policy: leave alone unless explicitly closed.                  |
| └─ 8–14 days                                                  |     0 |                                                                                  |
| └─ 15–30 days                                                 |    53 | Archive candidates.                                                              |
| └─ > 30 days                                                  |    13 | Highest archive priority.                                                        |
| Other long-lived local branches                               |       |                                                                                  |
| └─ `replit-agent`                                             |     1 | 1,029 commits unique vs `main`; 1 commit unique on `main`. **Mirror branch.**    |
| └─ `develop` (local)                                          |     1 | 31 commits unique vs `main`; 60 commits unique on `main`. Tracks `origin/develop`. |
| └─ `main` (local)                                             |     1 | 24 commits ahead of `origin/main` (recent task-agent work not yet pushed).       |
| Origin-side `cursor/*` and `claude/*` PR branches             |    13 | Untouched by this task — they are origin-only refs and pre-date this cleanup.    |

Sources:
- `git --no-optional-locks branch | grep -c '^  subrepl-'` → 115
- `git --no-optional-locks branch --merged main | grep -c subrepl-` → 2
- `git --no-optional-locks rev-list --left-right --count main...replit-agent` → `1 1029`
- `git --no-optional-locks rev-list --left-right --count main...develop` → `60 31`
- `git --no-optional-locks rev-list --left-right --count main...origin/main` → `24 0`

---

## 3. Tag-manifest plan (119 tags total)

For every branch the operator pushes one annotated tag of the form
`archive/<branch-name>-2026-05-02` pointing at the branch tip. Tags are
created locally first, pushed in one batch, and verified with
`git ls-remote --tags origin` before any deletion proceeds (per the task's
"Step 2" gate).

**Tag count:**

| Source                                  | Tags  |
| --------------------------------------- | ----: |
| `subrepl-*` branches (1 tag each)       |   115 |
| `replit-agent`                          |     1 |
| `develop` (local & origin tip)          |     1 |
| Pre-consolidation snapshots (Task #238) |     2 |
| **Total**                               | **119** |

> Note: the two `pre-consolidation/main-2026-05-02` and
> `pre-consolidation/develop-2026-05-02` tags are *not* duplicated by this
> task — they are the rollback snapshots described in `docs/develop-vs-main-triage.md §1`.
> They MUST exist on origin before any cleanup happens (precondition #2 in §1).

Sample names (full list in `docs/triage-appendices/subrepl-branch-inventory.tsv`):

```
archive/subrepl-0mjjlehs-2026-05-02
archive/subrepl-0q32bmkl-2026-05-02
archive/subrepl-0tm4a7hb-2026-05-02
... (109 more) ...
archive/subrepl-yjcgljy5-2026-05-02
archive/subrepl-z1l79h1g-2026-05-02
archive/subrepl-zjqyv23q-2026-05-02
archive/subrepl-zl4jkd45-2026-05-02
archive/replit-agent-2026-05-02
archive/develop-2026-05-02
```

### 3.1 Archive command (run on operator workstation with origin push rights)

```bash
# 0. Pre-flight — re-fetch and snapshot.
git fetch origin --prune --tags

# 1. Push the two pre-consolidation snapshots if they don't exist yet.
git rev-parse --verify --quiet pre-consolidation/main-2026-05-02 \
  || git tag pre-consolidation/main-2026-05-02 origin/main
git rev-parse --verify --quiet pre-consolidation/develop-2026-05-02 \
  || git tag pre-consolidation/develop-2026-05-02 origin/develop
git push origin pre-consolidation/main-2026-05-02 pre-consolidation/develop-2026-05-02

# 2. Tag every subrepl-* branch from its local tip.
DATE=2026-05-02
git for-each-ref --format='%(refname:short)' refs/heads/subrepl-* | while read branch; do
  tag="archive/${branch}-${DATE}"
  git rev-parse --verify --quiet "refs/tags/$tag" >/dev/null || git tag "$tag" "$branch"
done

# 3. Tag replit-agent and develop.
git tag "archive/replit-agent-${DATE}" replit-agent
git tag "archive/develop-${DATE}"      develop

# 4. Push every archive tag in one batch.
git push origin --tags

# 5. Verify all tags are visible on origin.
git ls-remote --tags origin 'refs/tags/archive/*' | wc -l    # expect 117 (115 + replit-agent + develop)
git ls-remote --tags origin 'refs/tags/pre-consolidation/*' | wc -l   # expect 2
```

If step 5 reports anything less than 117 + 2 = 119 archive/preconsolidation
tags, **stop**. Investigate and re-push before doing anything in §4 or §5.

---

## 4. Local prune plan (after §3 succeeds)

Once every tag in §3 is verified on origin, the local branches are deleted
**from the working copy only**. No remote-side branch deletion happens here
(see §5 for `develop`, the only origin-side mutation in this whole task).

### 4.1 `subrepl-*` branches — 115 candidates, 113 forced, 2 fast

For the two branches merged into `main` (`subrepl-cvibnjmy`, `subrepl-z1l79h1g`)
the operator can use `git branch -d` (which refuses unmerged work). For the
remaining 113, `git branch -D` is required because they carry work that did
not land in `main` — but that work is already preserved in the
`archive/<name>-2026-05-02` tag pushed in §3.

```bash
# Skip list — re-check IN_PROGRESS task list at run time and add their
# subrepl branches here. As of this report the only certain skip is the
# task agent currently running this cleanup (Task #240):
SKIP=( subrepl-q7c8dyf2 )

# Dry-run first (script default).
scripts/archive-stale-subrepl-branches.sh \
  --days 0 \
  $(printf -- '--skip %s ' "${SKIP[@]}")

# Apply, only after the dry-run looks correct.
scripts/archive-stale-subrepl-branches.sh \
  --days 0 \
  --apply \
  $(printf -- '--skip %s ' "${SKIP[@]}")
```

The script handles the safe sequence per branch: tag → push → verify on
origin → `git branch -d` (if merged) or `git branch -D` (if not). Any
failure leaves the branch in place and exits non-zero.

### 4.2 `replit-agent` — local-only deletion

The remote ref `origin/replit-agent` (if it exists) is **left untouched**.
Only the local branch is removed, after the archive tag is on origin.

```bash
# Verify tag is on origin.
git ls-remote --tags origin refs/tags/archive/replit-agent-2026-05-02 \
  | grep -q 'refs/tags/archive/replit-agent-2026-05-02$' \
  || { echo 'archive tag missing on origin — abort'; exit 1; }

# Delete local copy. -D because replit-agent has 1029 commits not on main.
git branch -D replit-agent
```

Recovery: `git fetch origin --tags && git checkout -b replit-agent archive/replit-agent-2026-05-02`

### 4.3 Branches kept for safety (do NOT delete)

| Branch                                | Why it stays                                                                 |
| ------------------------------------- | ---------------------------------------------------------------------------- |
| `main`                                | Sole integration branch (Rule 1, hygiene policy).                            |
| `develop` (local)                     | Retired in §5 by fast-forward, not deleted. Its archive tag protects history.|
| `subrepl-q7c8dyf2`                    | Working branch of THIS task (#240); cannot delete from inside itself.        |
| Any `subrepl-*` tied to IN_PROGRESS   | Re-check at run time; add via `--skip <branch>`.                             |
| Origin-side `cursor/*` and `claude/*` | Out of scope — explicit "Out of scope" item in the task plan.                |

---

## 5. `develop` retirement — fast-forward only, never force-push

After §3 has tagged `develop` as `archive/develop-2026-05-02`, attempt a
fast-forward of `origin/develop` to `origin/main`. If origin rejects the
push (because `develop` has commits not in `main`), abort and document.

```bash
# Pre-flight: confirm consolidation PR has already merged the 31 develop-
# unique commits we want to keep into main. If origin/develop is still
# ahead of origin/main, this push WILL be rejected — that is the safety net.
git fetch origin
git rev-list --left-right --count origin/main...origin/develop
# Expected output AFTER the consolidation PR merges: "<N> 0"
# Current output:                                    "36 31"

# Fast-forward (no --force ever).
git push origin origin/main:develop
```

### 5.1 Current status of develop retirement

**NOT executed.** As recorded in §1, `origin/develop` still has 31 commits
not in `origin/main`. A fast-forward would be rejected. The retirement
must wait for the consolidation PR (Task #239) to land on `origin/main`.
After that, the fast-forward becomes possible and the command above is
safe to run.

If the consolidation strategy changes and the operator decides to leave
`develop` permanently frozen instead of fast-forwarding, then:

1. Push `archive/develop-2026-05-02` per §3.
2. Update the GitHub default-branch setting so `main` is the sole default
   and `develop` can no longer be opened as a base for new PRs.
3. Add a note to this report under §5.2.

### 5.2 Operator notes (fill in after running)

```
[ ] origin/develop fast-forwarded to origin/main on YYYY-MM-DD by ____
[ ] OR origin/develop frozen at <sha> on YYYY-MM-DD; reason: ____
GitHub default branch confirmed = main on YYYY-MM-DD by ____
GitHub branch protection on main updated on YYYY-MM-DD by ____
```

#### 5.2.1 Re-verification log (Task #264, 2026-05-02, task-agent isolate)

Task #264 picked this work back up to attempt the destructive run. The isolate
re-checked the §1 preconditions against `origin` and confirmed the work
remains **BLOCKED**. No tags were pushed, no branches were deleted, and no
ref on origin was modified.

| Check                                                             | Command                                                              | Result on 2026-05-02                  | Status   |
| ----------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------- | -------- |
| Push credentials to `https://github.com/SaCH-PRO/KEYFLOWOS`       | `git push --dry-run origin HEAD:refs/heads/main`                      | `fatal: Authentication failed … Password authentication is not supported for Git operations.` | NOT MET  |
| Consolidation PR (#239) merged on `origin/main`                   | `git rev-list --left-right --count origin/main...origin/develop`      | `36 31` (unchanged from §1 snapshot)  | NOT MET  |
| `pre-consolidation/{main,develop}-2026-05-02` tags exist on origin | `git ls-remote --tags origin 'pre-consolidation/*'`                   | empty                                 | NOT MET  |
| Any `archive/*` tags already pushed                                | `git ls-remote --tags origin 'archive/*' \| wc -l`                    | `0`                                   | clean    |

Conclusion: the destructive run still has to be executed by a human operator
on a workstation that holds a GitHub PAT/SSH key with push rights to
`SaCH-PRO/KEYFLOWOS`, and only **after** the Task #239 consolidation PR has
landed on `origin/main`. The §3.1 / §4 / §5 commands are unchanged and
remain the source of truth for the run.

---

## 6. What this task actually shipped

The destructive operations in §3–§5 cannot run from the isolated task-agent
environment (the agent has no push rights to `origin` and the consolidation
PR has not yet merged). What this task *does* ship is the safe, reusable
machinery for the operator to execute the plan — plus this report.

| Deliverable                                  | Path                                                      | What it does                                                                                                       |
| -------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Branch hygiene policy                        | `docs/branch-hygiene-policy.md`                           | Going-forward rules: single integration branch (`main`), one PR per scope, archive-first deletion, weekly checks.  |
| Cleanup report (this file)                   | `BRANCH_CLEANUP_REPORT.md`                                | Verified inventory, tag manifest, prune plan, recovery commands, develop-retirement runbook.                       |
| Subrepl branch inventory (machine-readable)  | `docs/triage-appendices/subrepl-branch-inventory.tsv`     | One row per subrepl-* branch: name, full SHA, short SHA, tip commit date. Drives the archive script's manifest.    |
| Divergence-guardrail script                  | `scripts/check-branch-divergence.sh`                      | Compares two refs; exits non-zero past commit/file/line thresholds; supports `--json` and `--fetch`.               |
| Stale-subrepl archive script                 | `scripts/archive-stale-subrepl-branches.sh`               | Dry-run by default; with `--apply` does tag → push → verify-on-origin → delete-local for every eligible branch.    |

### 6.1 Smoke-test results from this isolate

```
$ scripts/check-branch-divergence.sh main develop --max-commits 25 --max-files 50
Branch divergence: main  <->  develop
  main                             a47f4d111798f9e47e739a5e3be236c6822d486b
  develop                          1f39ce48a747c9f96c82beb71fba07e91a0fc5f4
  commits unique to A:             60
  commits unique to B:             31
  files changed:                   485
  diff lines:                      +7231 / -40184 (= 47415 lines)
  thresholds:                      commits=25 files=50 lines=0
  EXCEEDED: commits-on-main:60>25 commits-on-develop:31>25 files:485>50
  exit=1   (correctly fails)

$ scripts/archive-stale-subrepl-branches.sh --days 30 --skip subrepl-cvibnjmy
mode=DRY-RUN remote=origin pattern='subrepl-*' days=30 tag-date=2026-05-02
* subrepl-0tm4a7hb  age=47d  -> archive/subrepl-0tm4a7hb-2026-05-02
  (would tag, push, verify on origin, then 'git branch -D ...')
... [and so on for each eligible branch] ...
Summary: eligible=N archived=0 deleted=0 skipped=1 errors=0
(dry-run; re-run with --apply to actually archive and delete)
```

Both scripts are dry-run by default and read-only on `origin` until the
operator passes `--apply`. They do **not** wire themselves into CI — that
is an explicit follow-up per the task's "Out of scope" section.

### 6.2 Recovery one-liners (always available)

```bash
# Restore any archived branch.
git fetch origin --tags
git checkout -b <branch> archive/<branch>-2026-05-02

# Restore develop's pre-retirement state.
git checkout -b develop-restored archive/develop-2026-05-02

# Restore replit-agent.
git checkout -b replit-agent archive/replit-agent-2026-05-02

# Roll back to the pre-consolidation main snapshot (worst case).
git checkout -b main-restore pre-consolidation/main-2026-05-02
```

### 6.3 Hand-off checklist for the operator

> **Status as of 2026-05-02 (Task #264 re-verification, see §5.2.1):**
> Steps 1 and 2 are still NOT done on `origin`. Steps 3–7 must not be
> attempted until step 1 is true and step 2 has actually pushed both
> `pre-consolidation/{main,develop}-2026-05-02` tags. Re-run the four
> probe commands in §5.2.1 to re-confirm before starting.

1. Confirm Task #239 (the consolidation PR) is merged into `origin/main`.
2. Push `pre-consolidation/main-2026-05-02` and `pre-consolidation/develop-2026-05-02`
   from §3.1 step 1 if they are not already on origin.
3. Run §3.1 steps 2–4. Verify §3.1 step 5 reports 119 tags. Stop and
   investigate if it does not.
4. Re-fetch the IN_PROGRESS task list and update the `SKIP` array in §4.1
   to include every subrepl branch tied to in-flight work.
5. Run §4.1 dry-run, then `--apply`. Run §4.2 for `replit-agent`.
6. Run §5 — but only if `git rev-list --left-right --count
   origin/main...origin/develop` reports `<N> 0`.
7. Update §5.2 with dates and operator initials.
8. **Done (Task #273).** `scripts/check-branch-divergence.sh` is wired
   into CI via `.github/workflows/branch-divergence.yml`. It runs on
   every PR targeting `main` and on every push to a known long-lived
   branch (`develop`, `staging`, `next`, `release/**`, `long-lived/**`)
   with thresholds of 25 commits / 50 files. Mark
   `Branch divergence / Check divergence vs main` as a required status
   check in GitHub branch protection for `main` to enforce the gate
   on merge. See `docs/branch-hygiene-policy.md` Rule 5 for the local
   re-run command and the temporary-bump procedure.


## 2026-06-13 follow-up — Phase 12 landing + develop retirement (in progress)

Executed by agent after Phase 12 (`feat(key-genome): add department genome framework`) was verified.

### Actions taken

1. **Landed Phase 12 on `main`** via fast-forward from `phase12-cleanup`.
2. **Pushed `main` to `origin/main`** at `ad5b5271`.
3. **Archived all old branch tips** as annotated tags:
   - `archive/develop-tip-2026-06-13` → former local `develop` tip (`fa61d97b`)
   - `archive/phase12-cleanup-tip-2026-06-13` → former `phase12-cleanup` tip (`cb954b30`)
   - `archive/backup-pre-phase12-rebase-tip-2026-06-13` → former `backup-pre-phase12-rebase` tip (`8b9087be`)
4. **Renamed and pushed archive branches** for the non-divergent tips:
   - `archive/phase12-cleanup-2026-06-13` (matches `origin/main` minus the override commit)
   - `archive/backup-pre-phase12-rebase-2026-06-13`
   - Local `develop` was renamed to `archive/develop-2026-06-13` but **not pushed as a branch** to avoid triggering the divergence guardrail; the annotated tag preserves every commit.
5. **Fast-forwarded `origin/develop` to `main`** (`cc0c4676..ad5b5271`) so it is no longer divergent while the GitHub default-branch setting is updated.
6. **Updated local `origin/HEAD`** to point to `origin/main`.
7. **Added a divergence override** in `.github/branch-divergence-overrides.yml` for `archive/develop-2026-06-13` in case it is ever pushed as a branch.

### Remaining operator step

- **Switch the GitHub default branch from `develop` to `main`** in the repository settings, then run:

  ```bash
  git push origin --delete develop
  ```

  This fully retires the `develop` branch name while preserving all commits via the archive tag.

### Recovery commands

```bash
# Restore any archived branch

git fetch origin --tags

git checkout -b develop archive/develop-tip-2026-06-13
# or
git checkout -b phase12-cleanup archive/phase12-cleanup-tip-2026-06-13
```
