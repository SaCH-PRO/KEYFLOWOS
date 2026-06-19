# KP-13: Build catalog normalizer

## Milestone
Milestone 3: Unified Catalog

## Labels
`keyportal`, `backend`, `catalog`, `data`

## Description
Create a normalizer that maps heterogeneous source models (`Service`, `Product`, future `TicketTier`) into a common `PortalCatalogItem` shape.

## Acceptance Criteria
- [ ] `catalog-normalizer.ts` exports `normalizeService()`, `normalizeProduct()`.
- [ ] Each function returns a typed `PortalCatalogItem`.
- [ ] `type` enum supports `SERVICE`, `PRODUCT`, `PACKAGE`, `DIGITAL`, `TICKET`.
- [ ] `requiresBooking` is `true` for services.
- [ ] `purchasable` respects product availability and inventory.
- [ ] Unit tests cover normalization logic.
- [ ] Extensible stub for future `TICKET` type.

## Related PR
PR 5: Unified Catalog

## Dependencies
KP-11
