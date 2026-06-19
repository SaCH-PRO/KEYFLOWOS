# KP-23: Owner event creation UI

## Milestone
Milestone 5: Events & Ticketing

## Labels
`keyportal`, `frontend`, `dashboard`, `events`

## Description
Build the owner-facing event management interface under `/app/keyportal/events`.

## Acceptance Criteria
- [ ] `/app/keyportal/events` lists business events.
- [ ] `/app/keyportal/events/create` form includes title, slug, description, image, date/time, timezone, location.
- [ ] Event status can be set to `DRAFT` or `PUBLISHED`.
- [ ] Ticket tier form embedded in event create/edit flow.
- [ ] Capacity and sale window controls per tier.
- [ ] Validation prevents duplicate slugs per business.
- [ ] Save/create calls events API.

## Related PR
PR 9: Events Frontend

## Dependencies
KP-22
