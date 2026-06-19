# KP-3: Add `/portal/[slug]/services` sub-route

## Milestone
Milestone 1: Portal Foundation

## Labels
`keyportal`, `frontend`, `routes`, `services`

## Description
Create the services listing sub-route under the KEYPORTAL route group. Reuse the existing public services API.

## Acceptance Criteria
- [ ] Route `apps/web/src/app/portal/[slug]/services/page.tsx` exists.
- [ ] Page fetches services from existing `GET /bookings/public/businesses/:businessId/services`.
- [ ] Services are rendered as cards with name, description, duration, price.
- [ ] Clicking a service opens detail view or navigates to booking flow.
- [ ] Empty state shown when no services exist.
- [ ] Mobile responsive.

## Related PR
PR 2: Portal Sub-Routes

## Dependencies
KP-1
