# KeyFlowOS Finding Register — Shopify Order Structural Completeness Supplement

Status: CANONICAL CONTINUATION — J10 COMMERCE / FULFILMENT
Implementation evidence: `main@4e9f60c65bdb78fbdadcb08731c5dab95b3645c7`
Production implementation: READ-ONLY / NOT AUTHORIZED

---

## F213 — Shopify order sync imports line items only as opaque metadata, so the resulting MarketplaceOrder lacks the structural item descendants required by native commerce and fulfilment logic

**Status:** VERIFIED REACHABLE EXTERNAL-ORDER REPRESENTATION FINDING

`ShopifyService.syncOrders()` creates or updates `MarketplaceOrder` rows with order-level fields such as:

```text
orderNumber
total
currency
paymentStatus
metadata.shopifyOrderId
metadata.lineItems = order.line_items
metadata.financialStatus
metadata.fulfillmentStatus
```

It does **not** create/update the relational `MarketplaceOrder.items` descendants used by native KeyFlow commerce.

Repository search finds no runtime consumer that later materializes `metadata.lineItems`; `shopify.orders_synced` is published with zero registered listeners in the system map/event registry.

Native J10 logic, however, operates on structural order items. Examples include:

```text
FulfillmentRoutingService.routeOrder()
  → loops order.items
  → selects listing/product/strategy per item
  → creates FulfillmentRoute / PurchaseOrder / PreOrder descendants

MarketplaceService paid/COGS paths
  → derive productId + quantity from order.items

inventory / shipment / fulfilment UI and transitions
  → expect native item relations
```

Thus an imported Shopify order can be represented as a MarketplaceOrder aggregate while its product/quantity obligations exist only inside provider-shaped JSON metadata.

### Distinct root

This is not F210 Product identity or F212 Contact identity. It is an **external aggregate materialization completeness** defect:

```text
external order exists in native aggregate namespace
but
required structural descendants for native order semantics are absent
```

It also differs from merely preserving raw provider evidence. Keeping raw Shopify payload/line items as evidence is useful; the defect is treating the same aggregate as operationally equivalent to native MarketplaceOrder while its item obligations are not structurally materialized or explicitly marked as a summary-only projection.

### Target law

For each imported external order, architecture must choose explicitly:

```text
A. OPERATIONAL IMPORT
   external order + line items
   → provider identity mapping
   → canonical/internal OrderItem descendants
   → product mapping/unresolved-item state
   → fulfilment/inventory/COGS eligibility

OR

B. SUMMARY / EVIDENCE PROJECTION
   provider order remains clearly non-operational
   → cannot silently enter native fulfilment/inventory state machines
```

Opaque metadata alone must not make an aggregate operationally equivalent to a fully materialized native order.

### Proof pressure

1. an operational Shopify order exposes one structural internal item obligation per provider line item/split;
2. each line item either resolves to an internal Product or carries explicit unresolved mapping state;
3. rerunning sync updates existing item identities rather than duplicating them;
4. removed/changed provider line items reconcile under correction policy;
5. fulfilment/COGS/inventory code cannot silently process an order with missing required items as if complete;
6. summary-only imports are visibly and technically excluded from native effectful flows;
7. raw provider line-item evidence remains preserved for provenance.

Affected kernels: K9, K6, K8, K11, K10.
Affected journeys: J10, J14, J7, J18, J23.

No production implementation is authorized by this supplement.
