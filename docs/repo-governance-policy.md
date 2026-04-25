# Repo Governance Policy

This policy keeps local, Cursor, GitHub, and deployment state synchronized.

## Non-Negotiable Rules

1. `develop` is the integration branch.
2. Every implementation task must use one `cursor/*` branch.
3. One branch maps to one active PR only.
4. Do not keep multiple open PRs for the same scope.
5. Merge or close stale PRs quickly; do not accumulate drift.
6. Use dedicated deploy projects:
   - frontend checks from `apps/web`
   - backend checks from `apps/server`

## Daily Operator Routine

1. Sync and move to integration base:
   - `git checkout develop`
   - `git pull origin develop`
2. Run hygiene checks:
   - `pnpm repo:health`
   - `pnpm repo:guard`
3. If issues are found:
   - close superseded PRs
   - delete superseded branches
   - create one consolidation branch if commits must be merged

## Pull Request Hygiene

- PR title must represent one scope.
- PR body must include:
  - change summary
  - test evidence
  - known warnings or non-blocking constraints
- PRs with no unique commits ahead of `develop` must be closed.

## Recovery Protocol (Fragmentation Event)

When state is fragmented:

1. Freeze merges.
2. Run `pnpm repo:health` and review divergence/open PR overlap.
3. Create one branch from `develop`.
4. Cherry-pick only required commits.
5. Validate with targeted lint + build + walkthrough evidence.
6. Open one consolidation PR.
7. Close and delete superseded PR branches.
