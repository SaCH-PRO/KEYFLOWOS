# J21 Public Customer Experience — Microtrace 001

Checkpoint: `J21-M001-2026-09-17-01`  
Baseline: `main@8f173bfe79f1418159cf4099ea18b0d60d203ec2`  
Result: **NAMED PUBLIC SURFACE TRACED AND BOUNDED CONVERGENCE COMPLETED**.

## Source scope

Named implementation families inspected:

- SiteController / StoreOrderService;
- public storefront web flow;
- BookingsController / BookingsService / booking overlap source test;
- LeadFormsController / LeadFormsService;
- CommerceController / CommerceService public quote/payment-link methods;
- public quote/invoice pages;
- PortalController / PortalService / web portal admin client;
- PortalAccess schema;
- public-surface source gate.

No runtime/browser/provider test was executed.

## Positive seams

- storefront slug resolves business server-side before checkout;
- cart products revalidated under business;
- server recomputes totals;
- paid StoreOrder completion has a strong multi-consequence transaction;
- availability and booking writers share one overlap rule;
- lead-form contact+submission is transactional;
- quote token requires SENT, live/unexpired state;
- public offline payment intent remains PENDING;
- portal token is random, expiring, revocable;
- public-surface test keeps the unauthenticated handler inventory shrink-only.

## New roots

### Portal tenant/subject binding

PortalAccess has independent businessId/contactId scalars and no Contact relation. Creation does not prove same-business contact before token minting. Allocate F232/C182.

### Booking atomic slot ownership

The shared read check fixes sequential overlap semantics but remains a TOCTOU boundary. The source test explicitly calls out simultaneous requests and a future database-constraint/data-migration requirement. Allocate F233/C183.

## Reused roots

- Storefront retry creating a fresh order: reuse J10 CommerceEffectIdentity + J18 retry semantics.
- Lead form no request occurrence ID: reuse J9 public occurrence/recognition contract.
- Booking deposit/final invoice semantics: reuse J4/KF-REC-053/KF-REC-052.
- Public payment truth: reuse J7.
- Portal acceptance semantics: reuse J8.
- Public ingress authenticity/tenant binding: reuse J14/K9.

## Convergence

Selected KF-REC-059. No universal public runtime, customer login system or public super-state is introduced.
