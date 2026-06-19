# KP-30: Promo-to-checkout tracking

## Milestone
Milestone 6: Promotions

## Labels
`keyportal`, `backend`, `analytics`, `promos`

## Description
Track when a customer clicks a promo and completes a transaction.

## Acceptance Criteria
- [ ] Clicking a promo logs `portal_promo_clicked` analytic event.
- [ ] Promo ID attached to checkout session metadata where applicable.
- [ ] Successful checkout logs `portal_promo_converted` event.
- [ ] Promo conversion counts stored or derivable from events.
- [ ] Works for service bookings, product orders, and event tickets.

## Related PR
PR 11: Portal Promos

## Dependencies
KP-29
