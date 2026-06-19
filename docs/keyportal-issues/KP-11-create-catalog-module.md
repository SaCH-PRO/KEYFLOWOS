# KP-11: Create `CatalogModule`

## Milestone
Milestone 3: Unified Catalog

## Labels
`keyportal`, `backend`, `catalog`, `architecture`

## Description
Create a new NestJS module that will serve as the single source of truth for public catalog data across services, products, packages, and future ticket tiers.

## Acceptance Criteria
- [ ] Directory `apps/server/src/modules/catalog` exists.
- [ ] `catalog.module.ts` registered in the app module.
- [ ] `catalog.service.ts` skeleton with business lookup helper.
- [ ] `catalog.controller.ts` for internal/owner endpoints.
- [ ] `catalog-public.controller.ts` for public endpoints.
- [ ] `catalog-normalizer.ts` helper created.
- [ ] Module has unit test scaffold.

## Related PR
PR 5: Unified Catalog

## Dependencies
KP-7
