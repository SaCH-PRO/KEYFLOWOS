# KP-18: Inventory reservation for product orders

## Milestone
Milestone 4: Harden Transactions

## Labels
`keyportal`, `backend`, `inventory`, `orders`

## Description
Prevent overselling by implementing inventory reservation/decrement during the checkout process.

## Acceptance Criteria
- [ ] Checkout validates product stock before creating order.
- [ ] Stock is reserved when checkout begins (configurable TTL).
- [ ] Stock is decremented on successful payment.
- [ ] Stock is released on payment failure/timeout.
- [ ] Handles concurrent checkouts safely (DB-level locking or atomic decrement).
- [ ] `MarketplaceOrderItem` links to product and records snapshot data.

## Related PR
PR 6: Harden Transactions

## Dependencies
None
