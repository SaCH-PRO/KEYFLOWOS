# KeyFlowOS Contradiction Register — Shopify Product Identity Supplement

Status: CANONICAL CONTINUATION — J10 COMMERCE / FULFILMENT
Implementation evidence: `main@4e9f60c65bdb78fbdadcb08731c5dab95b3645c7`
Production implementation: READ-ONLY / NOT AUTHORIZED

---

## C160 — Shopify variant reconciliation key contradicts the Product identity actually persisted by the importer

`ShopifyService.syncProducts()` declares a synthetic provider key:

```text
shopifyVariantId = shopify:{variant.id}
```

and searches:

```text
Product.sku = shopifyVariantId
```

but when Shopify supplies `variant.sku`, the importer persists:

```text
Product.sku = variant.sku
executionMeta.shopifyVariantId = variant.id
```

The next sync therefore asks for an identity representation the prior sync deliberately did not store in the queried field.

Thus:

```text
reconciliation identity = synthetic provider variant ID encoded as SKU
while
persisted SKU identity = merchant/provider SKU
and
persisted executionMeta provider ID is ignored by reconciliation
```

Repeat sync cannot structurally converge on the prior Product.

Target resolution:

```text
stable provider external identity
→ structural business-scoped mapping to one Product
→ SKU remains mutable/catalog-facing data rather than the sole provider reconciliation key
```

Affected finding: F210.
Affected journeys: J10, J14, J18, J23.
Affected kernels: K9, K6, K8, K11.

No production implementation is authorized by this contradiction supplement.
