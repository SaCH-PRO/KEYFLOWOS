# KP-19: Payment status standardization

## Milestone
Milestone 4: Harden Transactions

## Labels
`keyportal`, `backend`, `payments`, `standardization`

## Description
Unify payment status values across booking, order, and future event flows.

## Acceptance Criteria
- [ ] Define canonical enum: `UNPAID`, `PENDING`, `PAID`, `REFUNDED`, `FAILED`.
- [ ] Update `Booking.paymentStatus` usage to canonical values.
- [ ] Update `MarketplaceOrder.paymentStatus` usage to canonical values.
- [ ] Update webhook handlers to emit canonical statuses.
- [ ] Migration to normalize existing data if needed.
- [ ] Type-safe status helpers created.

## Related PR
PR 6: Harden Transactions

## Dependencies
None
