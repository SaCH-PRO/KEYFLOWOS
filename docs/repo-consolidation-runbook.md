# Repo Consolidation Runbook

This runbook defines the operational standard for keeping local, Cursor, GitHub, and deployment state synchronized.

## Source of Truth Rules

1. `develop` is the integration branch.
2. Every feature or fix must be on one `cursor/*` branch with one PR.
3. Do not keep multiple open PRs for the same scope.
4. Use one deployment target per concern:
   - `apps/web` for frontend preview/deploy checks.
   - `apps/server` for backend preview/deploy checks.

## Daily Consolidation Routine

1. Sync local with remote:
   - `git checkout develop`
   - `git pull origin develop`
2. Run the repository health audit:
   - `bash scripts/repo-health-audit.sh develop /opt/cursor/artifacts`
3. Review open PR overlap:
   - close PRs that are superseded by a newer branch.
4. For all active work, rebase or cherry-pick onto a single active branch per scope.

## Safe Branch Cleanup Checklist

For each open branch:

1. Compare divergence against `develop`.
2. Confirm whether commits are already merged elsewhere.
3. Keep branch if it has unique required commits.
4. Close PR and delete branch if fully superseded.

## Deployment Stabilization

### Vercel Server Project (`apps/server`)

This repo now includes:

- `apps/server/api/index.ts` for Vercel serverless entrypoint.
- `apps/server/vercel.json` for route/build wiring.

Ensure Vercel project settings:

1. Root directory = `apps/server`
2. Framework preset = Other
3. Build/Output inferred from `vercel.json`
4. Required env vars are configured in Vercel project settings.

### Vercel Web Project (`apps/web`)

Use a separate Vercel project for frontend checks and previews:

1. Root directory = `apps/web`
2. Framework preset = Next.js
3. Install/build commands use workspace-aware defaults.

## Incident Procedure: "State is fragmented"

If local/GitHub/deploys are out of sync:

1. Freeze merges temporarily.
2. Generate audit report with `scripts/repo-health-audit.sh`.
3. Select one consolidation branch off `develop`.
4. Cherry-pick only required commits.
5. Verify with targeted lint + build.
6. Open one consolidation PR.
7. Close superseded PRs/branches.

