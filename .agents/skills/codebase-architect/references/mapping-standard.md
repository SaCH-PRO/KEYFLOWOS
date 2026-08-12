# Mapping Standard

This reference defines how to classify and document files, modules, and layers during codebase cartography.

## Exclusion Rules

The following directories and file patterns must always be excluded from architectural inventories:

- `node_modules/`, `.pnpm/`, `.venv*/`
- `.git/`, `.github/` (process docs only, workflows are relevant but generated diffs are not)
- Build outputs: `.next/`, `dist/`, `build/`, `.turbo/`, `coverage/`, `.cache/`
- Runtime logs: `logs/`, `*.log`, `.api-server*.log`, `.build*.log`
- Binary assets: `attached_assets/`, `audit-output/`, `artifacts/`, screenshots, media
- Lock files: `pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`
- Generated Prisma client code unless discussing the generator itself

## Classification Dimensions

For every source file worth cataloging, record:

| Dimension | Question | Examples |
|-----------|----------|----------|
| **Path** | Where is the file? | `apps/server/src/modules/crm/crm.service.ts` |
| **Responsibility** | What does it do in one sentence? | Orchestrates contact CRUD and relationship health. |
| **Public interface** | What is exported for consumers? | `CrmService`, `CreateContactDto` |
| **Important imports** | Which modules/packages does it import? | `@keyflow/db`, `core/event-bus`, `modules/ai` |
| **Important dependents** | Which files import it? | `crm.controller.ts`, `key-cortex-context-v2.service.ts` |
| **External services** | Which external APIs does it call? | Stripe, Supabase, OpenAI, LiveKit |
| **Data entities** | Which Prisma models/types does it touch? | `Contact`, `Deal`, `ContactTag` |
| **Side effects** | Does it mutate global state, network, disk, timers? | Redis writes, BullMQ enqueue, file upload, `setInterval` |
| **Layer** | Architectural layer (see below) | `Service`, `Controller`, `UI component`, `API Client` |
| **Confidence** | How sure are you? | `High`, `Medium`, `Low` |

## Layer Taxonomy

Use these layer labels consistently:

- **Entry / Bootstrap** — `main.ts`, `app-bootstrap.ts`, `layout.tsx`
- **Composition Root** — `app.module.ts`, `root.ts`, `providers.tsx`
- **Controller / Route Handler** — NestJS controllers, Next.js page/api route, tRPC routers
- **Service** — domain/business logic service
- **Data Access** — Prisma client, repository, DB utility
- **Integration** — connector implementation, external API client, webhook handler
- **Integration Contract** — interface/types for integrations
- **Domain Contracts** — event payloads, shared types, DTOs
- **Security** — auth middleware, guards, crypto, token handling
- **Infrastructure** — Redis, object storage, event bus, tenant context, config
- **UI kit root / UI component / UI layout / UI utility** — presentational React components and helpers
- **API Client** — typed fetch wrappers, tRPC client hooks
- **Context / Provider** — React context, NestJS module providers
- **Hook** — React/custom hooks
- **Config** — env validation, TS config, build config
- **Test / Diagnostic** — specs, smoke tests, one-off scripts

## Confidence Levels

- **High** — File read directly and behavior is explicit.
- **Medium** — Inferred from imports, grep, registry, or local context.
- **Low** — Directory presence or naming only; runtime behavior not verified.

## Directory Tree Conventions

- Collapse deeply repeated patterns after showing the first few examples.
- Mark generated/build directories as excluded.
- Use code fences for trees and tables for file responsibilities.

## Symbol Recording

For important files, list exported symbols (classes, functions, types, constants). Do not list every helper; focus on what consumers depend on.
