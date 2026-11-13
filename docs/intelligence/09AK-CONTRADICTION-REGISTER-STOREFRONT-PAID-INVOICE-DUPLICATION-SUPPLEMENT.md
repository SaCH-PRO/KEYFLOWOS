# KeyFlowOS Contradiction Register — Storefront Paid-Invoice Duplication Supplement

Status: CANONICAL CONTINUATION — J10 COMMERCE / FULFILMENT
Implementation evidence: `main@4e9f60c65bdb78fbdadcb08731c5dab95b3645c7`
Production implementation: READ-ONLY / NOT AUTHORIZED

---

## C156 — transactional checkout invoice ownership contradicts store_order.paid listener invoice ownership

The successful native storefront path establishes:

```text
one paid StoreOrder occurrence
→ transactional Invoice A
→ Payment + ledger consequence
→ store_order.paid
```

but the mounted commerce integration listener independently interprets the same `store_order.paid` occurrence as permission to create another paid revenue Invoice when it cannot find `notes contains order:{order.id}`.

The first invoice's notes use only the order number and do not satisfy that predicate.

Therefore:

```text
StoreOrderService says:
  checkout completion already created the paid Invoice descendant

while

CommerceIntegrationService says:
  store_order.paid may require creating a paid Invoice descendant

and

their dedupe identities are not the same semantic commercial effect
```

This contradicts KF-REC-053's commercial lineage/effect-idempotency direction and reuses KF-REC-052 financial-truth boundaries.

Target resolution:

```text
commercial order occurrence O
+ obligation/effect identity E
→ one canonical Invoice descendant relation
→ all producers/listeners/retries resolve E before creating another descendant
```

`notes` text is evidence/metadata, not a canonical effect identity.

Affected findings: F206.
Affected journeys: J10, J3, J7, J18, J23.
Affected kernels: K6, K7, K8, K10, K11.

No production implementation is authorized by this contradiction supplement.
