# J10 Commerce / Fulfilment — Standards & Frontier Pressure Test

Status: CANONICAL ANALYTICAL PRESSURE TEST
Last updated: 2026-09-07
Implementation evidence: `main@4e9f60c65bdb78fbdadcb08731c5dab95b3645c7`
Production implementation: READ-ONLY / NOT AUTHORIZED

## 1. Question

Does the J10 evidence cluster F206–F214 / C156–C164 justify a distinct target contract, or can every defect be completely owned by existing recommendations?

Candidate target:

```text
Commerce & Fulfilment Contract
```

The test is deliberately anti-expansionary: a new recommendation is justified only if a stable set of commerce-domain invariants remains after delegating financial truth, commercial relationship/obligation truth, ingress occurrence handling and recovery to their mature owners.

---

## 2. Existing recommendation boundary test

### KF-REC-035–037 — ingress/external occurrence family

Useful for:
- external occurrence identity;
- ingress lifecycle/reconciliation;
- adapter boundaries and replay-safe intake.

Insufficient to own:
- canonical Product/Contact provider-entity identity after ingress;
- structural operational materialization of external orders;
- inventory allocation semantics;
- required fulfilment route/effect sets;
- shipment/fulfilment aggregate outcome.

Conclusion: **compose, do not stretch**.

### KF-REC-048 — certainty-aware Recovery Contract

Useful for:
- ambiguous effects;
- retry/reconciliation;
- missing consequences;
- safe resume and operator escalation.

Insufficient to define:
- what the commerce domain's required route/effect set actually is;
- which inventory transitions are legitimate;
- which provider entity identifies a Product/Contact/order line;
- what makes fulfilment complete.

Conclusion: recovery consumes J10 semantic identities and required-effect definitions; it does not own them.

### KF-REC-052 — Financial Truth & Valuation Contract

Useful for:
- Invoice/Payment/ledger truth;
- refunds/credits/reversals;
- valuation and financial completeness.

Insufficient to own:
- operational order status;
- warehouse/inventory allocation;
- fulfilment routing;
- provider catalog/order materialization.

Conclusion: J10 must never redefine money/accounting truth; it supplies commercial/operational consequences to KF-REC-052.

### KF-REC-053 — Commercial Relationship & Obligation Contract

Useful for:
- customer lifecycle;
- commercial obligation lineage;
- commercial value stages;
- expected commercial descendants;
- event/action contract composition.

Insufficient to own:
- inventory state algebra;
- fulfilment strategy selection/effects;
- required route-set completeness;
- external Product/order-item operational representation.

Conclusion: J10 specializes the operational fulfilment of commercial obligations without replacing their commercial lineage.

---

## 3. Evidence cluster after delegation

After removing mature-owner concerns, these J10-native invariants remain:

```text
F207/C157  order operational state must remain orthogonal to payment evidence
F208/C158  one order-item quantity needs one inventory allocation/effect lineage
F209/C159  aggregate fulfilment outcome must derive from required child outcomes
F210/C160  provider commerce entity identity must survive mutable SKU
F211/C161  required fulfilment set cannot be inferred from any-child existence
F212/C162  provider customer entity identity must be consistent across commerce entrypoints
F213/C163  operational external order requires structural order-item materialization
F214/C164  strategy-specific business effects require semantic identity independent of route-row existence
```

F206/C156 remains shared pressure with KF-REC-053/052: J10 must provide stable order/effect identity so downstream invoice generation converges on one commercial descendant.

This residual cluster is coherent and independently load-bearing.

---

## 4. External-reality / standards pressure

Current provider semantics corroborate the separation without prescribing KeyFlow's implementation:

1. Provider resource identity is stable independently of merchant-editable attributes such as SKU.
2. Orders expose purchased line items structurally.
3. Fulfilment work is derived from purchased line-item obligations rather than opaque order metadata alone.
4. Inventory systems distinguish concepts such as on-hand, available, committed and reserved rather than repeatedly applying one sold quantity through unrelated decrements.

Target conclusion:

```text
provider payload vocabulary
!= KeyFlow canonical operational semantics
```

KeyFlow requires provider-independent adapters and internal semantic identities.

---

## 5. Candidate target primitives

Names are semantic working vocabulary, not approved tables/services.

### OrderOperationalState

Owns commerce/fulfilment progression only.

```text
OrderOperationalState != PaymentState != FinancialTruth
```

### ExternalEntityIdentity

```text
(businessId, provider, entityType, externalId)
→ one canonical internal entity identity
```

Mutable SKU/email/title/name are attributes, not provider identity.

### OperationalOrderMaterialization

Explicit contract for whether an imported order is:

```text
OPERATIONAL
→ required internal OrderItem/effect-bearing structure materialized

SUMMARY_OR_EVIDENCE_ONLY
→ technically excluded from native effectful fulfilment/inventory flows
```

### InventoryAllocationLineage

One semantic lineage for an order-item quantity through allocation lifecycle:

```text
AVAILABLE → RESERVED/COMMITTED → CONSUMED
                         ↘ RELEASED / RESTORED / RETURNED
```

Exact final algebra remains product-policy dependent.

### RequiredFulfilmentSet

Explicit required obligations per order item/split/revision.

```text
required effects
vs observed effects
→ aggregate fulfilment outcome
```

### StrategyEffectIdentity

Stable semantic identity spanning route and auxiliary descendants such as PurchaseOrder/PreOrder.

```text
business + order + item/split + strategy + relevant revision
```

---

## 6. Causal pressure graph

```text
one commerce occurrence
  ↓
canonical order + provider identity
  ↓
structural order-item obligations
  ├─ payment evidence → KF-REC-052
  ├─ commercial lineage → KF-REC-053
  └─ operational fulfilment requirements
       ↓
  inventory allocation lineage
       +
  required fulfilment set
       ↓
  strategy effects / routes
       ↓
  per-effect outcomes
       ↓
  aggregate fulfilment outcome
       ↓
  recovery projection → KF-REC-048
  attention projection → KF-REC-051
```

If any upstream identity or structural materialization is missing, later recovery cannot reliably infer which business effect should exist.

---

## 7. Non-goals pressure

The target must NOT become:

- a universal Order replacement model;
- a universal warehouse-management engine;
- a new payment/accounting system;
- a universal provider synchronization runtime;
- a replacement for commercial obligation lineage;
- a replacement for recovery orchestration;
- a mandate that all strategies use one physical database transaction.

The contract is semantic: existing modules may retain their domain models if they converge on the same identities, state dimensions and effect laws.

---

## 8. Required cross-contract composition

```text
Commerce occurrence / order
→ KF-REC-054 operational identity + materialization + fulfilment semantics

commercial obligation / invoice lineage
→ KF-REC-053

money / accounting / refund / valuation
→ KF-REC-052

ambiguous/missing effect recovery
→ KF-REC-048

operator prioritization
→ KF-REC-051

external occurrence ingress lifecycle
→ KF-REC-035–037
```

No contract may infer another dimension from a convenience status string.

---

## 9. Proof threshold for independent recommendation

A distinct target is justified if all are true:

- [x] multiple verified findings share one domain-owned semantic root;
- [x] the root remains after mature recommendation delegation;
- [x] the target can be stated without a new universal runtime;
- [x] it improves native and external commerce paths with one coherent law set;
- [x] it defines semantic identities that recovery/financial/commercial contracts need but should not own;
- [x] the target can be tested through exact-once/completeness/reconciliation properties;
- [x] anti-duplication search found no existing recommendation with equivalent scope.

Result: **PASS — allocate a distinct narrow Commerce & Fulfilment Contract.**

---

## 10. Recommendation decision

Allocate:

```text
KF-REC-054 — Establish a Commerce & Fulfilment Contract
```

Primary evidence:

```text
F206–F214 / C156–C164
```

Primary domain-owned pressure:

```text
OrderOperationalState
ExternalEntityIdentity for commerce resources
OperationalOrderMaterialization
InventoryAllocationLineage
RequiredFulfilmentSet
StrategyEffectIdentity
AggregateFulfilmentOutcome
```

Delegated dimensions remain delegated to KF-REC-035–037/048/051/052/053.

No production implementation is authorized by this pressure test.
