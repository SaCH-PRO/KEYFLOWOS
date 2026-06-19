# KP-12: Build `GET /catalog/public/:slug`

## Milestone
Milestone 3: Unified Catalog

## Labels
`keyportal`, `backend`, `api`, `catalog`

## Description
Implement the primary public catalog endpoint that returns all portal-offerable items in a single normalized shape.

## Acceptance Criteria
- [ ] Endpoint `GET /catalog/public/:slug` exists.
- [ ] Resolves `businessId` from slug.
- [ ] Fetches active `Service` records.
- [ ] Fetches active `Product` records with inventory status.
- [ ] Maps items to `PortalCatalogItem` type:
  - `id`, `businessId`, `type`, `name`, `description`, `price`, `currency`, `imageUrl`
  - `requiresBooking`, `purchasable`, `stockStatus`, `durationMins`
  - `sourceProductId`, `sourceServiceId`, `metadata`
- [ ] Filters out soft-deleted and inactive items.
- [ ] Applies public rate limiting.
- [ ] Returns 404 if business not found or portal not published.

## Related PR
PR 5: Unified Catalog

## Dependencies
KP-11
