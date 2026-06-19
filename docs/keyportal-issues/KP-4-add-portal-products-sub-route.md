# KP-4: Add `/portal/[slug]/products` sub-route

## Milestone
Milestone 1: Portal Foundation

## Labels
`keyportal`, `frontend`, `routes`, `products`

## Description
Create the products listing sub-route under the KEYPORTAL route group. Reuse the existing public products API.

## Acceptance Criteria
- [ ] Route `apps/web/src/app/portal/[slug]/products/page.tsx` exists.
- [ ] Page fetches products from existing `GET /catalog/public/businesses/:businessId/products`.
- [ ] Products are rendered as cards with image, name, price, stock status.
- [ ] Clicking a product opens detail view or adds to cart.
- [ ] Empty state shown when no products exist.
- [ ] Mobile responsive.

## Related PR
PR 2: Portal Sub-Routes

## Dependencies
KP-1
