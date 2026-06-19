# KP-21: Add event and ticketing Prisma models

## Milestone
Milestone 5: Events & Ticketing

## Labels
`keyportal`, `database`, `events`, `ticketing`

## Description
Add the data models required for event hosting and ticket sales.

## Acceptance Criteria
- [ ] `PortalEvent` model added with business relation.
- [ ] `TicketTier` model added with event relation.
- [ ] `EventRegistration` model added with contact relation.
- [ ] `EventAttendee` model added with registration relation.
- [ ] Unique constraints and indexes in place.
- [ ] Migration generated and applied.
- [ ] Soft-delete not required; use `status` for cancellation.

## Related PR
PR 7: Events & Ticketing Schema

## Dependencies
KP-6
