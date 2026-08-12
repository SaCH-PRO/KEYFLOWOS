---
name: codebase-architect
description: Maintain an accurate architectural map of the repository before and after significant changes. Use this skill for refactoring, adding features, splitting modules, or any work that touches cross-file dependencies, public interfaces, events, or data models.
user-invocable: true
---

# Codebase Architect

This skill enforces a **map-before-modifying** workflow for the KEYFLOWOS monorepo. It keeps the architecture documents in `/architecture/` and the skill references in `.agents/skills/codebase-architect/` synchronized with the code.

## Core Rule: MAP BEFORE MODIFYING

Before any significant change, read or regenerate the relevant architecture memory files. A "significant change" is anything that:

- Adds, removes, or renames a module, service, controller, router, or package.
- Changes a public interface (exports, DTOs, tRPC procedures, API routes).
- Introduces or removes an import edge between two domains.
- Adds or modifies a domain event, webhook, or external integration.
- Alters the Prisma schema or a key data flow.
- Touches authentication, tenant isolation, or the bootstrap path.

If the map is out of date, update it first (or immediately after the change). Do not rely on memory.

## Architecture Memory Files

Canonical architecture memory lives in `/architecture/`:

| File | Purpose |
|------|---------|
| `system-overview.md` | High-level system description, tech stack, apps/packages, entry points. |
| `repository-map.md` | Canonical directory tree and per-file responsibility table. |
| `dependency-map.md` | Major import/dependency relationships between modules and packages. |
| `execution-paths.md` | Major execution pathways (auth, onboarding, key workflows) with file paths and symbols. |
| `data-model.md` | Database entities, Prisma schema scale, and key data flows. |
| `module-registry.md` | Proposed domain modules with responsibility, files, dependencies, dependents, events, integrations. |
| `architecture-risks.md` | Critical/high/medium/low risks: circular deps, large modules, version mismatches, etc. |
| `target-architecture.md` | Target direction and design principles. |
| `migration-plan.md` | Living migration plan for moving from current to target architecture. |
| `architecture.json` | Machine-readable graph of modules, files, symbols, dependencies, paths, entities, integrations, risks. |

Additional generated registries already live in `/architecture/` (`module-registry.yaml`, `route-registry.yaml`, `event-registry.yaml`, `capability-registry.yaml`, `data-ownership.yaml`). Treat them as read-only inputs unless you are explicitly regenerating them.

Skill references live in `.agents/skills/codebase-architect/references/`:

| File | Purpose |
|------|---------|
| `mapping-standard.md` | How to classify files, layers, public interfaces, and side effects. |
| `module-design.md` | How to design a module (boundaries, public interface, events). |
| `refactoring-rules.md` | Concrete refactoring rules (small, reversible, tests first). |

Deterministic scanners live in `.agents/skills/codebase-architect/scripts/`:

| Script | Purpose |
|--------|---------|
| `inventory.py` | Walks the repo and emits a JSON inventory of files, directories, imports, exports, and metrics. |
| `dependency_scan.py` | Extracts import edges from `.ts/.tsx/.js` files and emits a dependency graph JSON. |

## Modes

Use these modes as the lifecycle for any architecture-affecting task.

### Mode 1 — Explore

Inventory the codebase without modifying anything. Run the deterministic scanners, read the generated registries, and produce a concise cartography report.

- Use `inventory.py` and `dependency_scan.py` to establish baseline facts.
- Record file responsibilities, public interfaces, important imports, dependents, external services, data entities, side effects, layer, and confidence.
- Exclude `node_modules`, `.git`, `.next`, `dist`, `build`, `.turbo`, `coverage`, runtime logs, and attached assets.

### Mode 2 — Map

Synthesize the exploration output into human-readable architecture documents:

- `system-overview.md`
- `repository-map.md`
- `dependency-map.md`
- `execution-paths.md`
- `data-model.md`

Keep maps concise enough to read, but precise enough to navigate.

### Mode 3 — Analyze

Find risks and hotspots:

- Circular dependencies (`forwardRef`, import cycles).
- Oversized modules (file count, line count, fan-in/fan-out).
- Orphaned routes, events, or files.
- Version mismatches, duplicated logic, or leaked boundaries.
- Security/tenant isolation gaps.

Record findings in `architecture-risks.md` with severity, evidence, and recommended next step.

### Mode 4 — Design

Define the target architecture:

- Proposed module boundaries and public interfaces.
- Where new code belongs and what it may depend on.
- Events, queues, and external integrations involved.
- Data-model changes and migration considerations.

Write or update `target-architecture.md` and `module-registry.md`.

### Mode 5 — Plan

Turn the design into a sequenced, reversible migration plan in `migration-plan.md`:

- Order: tests → internal refactor → interface change → consumer updates → cleanup.
- Each step must be small, independently verifiable, and rollback-friendly.
- Identify affected files, tests to add/update, and verification commands.

### Mode 6 — Refactor

Execute the plan one step at a time. Follow the rules in `references/refactoring-rules.md`:

- Preserve public interfaces until consumers are migrated.
- Add tests before changing behavior.
- Make the smallest change that satisfies the step.
- Never mix unrelated refactors with feature work.

### Mode 7 — Validate

After each step, run the relevant verification:

- `pnpm typecheck`
- `pnpm lint` (or the lint ratchet)
- affected unit tests (`vitest`)
- affected build (`pnpm build` for server/web/packages)
- diff review (`git diff --stat`, `git diff`)

Fix regressions before proceeding.

### Mode 8 — Document

Update architecture memory to reflect the new state:

- Re-run `inventory.py` and `dependency_scan.py`.
- Update affected sections in `/architecture/*.md`.
- Update `architecture.json`.
- Add new risks or retire resolved ones in `architecture-risks.md`.
- Append a dated changelog entry to `migration-plan.md`.

## Exploration Principle

Exploration must be **read-first, deterministic, and reproducible**. Prefer scripted analysis over ad-hoc shell greps. When you do grep, record the query and the resulting evidence so the next agent can reproduce it. Keep confidence levels honest: `High` for files read directly, `Medium` for inferred from imports/grep, `Low` for runtime behavior not verified.

## Update Architecture Docs After Changes

Every pull request or agent run that changes architecture-affecting code must leave the architecture memory accurate. The minimum update is:

1. Re-run the scanners.
2. Update `architecture.json`.
3. Edit the relevant `.md` files (usually `dependency-map.md`, `module-registry.md`, `execution-paths.md`, `data-model.md`, `architecture-risks.md`).
4. If the change advances the migration, update `migration-plan.md`.

If you are unsure whether a change is architecture-affecting, treat it as architecture-affecting and update the map.
