# KP-20: Portal transaction ledger

## Milestone
Milestone 4: Harden Transactions

## Labels
`keyportal`, `backend`, `database`, `ledger`

## Description
Introduce `PortalTransaction` as a unified receipt and transaction index across bookings, orders, event tickets, invoices, and deposits.

## Acceptance Criteria
- [ ] `PortalTransaction` model added to schema.
- [ ] Migration generated and applied.
- [ ] `receiptNumber` and `receiptToken` are unique.
- [ ] Service writes a `PortalTransaction` on booking creation.
- [ ] Store order service writes a `PortalTransaction` on order creation.
- [ ] `PortalTransaction` is updated when payment status changes.
- [ ] Receipt pages read from `PortalTransaction`.

## Related PR
PR 6: Harden Transactions

## Dependencies
KP-6, KP-19
