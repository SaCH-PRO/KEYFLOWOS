# KP-27: Add `PortalPromo` model

## Milestone
Milestone 6: Promotions

## Labels
`keyportal`, `database`, `promos`

## Description
Create the model for visible promotions inside the portal.

## Acceptance Criteria
- [ ] `PortalPromo` model added to schema.
- [ ] Links to `Business` and optionally `PromoCode`.
- [ ] Supports target types: `SERVICE`, `PRODUCT`, `EVENT`, `TICKET_TIER`, `PORTAL`.
- [ ] Scheduling fields: `startsAt`, `endsAt`.
- [ ] `featured` and `active` flags.
- [ ] Migration generated and applied.

## Related PR
PR 11: Portal Promos

## Dependencies
KP-6
