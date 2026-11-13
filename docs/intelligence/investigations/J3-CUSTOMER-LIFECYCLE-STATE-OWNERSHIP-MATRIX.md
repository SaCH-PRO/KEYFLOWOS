# J3 — Customer Lifecycle State Ownership Matrix

Status: ACTIVE TARGET-SYNTHESIS EVIDENCE
Last updated: 2026-09-06
Implementation baseline: `main@4e9f60c65bdb78fbdadcb08731c5dab95b3645c7`
Production implementation: READ-ONLY / NOT AUTHORIZED

Purpose: separate the multiple Contact / CRM / pipeline fields that currently look like variants of “customer stage” and determine which are genuinely orthogonal dimensions versus competing sources of truth.

## 1. Current dimensions

| Dimension | Persistence / owner today | Observed vocabulary / behavior | Current semantic verdict |
|---|---|---|---|
| `Contact.status` | Prisma `String @default("LEAD")`; CRM create/update surface plus direct integration writers | CRM contract: `LEAD/PROSPECT/CLIENT/LOST`; Shopify: `CUSTOMER`; People Flow reads `CUSTOMER/DORMANT/AT_RISK`; KeyCortex reads `lead/customer` | **CONFLICTED** — intended lifecycle classification but no load-bearing algebra |
| `Contact.lifecycleStage` | nullable free-form String; CRM create/update/import/connectors | arbitrary strings; demo seed uses `lead`; selected by CRM AI, account views, reporting and sales-team views | **ANNOTATION / IMPORT DIMENSION** until target proves a governed stage model |
| `Contact.pipelineStage` | nullable free-form String; CRM create/update | KeyCortex groups it for lead pipeline; no observed automatic Deal→Contact stage convergence | **CONTACT-LEVEL PROJECTION/ANNOTATION**, not Deal state |
| `Contact.relationshipHealth` | separate nullable String; CRM relationship-health service computes/persists health | HOT/WARM/COLD/AT_RISK/DORMANT-style relationship condition | **ORTHOGONAL RELATIONSHIP CONDITION**; should not be folded into lifecycle |
| `Deal.status` | Deal domain | OPEN/WON/LOST | **OPPORTUNITY-SPECIFIC COMMERCIAL STATE**; one contact may have multiple deals |
| `Deal.stage` / `DealStage` | Deal domain | configurable pipeline stages | **OPPORTUNITY PIPELINE STATE**, not Contact lifecycle |
| `Contact.tags` | String[]; many writers/integrations | descriptive tags such as `customer`, `paid`, `store-order` | **DESCRIPTIVE / SEGMENTATION LABELS**, not authority for lifecycle transition |
| commercial evidence | Quote/Invoice/Payment/Booking/Order/Deal histories | quote accepted, invoice paid, booking completed, order paid, deal won, etc. | **EVIDENCE**, not itself one scalar lifecycle field |

## 2. Current contradictions

### 2.1 Database openness vs API canonicality

```text
CRM DTO / constants
→ LEAD | PROSPECT | CLIENT | LOST

Prisma Contact.status
→ arbitrary String
```

Direct writers can bypass the API algebra.

### 2.2 Shopify external adapter writes another lifecycle dialect

```text
Shopify orders_count > 0
→ Contact.status = CUSTOMER
```

`syncCustomers()` applies this to both new and existing Contacts, so it can overwrite a canonical CRM status.

### 2.3 People Flow collapses relationship health into lifecycle

People Flow interprets `Contact.status` using `CUSTOMER`, `DORMANT`, and `AT_RISK`, while CRM separately stores `relationshipHealth` and computes `DORMANT/AT_RISK` there.

### 2.4 KeyCortex has a fourth vocabulary

Connector/context types use lower-case semantics such as:

```text
lead | prospect | customer | churned | partner
```

and integration tests seed lowercase `status='lead'`.

This is not merely casing drift; `customer/churned/partner` do not map one-to-one onto CRM's four values.

## 3. What should remain separate in target architecture

### CustomerLifecycleState

Question answered:
> What is this party's broad commercial relationship with this business?

Candidate target semantics must be derived from product meaning, not copied from observed words. Do not prematurely freeze an enum in this investigation.

Needed properties:
- one owner;
- versioned algebra;
- explicit transition/evidence policy;
- historical transition evidence;
- external-adapter mappings;
- correction/reversal handling;
- projection eligibility.

### RelationshipHealthState

Question answered:
> How healthy/active is the relationship right now?

May move independently of lifecycle. A client can be healthy, cold, at risk or dormant without ceasing to be a client.

### DealState / DealStage

Question answered:
> Where is this particular commercial opportunity?

One Contact may have zero, one or many simultaneous Deals. Deal WON must therefore be evidence for lifecycle policy, not the lifecycle state itself.

### CommercialEvidence

Question answered:
> What objectively happened?

Examples:
- Deal WON;
- Quote ACCEPTED;
- Booking COMPLETED;
- Invoice PAID under canonical financial semantics;
- Order paid/fulfilled;
- refund/correction/churn/relationship termination evidence.

Evidence feeds lifecycle evaluation but does not bypass its policy.

### Tags / segments / annotations

Question answered:
> How do we want to label/filter this party for a specific product purpose?

Tags and free-form stages should not grant canonical lifecycle meaning unless explicitly mapped.

## 4. Target convergence shape

```text
external/domain commercial evidence
→ canonical typed evidence adapters
→ lifecycle transition policy
→ CustomerLifecycleState + transition provenance

relationship activity/payment/engagement evidence
→ RelationshipHealthState

Deal-specific events
→ DealState / DealStage

all three + tags/segments
→ consumer-specific CRM / People / AI projections
```

## 5. Critical non-equivalences

```text
CLIENT != CUSTOMER string alias until mapped
CLIENT != healthy
CLIENT != active deal
CLIENT != paid invoice by definition
CLIENT != customer tag
DORMANT relationship != former customer
LOST contact != lost Deal
Deal WON != Contact lifecycle transition unless policy says so
```

## 6. Migration pressure

A future transformation must inventory existing persisted `Contact.status` values before constraining the schema.

Migration cannot safely do a blind string rename because observed words may encode different dimensions:

```text
CUSTOMER → likely lifecycle alias
DORMANT / AT_RISK → likely relationshipHealth leakage
lead/customer lowercase → adapter/projection dialect
partner/churned → may require distinct target semantics, not aliases
```

Required migration shape:

```text
inventory existing values
→ classify semantic origin
→ map lifecycle aliases
→ move leaked health semantics to relationshipHealth where justified
→ preserve transition/evidence history
→ update direct integration adapters
→ update consumers
→ only then enforce schema algebra
```

## 7. Current canonical links

- F197/C147 — strong commercial evidence does not converge Contact to canonical customer lifecycle.
- F203/C153 — KeyCortex queries non-canonical `lead/customer` status values.
- F205/C155 — persisted Contact.status admits incompatible lifecycle/health dialects.
- F198/C148 — customer value needs separate commercial/financial semantics.
- KF-REC-049 — Business Knowledge consumers need provenance/eligibility.
- KF-REC-052 — financial evidence consumed by lifecycle/value projections must retain financial truth semantics.

## 8. Exact next pressure

1. inventory automatic `Contact.status` writers beyond Shopify and post-booking template;
2. trace Deal WON/LOST timestamps/events against any lifecycle projection;
3. trace refund/credit/relationship-ending evidence to determine whether lifecycle can regress or branch;
4. inspect UI terminology for Lead/Prospect/Client vs customer segments;
5. current standards/frontier pressure-test only after J3/J4 local commercial obligation semantics converge.

No production implementation is authorized by this investigation.
