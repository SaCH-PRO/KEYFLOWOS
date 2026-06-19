# KP-17: CRM contact linkage for all checkout flows

## Milestone
Milestone 4: Harden Transactions

## Labels
`keyportal`, `backend`, `crm`, `checkout`

## Description
Ensure every public transaction (booking, order, future ticket) creates or links to a CRM `Contact`.

## Acceptance Criteria
- [ ] Booking flow upserts `Contact` from customer details.
- [ ] Storefront order flow upserts `Contact` from customer details.
- [ ] Contact deduplication by email + businessId.
- [ ] Phone normalization applied.
- [ ] `Contact.source` set to `KEYPORTAL_BOOKING` or `KEYPORTAL_ORDER`.
- [ ] Unit tests for upsert logic.

## Related PR
PR 6: Harden Transactions

## Dependencies
None
