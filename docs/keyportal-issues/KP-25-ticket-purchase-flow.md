# KP-25: Ticket purchase flow

## Milestone
Milestone 5: Events & Ticketing

## Labels
`keyportal`, `frontend`, `backend`, `ticketing`, `payments`

## Description
Implement the end-to-end ticket purchase experience.

## Acceptance Criteria
- [ ] Customer selects ticket tier and quantity.
- [ ] Attendee details form collects name/email/phone per attendee.
- [ ] Registration created with `PENDING` status and unique `receiptToken`.
- [ ] Payment initiated via existing payment providers.
- [ ] On payment success, registration status becomes `CONFIRMED`.
- [ ] Stock/quantitySold updated atomically.
- [ ] CRM contact upserted.
- [ ] `PortalTransaction` written.

## Related PR
PR 10: Ticket Payment & Receipt

## Dependencies
KP-22, KP-24, KP-17, KP-20
