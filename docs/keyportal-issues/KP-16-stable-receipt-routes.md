# KP-16: Stable receipt routes

## Milestone
Milestone 4: Harden Transactions

## Labels
`keyportal`, `frontend`, `receipts`, `transactions`

## Description
Create canonical receipt pages for bookings and orders under the `/portal/[slug]` route group.

## Acceptance Criteria
- [ ] `/portal/[slug]/booking/[token]/page.tsx` exists.
- [ ] `/portal/[slug]/order/[token]/page.tsx` exists.
- [ ] Pages fetch receipt data by token.
- [ ] Display: business name, customer name, item details, amount, payment status, date, receipt number.
- [ ] Works on mobile and is shareable via URL.
- [ ] Graceful 404 for invalid/expired tokens.

## Related PR
PR 6: Harden Transactions

## Dependencies
KP-20
