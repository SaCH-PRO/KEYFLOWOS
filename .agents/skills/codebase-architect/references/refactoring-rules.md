# Refactoring Rules

These rules keep architecture changes safe and reviewable.

## 1. Map Before Modifying

Read or update the relevant `/architecture/*.md` files before changing code. If the map does not exist for the area you are touching, create it first.

## 2. One Concern Per Change

Each commit/PR/agent turn should do one thing:

- Rename a symbol and update all imports.
- Extract a service.
- Move a cluster of files to a new module.
- Update a public interface and its consumers.

Do not bundle unrelated cleanups, renames, and feature work.

## 3. Preserve Public Interfaces

When refactoring internals, keep the old public API intact until all consumers are migrated. If you must break it:

1. Add the new interface alongside the old one.
2. Migrate internal callers.
3. Migrate external callers.
4. Remove the old interface in a follow-up change.

## 4. Tests First

Before changing behavior, add or update a test that captures the current or intended behavior. Refactorings must keep existing tests green unless the test itself was testing the old, wrong behavior.

## 5. Small, Reversible Steps

Prefer many small changes over one large rewrite. Each step should be reversible with a single `git revert` and should not leave the repo in a broken state.

## 6. Do Not Chase Perfection

Leave unrelated code alone. Do not reformat files you are not changing. Do not rename symbols unless required. A tidy, focused diff is more valuable than an opportunistic cleanup.

## 7. Verify After Every Step

Run at least the relevant verification for the scope:

- Type check: `pnpm typecheck` or `cd <app/package> && pnpm typecheck`
- Lint: `pnpm lint` or `cd <app/package> && pnpm lint`
- Tests: `vitest run <pattern>` or `pnpm test:unit`
- Build: `pnpm build` for the changed package/app
- Diff review: `git diff --stat` and inspect the diff for unintended changes

## 8. Update the Map After the Change

After each architecture-affecting step:

1. Re-run `inventory.py` and `dependency_scan.py`.
2. Update `architecture.json`.
3. Edit affected `/architecture/*.md` files (dependency map, module registry, execution paths, data model, risks).
4. Record progress in `migration-plan.md`.

## 9. Never Break the Bootstrap Path

Changes to `apps/server/src/main.ts`, `app.module.ts`, `app-bootstrap.ts`, `packages/db/src/client.ts`, `apps/web/src/app/app/layout.tsx`, or `next.config.ts` require extra scrutiny. Always start the app locally after these changes.

## 10. Document Exceptions

If you intentionally violate any of these rules (e.g., an emergency hotfix), add a `// ARCHITECTURE-DEBT:` comment and an entry in `architecture-risks.md` with a remediation plan.
