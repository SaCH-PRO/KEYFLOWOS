# KF-EXEC-SPACE-001 — KeyFlow Space, Events, Registration & Ticketing

Status: **EXECUTION-GRADE PRE-IMPLEMENTATION PACKET / NO PRODUCTION AUTHORIZATION**  
Wave: D  
Primary journey: J21 Public Customer Experience  
Primary kernels: K1/K5/K6/K7/K8/K9/K10/K11/K12  
Dependencies: `KF-EXEC-PUBLIC-001`, `KF-EXEC-COMMERCE-001`, `KF-EXEC-FINANCE-001`, `KF-EXEC-TIME-001`, `KF-EXEC-UX-001` integration coordination  
Product blueprint: `docs/intelligence/product/KEYFLOW-SPACE-CAPABILITY-BLUEPRINT.md`

## Objective

Create the public platform layer through which any business or organization can present itself, sell products/services, accept bookings, publish events, register attendees, sell/issue tickets, receive payments and route customers into bounded portal experiences—without duplicating the underlying CRM, booking, commerce, financial or workflow domains.

## Locked product outcome

A business should be able to create a Space such as:

```text
keyflow.app/{business}
```

and selectively expose:

- website/presence;
- services;
- storefront;
- bookings;
- events;
- forms;
- quotes/payments;
- portal entry.

Events must support free registration and paid ticketing.

## Existing seams to revalidate on current main

- site/presence/storefront models and routes;
- public booking;
- LeadForm;
- commerce order/checkout;
- public quote/invoice/payment links;
- PortalAccess;
- Contact/customer identity;
- payment providers/webhooks;
- marketing/social publishing;
- document generation;
- public frontend routing and branding.

No new implementation begins until current-main characterization identifies what can be reused versus migrated.

## Conceptual domain additions to evaluate

Do not assume one table per concept. Reuse first.

- BusinessSpace / public presence configuration;
- page/section/module configuration;
- Event;
- EventSession;
- TicketType;
- EventRegistration;
- RegistrationAnswer;
- TicketCredential;
- CheckIn;
- Waitlist;
- Speaker/Sponsor/Exhibitor associations;
- event publication/version identity.

Exact schema is an implementation-time migration decision after current-main characterization.

## Locked invariants

1. Space maps to exactly one trusted business/organization tenant.
2. Custom domain/slug is routing identity, not a separate tenant.
3. Public modules project existing domain truth rather than create duplicate source systems.
4. Event publication state is distinct from event lifecycle state.
5. Registration occurrence is distinct from payment occurrence.
6. Free registration is financially empty, not a zero-value fake payment.
7. Ticket inventory/capacity is atomically owned at commit.
8. Paid ticket retry reuses one registration/order occurrence.
9. Ticket issuance requires the event/registration state appropriate to its ticket policy.
10. Ticket/check-in credential is tenant/event/registration bound and unforgeable at the application boundary.
11. Single-entry check-in cannot be consumed twice under concurrency.
12. Ticket cancellation/refund does not erase historical settlement/attendance evidence.
13. Attendee Contact reuse follows CRM identity/dedupe rules.
14. Registration consent and marketing consent are separate.
15. Public prices/availability/capacity are revalidated at commit.
16. Public status never exceeds canonical payment/order/event truth.
17. Event reminders/sales windows/sessions use K7 temporal semantics.
18. KEY actions use normal capability/authority/governance rules; event tools are not an autonomy bypass.
19. Event analytics/attribution are projections/evidence, not financial truth.
20. Space may be disabled/unpublished without deleting business history.

## Required no-edit characterization

Before any later coding:

- inventory current Site/Storefront/Presence concepts;
- inventory public routes and frontend page ownership;
- inventory current custom-domain/slug support;
- identify product/service/booking modules already projectable into Space;
- inventory quote/invoice/payment/public token flows;
- inspect Contact and form dedupe behavior;
- identify existing promotion/coupon primitives;
- inspect document/QR/barcode generation capabilities;
- identify payment-provider refund/partial-refund semantics;
- inspect plan-limit mechanisms for Space/events/ticket quotas;
- identify SEO/public metadata infrastructure;
- enumerate public analytics/tracking surfaces;
- identify existing event-like calendar/session models before adding new tables.

Return characterization before schema design.

## Migration / cutover strategy

1. define Space as a projection/configuration layer over current published business/storefront surface;
2. preserve existing public URLs through redirects/compatibility;
3. move current storefront/booking/forms into modular Space sections;
4. add Event/registration domain compatibly;
5. add free registration first;
6. add paid ticket commerce using existing order/payment/financial truth;
7. add ticket credential/check-in;
8. add session/speaker/sponsor/waitlist operations;
9. expose KEY automation only after underlying capabilities are load-bearing;
10. withdraw redundant legacy public pages only after parity/proof.

## Acceptance proof families

### Tenant / routing
- wrong slug/domain cannot cross tenant;
- duplicate custom-domain claim rejected;
- unpublished Space inaccessible according to policy.

### Registration
- duplicate submission behavior explicitly defined;
- capacity cannot oversell under concurrency;
- free registration produces no Payment;
- required custom questions validated;
- Contact reused/deduped correctly.

### Ticket commerce
- paid ticket order uses canonical price/currency;
- provider failure retry reuses registration/order;
- successful payment issues eligible ticket once;
- duplicate webhook cannot duplicate tickets;
- refund/cancel preserves lineage.

### Check-in
- valid credential resolves exact event/registration;
- wrong-event credential rejected;
- revoked/refunded ticket behavior follows policy;
- simultaneous scans cannot double-consume single-entry ticket.

### Temporal
- ticket sales start/end enforced;
- event/session timezone correct;
- reminder jobs do not duplicate after reschedule;
- waitlist promotion respects current capacity.

### Public projection
- sold-out state reflects atomic capacity;
- payment pending is not shown as paid;
- cancelled ticket not shown valid;
- event edits obey version/publication rules.

### KEY/autonomy
- KEY can draft event without publishing if policy requires approval;
- price/material term change invalidates stale approval where applicable;
- refund/payout-impacting action uses financial governance.

### Privacy
- marketing consent separate;
- attendee-directory visibility honored;
- deletion/retention follows J19 policy.

## Negative controls

At minimum:

- forged event/ticket ID under another business;
- duplicate payment callback;
- concurrent final ticket inventory claim;
- expired registration window;
- reused check-in credential;
- event unpublished between page load and submit;
- stale price/ticket type;
- wrong currency;
- refunded ticket scan;
- attendee opted out of marketing.

## Rollback floor

Preserve:

- registrations;
- tickets;
- payment/provider receipts;
- refunds;
- check-ins;
- attendee consent decisions;
- event publication revisions;
- CRM/customer history;
- public URL redirect history where needed.

Code rollback must never resurrect refunded tickets, deleted private data or revoked portal/customer access.

## KEY tools to expose later

Candidate capability/action family:

```text
create_event_draft
update_event_draft
publish_event
unpublish_event
create_ticket_type
update_ticket_type
open_registration
close_registration
invite_attendee
register_attendee
cancel_registration
issue_comp_ticket
refund_ticket
promote_waitlist
send_event_message
create_event_session
update_event_agenda
check_in_attendee
generate_attendee_report
generate_event_performance_report
```

Exact tools and risk/control metadata belong in K5 CapabilityContract during implementation planning.

## Non-goals

- building a custom video-conferencing platform;
- replacing external venue/event-production work;
- creating a second CRM;
- creating a second payment ledger;
- creating a separate event marketing engine;
- creating a universal CMS unrelated to business operations.

## Workforce target

This packet is specifically intended to automate/reduce:

- registration administration;
- ticketing administration;
- attendee communications;
- routine event marketing operations;
- CRM data entry;
- check-in administration;
- sponsor/speaker coordination administration;
- event reporting;
- portions of event/project coordination.

## Readiness state

Architecture integration is accepted. Current-main/source/schema characterization remains a future execution-evidence step. No production code change is authorized.
