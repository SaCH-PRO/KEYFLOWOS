# KeyFlow Space — Public Business Platform Capability Blueprint

Checkpoint: `KFS-2026-09-17-01`  
Status: **ACCEPTED PRODUCT CAPABILITY / PRE-IMPLEMENTATION / NO CODE CHANGES**

## 1. Product definition

Every KeyFlow business or organization may own a **KeyFlow Space**: a configurable public digital platform that can function as its website, storefront, booking surface, event hub, registration/ticketing system, payment surface, customer portal entry point and KeyFlow-powered public identity.

The product principle is:

```text
INTERNAL KEYFLOWOS
KEY + Cockpit + Studio
        ↕
Business Graph / canonical domain truth
        ↕
KEYFLOW SPACE
website + storefront + booking + events + registration + ticketing + portal
```

A Space is not a second CRM, commerce engine, booking engine or event ledger. It is the public projection and action surface over the existing domain owners.

## 2. Business-space identity

Conceptually each Space owns:

- stable business/organization identity;
- public slug and shareable URL;
- optional custom domain;
- brand name, logo, colours, imagery and theme;
- public description and contact details;
- published hours/location/service areas;
- public social/contact links;
- SEO/share metadata;
- enabled public modules;
- KeyFlow attribution/powered-by treatment according to product plan.

Examples:

```text
keyflow.app/acme
keyflow.app/acme/events/future-of-finance-2027
events.acme.com
www.acme.com
```

Custom domains are an exposure/routing concern. They do not create separate tenant identity.

## 3. Configurable public modules

A business can enable only the public modules it needs.

### Presence / website
- home page;
- about;
- team;
- services;
- gallery/media;
- testimonials/reviews;
- FAQs;
- contact;
- announcements;
- policies;
- downloadable resources.

### Storefront
- products;
- service packages;
- offers;
- carts;
- checkout;
- payment;
- order status;
- fulfilment projections.

### Booking
- public service catalogue;
- staff/resource availability;
- appointments;
- reschedule/cancel according to policy;
- deposits;
- reminders.

### Events
- event discovery and detail pages;
- registration;
- free and paid tickets;
- sessions/agenda;
- speakers;
- sponsors;
- attendee questions;
- waitlists;
- ticket transfer/reassignment policy;
- check-in;
- post-event follow-up.

### Leads / forms
- contact forms;
- lead forms;
- surveys;
- custom registration questions;
- campaign/source attribution.

### Public commerce documents
- quotes;
- quote acceptance/rejection;
- invoices;
- receipts/payment links;
- selected public documents.

### Portal entry
- client/customer portal grant entry;
- customer-specific project/order/document views where separately authorized.

## 4. Event capability

Events are first-class public commercial/work occurrences.

An Event conceptually binds:

```text
business
title / description / media
event type
timezone
start/end
venue or virtual/hybrid details
capacity
registration window
ticket inventory
agenda/sessions
speakers
sponsors
registration schema
policies
publication state
```

Supported event modes:

- IN_PERSON
- VIRTUAL
- HYBRID

An event may be public, unlisted/share-link, invite-only or gated by business rules.

## 5. Ticket types

Ticket classes may include:

- General Admission
- VIP
- Early Bird
- Student
- Sponsor
- Speaker
- Staff
- Complimentary
- Group/Table
- Virtual Attendance
- custom business-defined types

Each ticket type can define:

- price/currency;
- capacity/inventory;
- sales start/end;
- per-order limits;
- promo/discount eligibility;
- invite/access code;
- approval requirement;
- benefits/entitlements;
- cancellation/refund policy;
- transferability;
- check-in rules.

Free registration is a valid first-class path and must not manufacture fake payment state.

## 6. Registration and attendee profile

A registration is a public intent/commercial occurrence separate from payment settlement.

Typical attendee fields:

- name;
- email;
- phone;
- company/organization;
- job title/position;
- industry;
- country/location;
- dietary/accessibility requirements;
- custom event questions;
- attendee-directory visibility preference;
- event communication permission;
- marketing consent as a separate decision.

Registration does **not** automatically imply broad marketing consent.

Existing Contact identity should be reused/deduped according to J3/J9 rules rather than creating an isolated event contact silo.

## 7. Registration / ticket / payment chain

Paid event:

```text
EventRegistrationIntent
→ attendee/contact resolution
→ ticket inventory claim
→ Order / chargeable obligation
→ payment attempt(s)
→ settlement evidence
→ Ticket issuance
→ confirmation / receipt
→ reminders
→ check-in
→ attendance evidence
→ follow-up / CRM / attribution
```

Free event:

```text
EventRegistrationIntent
→ attendee/contact resolution
→ capacity claim
→ Registration confirmed
→ Ticket/registration credential
→ reminders
→ check-in
```

Payment retry must reuse the same semantic registration/order occurrence rather than creating duplicate registrations or tickets.

## 8. Ticket credential / check-in

Ticket/registration credentials may support:

- opaque ticket token;
- QR code;
- attendee name;
- event/ticket type;
- current validity;
- transfer/reassignment state;
- check-in state.

Check-in is an evidence/state transition, not merely a UI checkbox.

Concurrency must prevent one credential from being admitted twice where single-entry policy applies.

Walk-in registration may create a new registration occurrence under explicit staff/public policy.

## 9. Event sessions / agenda

An event may contain EventSession-like concepts:

- session title;
- start/end;
- room/stage/virtual room;
- speakers;
- capacity;
- attendee eligibility;
- optional session registration;
- attendance evidence.

This should compose with the same temporal/event kernel rather than create a separate scheduling architecture.

## 10. Speakers, sponsors and exhibitors

The public surface may project:

- speakers/presenters;
- sponsors/partners;
- exhibitors/vendors;
- agenda associations;
- public profiles/assets.

Business-side workflows may coordinate invitations, deliverables, sponsorship obligations and invoices using J8/J11/J12 rather than bespoke event-only workflow systems.

## 11. Virtual / hybrid events

KeyFlow Space may expose:

- meeting/live-stream URL or embedded provider session;
- attendee-only gated access;
- session links;
- downloadable resources;
- post-event recordings.

Initial implementation should integrate existing providers rather than build a custom video-conferencing platform.

## 12. KEY-operated event administration

KEY should eventually be able to:

- draft an event from natural-language intent;
- build the registration form;
- propose ticket classes/pricing;
- publish/unpublish according to authority;
- generate launch campaigns;
- schedule social posts;
- send invitations;
- manage attendee communications;
- answer attendee questions;
- send reminders;
- identify incomplete registrations;
- report ticket sales/capacity;
- manage waitlist promotion;
- draft sponsor/speaker outreach;
- surface event operational risks;
- generate check-in lists;
- produce post-event follow-up;
- analyze attendance/revenue/acquisition;
- convert qualified attendees into CRM opportunities where permitted.

KEY autonomy is governed by K2/K3/K5/J15. Creating/refunding financial consequences or changing material event terms may require policy/approval.

## 13. Workforce-replacement target

KeyFlow Space + KEY can absorb or heavily reduce:

- website administrator for routine content;
- event registration administrator;
- ticketing administrator;
- attendee communications coordinator;
- event CRM/data-entry staff;
- check-in desk administration;
- event marketing coordinator;
- sponsor/speaker administration;
- reporting analyst;
- event operations coordinator;
- basic customer-service/reception work.

Human roles remain for venue/physical execution, high-touch relationships, creative direction, specialist content and decisions requiring explicit authority/expertise.

## 14. KeyFlow acquisition loop

A Space may include tasteful KeyFlow attribution such as:

```text
Powered by KeyFlow
Run your business with KeyFlow
```

according to subscription/product policy.

Public interactions can therefore become product acquisition surfaces:

```text
business uses KeyFlow
→ customer interacts with polished Space
→ discovers KeyFlow
→ creates their own business/organization Space
```

This branding must never interfere with the business's own primary brand or customer trust.

## 15. Architecture ownership

Primary journey: **J21 Public Customer Experience**.

Cross-journey owners:

- J3 — attendee/contact/customer lifecycle;
- J4 — service booking/deposit semantics where event packages use booking;
- J7 — payment/refund/financial truth;
- J8 — event operational work/deliverables;
- J9 — marketing/lead generation/attribution;
- J10 — ticket/order commerce and fulfilment;
- J11 — sponsor/vendor/contract obligations;
- J12 — tickets/receipts/certificates/evidence documents;
- J14 — payment/provider/webhook ingress;
- J18 — retry/recovery;
- J20 — entitlement/plan limits for event features;
- J23 — sale windows, reminders, sessions and long-running event workflows;
- J25/J15/J2 — authority/governance for staff/KEY actions.

Primary kernels:

- K1 tenant/public identity;
- K5 capability fabric;
- K6 state transition;
- K7 temporal/event workflow;
- K8 evidence/outcome;
- K9 external reality;
- K10 financial truth;
- K11 recovery;
- K12 engineering control plane.

No new kernel or canonical journey is required.

## 16. Public-state laws

1. Space slug/domain resolves one trusted business context.
2. Published page state is a projection, not authorization to mutate arbitrary business state.
3. Public registration/checkout derives tenant/event/ticket identity from trusted published resources.
4. Event publication, registration, ticket sale, payment, ticket issuance and check-in are distinct states.
5. Capacity and ticket inventory require atomic ownership at commitment.
6. Registration does not equal payment settlement.
7. Payment settlement does not automatically imply attendance.
8. Ticket issuance does not imply check-in.
9. Check-in does not imply marketing consent.
10. Public page prices/availability are revalidated at commit.
11. Retry preserves semantic registration/order identity.
12. Refund/cancellation preserves historical ticket/payment lineage.
13. Free registration never creates fake financial settlement.
14. Public/attendee profile data follows privacy and retention policy.
15. Customer-facing state cannot outrun canonical commerce/financial truth.

## 17. Product phases

### Space Foundation
- slug/share URL;
- branding/theme;
- modular public page;
- storefront/booking/forms/quote/payment/portal integration.

### Events & Registration
- event pages;
- registration schema;
- free registration;
- capacity;
- attendee CRM linkage;
- confirmations/reminders.

### Ticket Commerce
- paid ticket types;
- promo/access codes;
- inventory;
- order/payment;
- ticket issuance;
- refunds.

### Event Operations
- QR/check-in;
- sessions/agenda;
- speakers/sponsors;
- waitlist;
- attendee messaging;
- staff operational views.

### Intelligence & Automation
- KEY event setup/operator;
- campaign automation;
- forecasting;
- attendee segmentation;
- acquisition/revenue/attendance analytics;
- proactive exception management.

These are product sequencing layers, not separate architectures.
