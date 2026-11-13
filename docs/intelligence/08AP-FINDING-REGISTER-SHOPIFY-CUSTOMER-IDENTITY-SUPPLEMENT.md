# KeyFlowOS Finding Register — Shopify Customer Identity Supplement

Status: CANONICAL CONTINUATION — J10 COMMERCE / FULFILMENT
Implementation evidence: `main@4e9f60c65bdb78fbdadcb08731c5dab95b3645c7`
Production implementation: READ-ONLY / NOT AUTHORIZED

---

## F212 — Shopify order sync and customer sync use different Contact identity resolution rules, so a provider customer can split into duplicate KeyFlow Contacts when mutable email changes

**Status:** VERIFIED REACHABLE EXTERNAL-IDENTITY / MULTI-WRITER FINDING

Shopify exposes independent sync endpoints for products, orders and customers.

`ShopifyService.syncCustomers()` resolves a Contact using:

```text
businessId = B
AND (
  email = customer.email
  OR custom.shopifyCustomerId = customer.id
)
```

It therefore has a provider-ID fallback capable of finding an existing Contact after an email change.

`ShopifyService.syncOrders()`, however, resolves an order customer only by:

```text
businessId = B
AND email = order.customer.email
```

If no Contact exists at that email, it creates a Contact containing:

```text
custom.shopifyCustomerId = order.customer.id
```

but it does not search that provider identity before creation.

Reachable sequence:

```text
T1: Shopify customer 123 has email old@example.com
    → Contact C1 created with email=old@example.com
       and custom.shopifyCustomerId=123

T2: customer changes Shopify email to new@example.com

T3: independent order sync runs before customer sync
    → syncOrders searches only email=new@example.com
    → C1 not found
    → Contact C2 created with email=new@example.com
       and custom.shopifyCustomerId=123
```

The same provider customer can now be represented by multiple KeyFlow Contact rows.

A later customer sync searches by email OR provider ID, but once duplicate rows exist a `findFirst` cannot itself express the intended merge/canonical-identity decision.

### Distinct root

F210/C160 covers Product repeat-sync where one importer searches by synthetic provider-ID-as-SKU but persists a real SKU.

F212/C162 covers **cross-entrypoint Contact identity disagreement**: one Shopify writer recognizes immutable provider ID while another writer only recognizes mutable email.

Both pressure K9 external-identity architecture, but they are distinct reachable mutation patterns and migration/proof obligations.

### Target law

```text
ExternalEntityIdentity(
  businessId=B,
  provider=SHOPIFY,
  entityType=CUSTOMER,
  externalId=customer.id
)
→ exactly one canonical Contact identity
```

Mutable email/phone/name are attributes/evidence, not the sole provider identity.

Every Shopify entrypoint that may create/update a Contact must resolve the same structural provider identity before mutation, then apply explicit merge/conflict policy if email points to a different existing Contact.

### Proof pressure

1. changed provider email updates/reconciles the same Contact rather than creating another;
2. order sync and customer sync resolve identical provider customer IDs consistently regardless of execution order;
3. conflicting email-vs-provider-ID matches produce an explicit merge/conflict decision rather than silent overwrite;
4. repeated sync is idempotent across endpoint order, pagination and retry;
5. Contact lifecycle policy remains separate from provider identity mapping (reuse F205/KF-REC-053);
6. migration can detect historical Contacts sharing one Shopify customer ID.

Affected kernels: K9, K6, K8, K11.
Affected journeys: J10, J3, J14, J18, J23.

No production implementation is authorized by this supplement.
