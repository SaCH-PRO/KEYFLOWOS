# KeyFlowOS Finding Register — Shopify Product Identity Supplement

Status: CANONICAL CONTINUATION — J10 COMMERCE / FULFILMENT
Implementation evidence: `main@4e9f60c65bdb78fbdadcb08731c5dab95b3645c7`
Production implementation: READ-ONLY / NOT AUTHORIZED

---

## F210 — Shopify product sync persists one external identity representation but searches by another, so repeat sync cannot converge on the previously imported Product when a real SKU exists

**Status:** VERIFIED REACHABLE EXTERNAL-IDENTITY / IMPORT-IDEMPOTENCY FINDING

`ShopifyService.syncProducts()` iterates Shopify variants and constructs:

```text
shopifyVariantId = `shopify:${variant.id}`
```

It searches for an existing KeyFlow Product using:

```text
Product where businessId = B AND sku = shopifyVariantId
```

The comment explicitly describes this SKU as the Shopify-variant dedupe key.

However the row written through `CatalogService.createProduct()` uses:

```text
sku = variant.sku ?? shopifyVariantId
executionMeta.shopifyVariantId = variant.id
```

Therefore whenever Shopify supplies a normal real SKU such as `ABC-123`:

```text
first sync lookup:  sku = shopify:987      → not found
first sync persist: sku = ABC-123
                    executionMeta.shopifyVariantId = 987

second sync lookup: sku = shopify:987      → still not found
```

The persisted provider variant identity in `executionMeta` is not consulted by the next lookup, and `CatalogService.createProduct()` has no semantic external-identity reconciliation step before `product.create()`.

The exact second-sync database symptom depends on schema constraints:

```text
if repeated real SKU is permitted → duplicate Product row(s)
if repeated real SKU is unique    → sync fails on create
```

but the architecture defect is invariant: **repeat sync cannot identify and update the Product it previously imported.**

### Distinct root

This is not merely F205 provider vocabulary drift and not a generic retry failure. It is a K9 external-identity contract defect:

```text
lookup identity != persisted identity used for next reconciliation
```

It also pressures J18/J23 because repeated scheduled/manual sync attempts cannot be semantically idempotent.

### Target law

```text
ExternalEntityIdentity(provider=SHOPIFY, entityType=VARIANT, externalId=variant.id, businessId=B)
→ exactly one internal Product identity
→ every import/update/replay resolves that mapping before mutation
```

A merchant-facing SKU is business/catalog data and must not be overloaded as the only provider identity when the provider already has an immutable variant ID.

The target need not introduce one universal integration table if an existing provider-identity mechanism can own this mapping; it does require one structural reconciliation key independent of mutable/user-facing SKU values.

### Proof pressure

Future proof must demonstrate:

1. importing a Shopify variant with a real SKU twice updates the same Product;
2. changing the Shopify SKU does not create a new Product for the same variant;
3. two different Shopify variants cannot collapse merely because they share/misconfigure the same SKU unless an explicit merge policy exists;
4. replayed/paginated/scheduled sync converges on stable internal identity;
5. provider identity remains business-scoped and preserves provenance;
6. correction/unlink/reconnect semantics do not silently orphan imported products.

Affected kernels: K9, K6, K8, K11.
Affected journeys: J10, J14, J18, J23.

No production implementation is authorized by this supplement.
