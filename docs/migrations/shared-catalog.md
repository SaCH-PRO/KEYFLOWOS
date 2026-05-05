# Shared Catalog Migration (S1)

## Summary
Promote `Product` and `Service` to a single `Catalog` server module. All
write paths in Store, Commerce, and Bookings now route through
`CatalogService`. Existing HTTP endpoints remain as **deprecated thin
pass-throughs** so clients keep working while we migrate.

## Data migration
**None required.** The Prisma models `Product` and `Service` (and tables
`products` / `services`) keep their existing names and shapes. Only the
*access path* changed — code paths now go through `CatalogService`
instead of writing Prisma directly.

## Affected code

### New
- `apps/server/src/modules/catalog/catalog.module.ts`
- `apps/server/src/modules/catalog/catalog.service.ts` — sole owner of
  Product + Service CRUD.
- `apps/server/src/modules/catalog/catalog.controller.ts` — canonical
  HTTP surface at `/catalog/businesses/:businessId/products` and
  `/catalog/businesses/:businessId/services`.
- `apps/server/src/modules/catalog/dto/catalog-service.dto.ts`
- `apps/server/src/modules/catalog/catalog.boundary.spec.ts` — module
  boundary test that fails the build if anything outside Catalog writes
  Product/Service via Prisma.

### Refactored to delegate to `CatalogService`
- `apps/server/src/modules/commerce/commerce.service.ts` — product CRUD
  is now a pass-through.
- `apps/server/src/modules/commerce/commerce-ai.service.ts` —
  `create_product` / `update_product` / `deactivate_product` AI commands
  go through Catalog.
- `apps/server/src/modules/commerce/store-readiness.service.ts` —
  `backfillSourceProductIds` uses `CatalogService.linkServiceToProduct`.
- `apps/server/src/modules/bookings/bookings.controller.ts` — service
  CRUD endpoints are pass-throughs to Catalog.

### Events
Canonical events added in
`apps/server/src/core/event-bus/events.types.ts`:

- `catalog.product.created` / `catalog.product.updated` / `catalog.product.deleted`
- `catalog.service.created` / `catalog.service.updated` / `catalog.service.deleted`

Legacy `product.created` / `product.updated` / `product.deactivated`
events are **still emitted alongside** the new canonical events to keep
existing listeners (notifications, automations, gamification, etc.)
working. Once all listeners migrate to the `catalog.*` channel, the
legacy emissions can be removed.

## Endpoint deprecations
The following endpoints continue to work but are marked `@deprecated`
in the controllers. Plan to remove after S5 once admin and embeds use
the canonical Catalog endpoints exclusively.

- `GET    /commerce/businesses/:id/products`             → `GET    /catalog/businesses/:id/products`
- `GET    /commerce/public/businesses/:id/products`      → `GET    /catalog/public/businesses/:id/products`
- `POST   /commerce/businesses/:id/products`             → `POST   /catalog/businesses/:id/products`
- `PATCH  /commerce/businesses/:id/products/:productId`  → `PATCH  /catalog/businesses/:id/products/:productId`
- `PATCH  /commerce/businesses/:id/products/bulk`        → `PATCH  /catalog/businesses/:id/products/bulk`
- `DELETE /commerce/businesses/:id/products/:productId`  → `DELETE /catalog/businesses/:id/products/:productId`
- `GET    /bookings/businesses/:id/services`             → `GET    /catalog/businesses/:id/services`
- `POST   /bookings/businesses/:id/services`             → `POST   /catalog/businesses/:id/services`
- `PATCH  /bookings/businesses/:id/services/:serviceId`  → `PATCH  /catalog/businesses/:id/services/:serviceId`
- `DELETE /bookings/businesses/:id/services/:serviceId`  → `DELETE /catalog/businesses/:id/services/:serviceId`
- `POST   /bookings/businesses/:id/services/batch`       → `POST   /catalog/businesses/:id/services/batch`

## Module boundaries
The new test `catalog.boundary.spec.ts` greps the server source tree for
direct Prisma writes to `product` / `service` models outside the
Catalog module and fails if any are introduced. Reads are still allowed
anywhere — Store, Commerce, and Bookings continue to read from Prisma.

## Out of scope (handled later)
- Renaming Prisma models. Models keep their names (`Product`, `Service`)
  and table names (`products`, `services`).
- Public Catalog presentation — owned by Presence editor (S3).
- Stock + money + bookings flow integration — S2.
