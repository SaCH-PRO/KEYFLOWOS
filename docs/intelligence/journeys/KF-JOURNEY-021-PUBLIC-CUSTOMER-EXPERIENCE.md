# KF-JOURNEY-021 — Public Customer Experience

Checkpoint: `J21-CONV-2026-09-17-01`  
Status: **PROVISIONALLY TARGET-ALIGNED — NAMED PUBLIC-BOUNDARY CORE ONLY**  
Implementation forensic baseline: `main@8f173bfe79f1418159cf4099ea18b0d60d203ec2`.

Primary kernels: K1, K6, K8, K9, K11. Secondary: K3, K5, K7, K10, K12.  
Primary adjacent journeys: J3, J4, J7, J8, J9, J10, J13, J14, J18, J20, J22.

Production implementation remains READ-ONLY / UNAUTHORIZED. No runtime/provider/browser/customer test was executed by this tranche.

## A. Definition

J21 asks whether a customer-facing action shown outside the authenticated operator app is bound to the correct business, offer, state, commercial occurrence and outcome.

It covers the named public surface:

- published presence / storefront;
- public catalog and checkout;
- public service booking;
- public lead-form submission;
- public quote viewing/acceptance/rejection;
- public invoice/payment-link flows;
- client-portal grants/tokens;
- public recovery/retry behavior.

Core distinction:

```text
PUBLICLY REACHABLE
!= UNTRUSTED BY DEFINITION
!= AUTHENTICATED HUMAN PRINCIPAL
!= BUSINESS AUTHORITY
```

A public surface may legitimately use a storefront slug, opaque quote/payment token or portal bearer grant, but that grant must bind exact purpose, tenant and subject.

## B. Public context classes

J21 adopts three public context classes.

### 1. Published discovery context

Examples: presence/storefront/catalog.

```text
public slug
→ published business projection
→ read-only offer/discovery context
```

Positive seam: storefront checkout resolves the storefront by slug and derives the business from that resolved object rather than accepting a checkout `businessId` from the browser.

### 2. Anonymous public intent

Examples: lead form, booking, checkout.

```text
public resource / offer
+ customer-supplied contact/intention
→ PublicIntentOccurrence
→ domain validation / current availability / price
→ domain mutation
```

The customer is not automatically a Membership principal. The action is authorized by the business's published public policy and exact resource contract.

### 3. Bearer-grant decision context

Examples: quote token, payment link, portal token.

```text
opaque grant
→ exact subject/purpose
→ enabled + unexpired + current-state validation
→ bounded read/decision
```

Bearer possession must not silently become broader identity/authority.

## C. Storefront / checkout

Current positive seams:

- public storefront resolved by slug;
- checkout derives `businessId` from the resolved storefront;
- cart products are revalidated against the business and active/not-deleted state;
- order totals are server recomputed;
- paid checkout completion has a strong transaction that can compose Invoice + Payment + inventory + attribution + order-state consequences;
- public payment return restoration checks current order state rather than blindly trusting a redirect.

Current recovery pressure:

```text
public checkout
→ create MarketplaceOrder
→ create provider payment

provider/payment creation fails
→ order already exists
→ UI "retry payment"
→ resubmits same checkout payload
→ creates another MarketplaceOrder
```

The UI preserves completed booking references, so it avoids recreating service bookings on this retry, but product-order identity is not preserved. This is a J21 manifestation of J10 CommerceEffectIdentity + J18 retry law; no new F/C ID is allocated.

Target:

```text
checkout intent occurrence
→ one commercial order occurrence
→ payment attempt(s) against same order
```

not “retry payment by creating a fresh commercial order.”

## D. Public booking

Current positive seams:

- service is looked up under the requested business;
- shared `assertSlotFree()` is used by availability and all three booking writers;
- lead time/business hours/staff schedule are checked;
- current source test explicitly protects the shared availability/write rule;
- public booking enforces plan limit;
- generated contact is business-scoped;
- invoice/deposit descendants remain J4/K10-owned.

Remaining concurrency boundary:

```text
request A: assertSlotFree → no row
request B: assertSlotFree → no row
request A: booking.create
request B: booking.create
```

The source test itself states the genuine simultaneous-request race is still open and requires a database constraint/data migration decision.

This is F233/C183.

J4's deposit/final receivable and cancellation/no-show financial laws remain unchanged.

## E. Lead forms

Public submission:

- rate limited + honeypot;
- resolves active LeadForm by `formId`;
- derives business from the form;
- validates configured required fields;
- contact creation/dedupe + LeadFormSubmission happen in one transaction;
- event emitted after commit.

No request occurrence/idempotency identity is supplied, so browser/network retry can create another submission. That source pressure was already captured in J9's publication/recognition work; J21 reuses J9/K7/K8 rather than allocating a duplicate root.

## F. Quote public decision

Positive seam:

- public decision uses an opaque `viewToken`;
- quote must exist and not be deleted;
- it must be `SENT`;
- already ACCEPTED/REJECTED is rejected;
- converted quote is rejected;
- expiry is checked;
- decision updates the quote under its existing business/contact identity.

The token holder is a bounded bearer decision principal, not an authenticated Membership.

J21 target:

```text
QuoteDecisionGrant
= token
+ quote revision / exact commercial subject
+ decision purpose
+ validity
+ one terminal response
```

Current source does not justify inventing a second auth system for this surface.

## G. Public invoice and payment

Public invoice/payment-link UI consumes tokenized invoice state and redirects payment through a token-aware flow.

Financial truth remains J7/KF-REC-052:

```text
invoice public status
!= provider settlement
!= Payment consequence
!= ledger completion
```

A public offline payment intent is correctly stored as a PENDING Payment and does not itself create a financial posting. That is a positive truth-layer seam.

## H. Client portal

PortalAccess stores:

```text
businessId
contactId
token
expiresAt
enabled
settings
```

The schema has a Business relation but no Contact relation tying `contactId` to that business.

`PortalService.createAccess(businessId, contactId)` searches existing access by the pair and then creates/rotates a token. The inspected path does not first prove that the Contact exists in that business.

Thus an authenticated member of business A can supply a contact id belonging to business B and mint a PortalAccess row containing:

```text
businessId = A
contactId = B.contact
```

The token validation endpoint then returns those two values as one public context.

This is F232/C182.

Separately, the operator UI generates `/portal/{token}`. The fixed-baseline web tree did not contain a mounted `apps/web/src/app/portal/[token]` route. J8 already documented that exact bounded observation and correctly refused to claim exhaustive portal breakage. J21 retains it as reachability debt, not a new finding.

Portal visibility/access remains distinct from delivery acceptance under J8.

## I. Public customer boundary contract

Selected target:

```text
PublishedPublicResource
→ TrustedPublicContext
→ PublicIntentOccurrence / BearerDecisionGrant
→ current domain validation
→ exact StateTransition / Capability
→ semantic EffectIdentity
→ OutcomeEvidence
→ customer-facing truthful projection
→ recovery/reconciliation
```

No universal public-session table is required.

## J. Canonical invariants

1. A public route must state what authenticates/authorizes it: published public policy, provider signature, opaque purpose grant, or other explicit mechanism.
2. Tenant context is derived from trusted resource/grant binding, not an arbitrary body/path tenant claim where a stronger binding exists.
3. A public grant binds one business and one eligible subject.
4. Bearer token possession is not Membership identity.
5. Public offer display is not a frozen commercial promise unless the domain contract says so.
6. Price/availability are revalidated at commit.
7. Availability read and reservation/write must converge under concurrent requests.
8. One checkout intent creates one semantic commercial occurrence; payment retries do not manufacture new orders.
9. Public lead/form retries require occurrence semantics where duplicate submissions matter.
10. Quote response applies only to the exact sent, live quote subject.
11. Payment intent is not payment settlement.
12. Customer-facing statuses must project canonical domain/financial truth.
13. Portal access is not project/deliverable acceptance.
14. Public context cannot bridge two tenant identities.
15. Rate limit/honeypot is abuse protection, not tenant/authority proof.
16. Recovery preserves the original public intent/effect identity where retry is semantically the same action.
17. Public analytics/attribution never becomes authority or financial truth.
18. Public experience may compose several domain occurrences, but partial completion remains explicit rather than pretending the entire journey failed or succeeded atomically.

## K. New canonical allocations

- F232 / C182 — PortalAccess grant does not prove `contactId` belongs to `businessId`.
- F233 / C183 — public booking slot ownership uses read-before-create and has no database-level concurrent exclusion/claim.

Recommendation: **KF-REC-059 — Public Customer Boundary & Journey Receipt Contract**.

## L. Reused owners

- storefront/order/fulfilment occurrence/retry -> KF-REC-054 + KF-REC-048;
- booking commercial consequences -> KF-REC-053 + KF-REC-052;
- lead-form occurrence/recognition -> J9/K7/K8;
- external/public ingress -> J14/K9;
- financial payment truth -> J7/K10;
- delivery acceptance -> J8/J11/J12;
- plan/entitlement gate -> J20/KF-REC-058.

## M. Proof obligations

Designed J21 cases, not executed:

- J21-P01 slug-derived checkout cannot bind a different business.
- J21-P02 cart product from another business is rejected.
- J21-P03 two simultaneous same-slot bookings yield one accepted booking.
- J21-P04 availability projection and commit validator use one rule.
- J21-P05 failed payment retry reuses the same StoreOrder occurrence.
- J21-P06 provider return cannot manufacture PAID without provider/local truth.
- J21-P07 duplicate lead-form delivery has declared occurrence behavior.
- J21-P08 quote token cannot act before SENT.
- J21-P09 expired/decided quote token cannot mutate again.
- J21-P10 payment intent remains non-settled/non-posted.
- J21-P11 PortalAccess creation rejects cross-business contact.
- J21-P12 revoked/expired portal token fails.
- J21-P13 portal bearer grant cannot imply delivery acceptance.
- J21-P14 public projection never shows stronger financial state than canonical source.
- J21-P15 partial composite checkout exposes already-created bookings/order rather than replaying them blindly.
- J21-P16 public recovery preserves semantic occurrence identity.

Bindings: 0. Runtime status: NOT_EXECUTED.

## N. Disposition

```text
J21 = PROVISIONALLY_TARGET_ALIGNED_NAMED_PUBLIC_BOUNDARY_CORE_ONLY
```

This closes the named public-customer architecture sufficiently to activate J22. Reopen on runtime evidence, untraced public routes, or J22 cross-channel counterexamples.
