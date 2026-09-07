# KeyFlowOS Contradiction Register — Shopify Customer Identity Supplement

Status: CANONICAL CONTINUATION — J10 COMMERCE / FULFILMENT
Implementation evidence: `main@4e9f60c65bdb78fbdadcb08731c5dab95b3645c7`
Production implementation: READ-ONLY / NOT AUTHORIZED

---

## C162 — Shopify customer sync recognizes provider identity while Shopify order sync recognizes only mutable email

Two mounted Shopify write paths disagree about what makes a Contact the same provider customer:

```text
syncCustomers:
  email OR custom.shopifyCustomerId

syncOrders:
  email only
```

After a provider-side email change, order sync can create a second Contact carrying the same `shopifyCustomerId` before customer sync has a chance to update the first Contact.

Thus:

```text
immutable provider identity says SAME CUSTOMER
while
order-import email lookup says NEW CONTACT
```

Target resolution:

```text
all Shopify Contact writers
→ resolve one business-scoped provider external identity first
→ then reconcile mutable email/phone/name attributes under explicit conflict/merge policy
```

Affected finding: F212.
Affected journeys: J10, J3, J14, J18, J23.
Affected kernels: K9, K6, K8, K11.

No production implementation is authorized by this contradiction supplement.
