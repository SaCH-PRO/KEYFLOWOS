# KP-14: Migrate `/portal/[slug]` to catalog endpoint

## Milestone
Milestone 3: Unified Catalog

## Labels
`keyportal`, `frontend`, `catalog`, `refactor`

## Description
Update the public KEYPORTAL pages to consume the unified catalog endpoint instead of separate services/products endpoints.

## Acceptance Criteria
- [ ] `/portal/[slug]` page calls `GET /catalog/public/:slug`.
- [ ] `/portal/[slug]/services` filters catalog by `type === SERVICE`.
- [ ] `/portal/[slug]/products` filters catalog by `type === PRODUCT`.
- [ ] Client-side service/product merge logic is removed.
- [ ] No duplicate API calls.
- [ ] Loading and error states preserved.
- [ ] Types match `PortalCatalogItem`.

## Related PR
PR 5: Unified Catalog

## Dependencies
KP-12, KP-13
