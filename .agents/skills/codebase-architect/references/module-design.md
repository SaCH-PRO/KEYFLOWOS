# Module Design

This reference defines how to design and document a domain module in the KEYFLOWOS monorepo.

## What Is a Module?

A module is a bounded context with a single responsibility, a stable public interface, and controlled dependencies. In NestJS this maps to a feature module folder; in Next.js it maps to a feature route + component/hook/api cluster; in Prisma it maps to an entity cluster.

## Module Boundaries

A well-bounded module:

- Owns one clear domain noun (e.g., `crm`, `commerce`, `business-genome`).
- Keeps implementation details private (use `dto/`, `helpers/`, `internal/` subfolders).
- Exposes only the public surface needed by other modules: controllers/services, exported DTOs/types, and emitted events.
- Does not reach into the internals of another module; it imports only public symbols.

## Public Interface

Define the module's public interface explicitly:

| Element | Example |
|---------|---------|
| Entry file / barrel | `src/modules/crm/crm.module.ts` |
| Public services | `CrmService`, `CrmContactsService`, `CrmRelationshipHealthService` |
| Public controllers | `CrmController` |
| Exported DTOs/types | `CreateContactDto`, `ContactResponse` |
| Emitted events | `contact.created`, `contact.updated`, `deal.won` |
| Consumed events | `user.signed-up`, `invoice.paid` |
| External integrations | Stripe, Twilio, Google Contacts |

## Dependencies and Dependents

For each module, record:

- **Dependencies** — modules/packages this module imports from.
- **Dependents** — modules/packages that import from this module.
- **Circular dependencies** — any `forwardRef(() => ...)` or import cycle; must be called out explicitly.
- **External integrations** — third-party APIs, SDKs, protocols, env vars.

## Events

Modules communicate across boundaries primarily via the NestJS event bus (`@nestjs/event-emitter`) and secondarily via tRPC/REST calls.

- **Publisher** — emit a typed payload from `core/event-bus/events.types.ts`.
- **Consumer** — listen with `@OnEvent('event.name')` and keep the handler thin; delegate to the module's own service.
- **Event names** — use `domain.action` format (`booking.created`, `invoice.paid`).
- **Avoid** — emitting events from deep inside utility functions; emit from services/controllers.

## Module Splitting Heuristics

Split a module when it exhibits any of the following:

- More than ~15 public services or ~25 total files without sub-domain cohesion.
- Multiple unrelated noun clusters (e.g., invoices + campaigns + payroll).
- High fan-in and high fan-out creating a change-amplification risk.
- A natural seam defined by events or a separate data-ownership boundary.

## Module Registry Entry

Every module should have a registry entry in `architecture/module-registry.md` containing:

```markdown
### `crm`
- **Responsibility:** Contact, account, deal, and CRM activity management.
- **Files:** `apps/server/src/modules/crm/*.ts`, `apps/web/src/app/app/crm/**`, `packages/api/src/routers/crm.ts`.
- **Dependencies:** `@keyflow/db`, `core/event-bus`, `core/redis`, `modules/ai`.
- **Dependents:** `modules/key-cortex`, `modules/commerce`, `modules/bookings`.
- **Events published:** `contact.created`, `deal.won`.
- **Events consumed:** `user.signed-up`.
- **External integrations:** Google Contacts, Twilio.
```

## Anti-Patterns

- Leaking another module's DTOs into your public interface.
- Calling another module's service methods from deep inside helpers instead of from an orchestrator.
- Adding new responsibilities to `key-cortex` or `ai` just because they are large.
- Creating new global modules without a strong cross-cutting justification.
