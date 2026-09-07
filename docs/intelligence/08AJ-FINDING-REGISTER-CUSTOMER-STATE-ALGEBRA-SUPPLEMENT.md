# KeyFlowOS Finding Register — Customer State Algebra Supplement

Status: CANONICAL SUPPLEMENT
Last updated: 2026-09-06
Scope: J3 Lead → Customer → Cash
Implementation baseline: `main@4e9f60c65bdb78fbdadcb08731c5dab95b3645c7`
Production implementation: READ-ONLY / NOT AUTHORIZED

## F205 — Persisted Contact status admits incompatible lifecycle and relationship-health dialects across live modules

Classification: CURRENT IMPLEMENTATION DEFECT / CUSTOMER STATE ALGEBRA
Primary journey: J3
Primary kernels: K6 State Transition, K4 Business Knowledge, K8 Evidence & Outcome
Related but distinct: F197 customer lifecycle convergence; F203 KeyCortex non-canonical read predicates

### Canonical-facing CRM contract

Server/web CRM constants and DTOs present this Contact status algebra:

```text
LEAD | PROSPECT | CLIENT | LOST
```

`CrmService.createContact()` defaults `status` to `LEAD`.

However the Prisma model is not an enum:

```text
Contact.status String @default("LEAD")
```

so database persistence does not enforce that algebra.

### Live writer contradiction — Shopify

`ShopifyService.syncOrders()` directly creates a Contact with:

```text
status = 'CUSTOMER'
```

for a Shopify customer attached to an imported order.

`ShopifyService.syncCustomers()` also creates **and updates existing Contacts** with:

```text
status = customer.orders_count > 0 ? 'CUSTOMER' : 'LEAD'
```

This bypasses the CRM DTO validation and can overwrite an existing canonical `CLIENT`, `PROSPECT`, or `LOST` state with another dialect.

No inspected normalization path converts `CUSTOMER → CLIENT` after Shopify persistence.

### Live consumer contradiction — People Flow

`PeopleFlow/RelationshipHealthService` mixes several vocabularies when reading `Contact.status`:

```text
LEAD
PROSPECT
CUSTOMER
DORMANT
AT_RISK
```

Examples:

- `contact.status === 'CUSTOMER'` drives “No bookings in 90 days” and “High-Value Customers” logic;
- `contact.status === 'DORMANT'` and `contact.status !== 'DORMANT'` influence segment membership;
- human-facing criteria text describes `AT_RISK` as though it may be a status.

Yet the CRM relationship-health subsystem separately stores and queries:

```text
Contact.relationshipHealth = AT_RISK | DORMANT | ...
```

So People Flow partially collapses a relationship-health dimension into the lifecycle status field while CRM keeps them separate.

### Why F205 is distinct

F197:
```text
strong commercial customer evidence
!= automatically converged Contact.status = CLIENT
```

F203:
```text
KeyCortex reads lowercase/non-canonical lead/customer predicates
```

F205:
```text
live production writers + consumers disagree on what values Contact.status itself may contain
```

F205 therefore survives even if automatic customer promotion (F197) and KeyCortex queries (F203) are independently repaired.

### Architectural consequence

There is no load-bearing single customer-state algebra today. A Contact can be semantically interpreted differently depending on whether the reader assumes:

```text
CRM lifecycle: LEAD | PROSPECT | CLIENT | LOST
commerce/import lifecycle: LEAD | CUSTOMER
relationship-health state: ... | DORMANT | AT_RISK
KeyCortex connector vocabulary: lead | prospect | customer | churned | partner
```

This contaminates segmentation, AI context, relationship health, customer counts, lifecycle automation and any learning built from those projections.

### Target pressure

KeyFlow should preserve orthogonal dimensions rather than create a larger catch-all enum:

```text
CustomerLifecycleState
  = acquisition/commercial relationship stage

RelationshipHealthState
  = current relationship condition

Deal/PipelineState
  = opportunity-specific sales progression

CustomerTags / Segment
  = descriptive or analytical labels
```

Each dimension needs:

- one owner;
- one canonical algebra/version;
- explicit external-provider adapters;
- typed transition rules;
- event/evidence provenance;
- migration aliases for historical values;
- consumer-specific projection mapping where needed.

Do **not** solve F205 by simply adding every observed word to one Contact.status enum.

No production implementation is authorized by this supplement.
