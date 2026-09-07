# KeyFlowOS Contradiction Register — Shopify Order Structural Completeness Supplement

Status: CANONICAL CONTINUATION — J10 COMMERCE / FULFILMENT
Implementation evidence: `main@4e9f60c65bdb78fbdadcb08731c5dab95b3645c7`
Production implementation: READ-ONLY / NOT AUTHORIZED

---

## C163 — Shopify orders occupy the native MarketplaceOrder aggregate while their item obligations exist only in provider metadata

`ShopifyService.syncOrders()` persists Shopify line items only to `metadata.lineItems`; it does not create native `MarketplaceOrderItem` descendants, and no `shopify.orders_synced` listener materializes them later.

At the same time, native fulfilment, inventory and cost flows interpret `MarketplaceOrder.items` as the structural commercial contents of an order.

Thus:

```text
aggregate identity says MarketplaceOrder
while
native structural item set says empty
while
provider metadata says line items exist
```

Target resolution must explicitly choose operational materialization or summary/evidence-only projection. Provider JSON evidence cannot silently substitute for native item obligations in effectful commerce flows.

Affected finding: F213.
Affected journeys: J10, J14, J7, J18, J23.
Affected kernels: K9, K6, K8, K10, K11.

No production implementation is authorized by this contradiction supplement.
