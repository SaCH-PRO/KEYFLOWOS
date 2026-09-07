# KeyFlowOS Contradiction Register — Customer State Algebra Supplement

Status: CANONICAL SUPPLEMENT
Last updated: 2026-09-06
Scope: J3 Lead → Customer → Cash

## C155 — One Contact status field vs multiple incompatible lifecycle/health dialects

```text
CRM contract:
LEAD | PROSPECT | CLIENT | LOST

!=

Shopify writer:
LEAD | CUSTOMER

!=

People Flow Contact.status interpretation:
LEAD | PROSPECT | CUSTOMER | DORMANT | AT_RISK

!=

separate CRM relationshipHealth dimension that already owns DORMANT / AT_RISK semantics
```

`Contact.status` is persisted as a free-form String, so direct integration writers can bypass the CRM-facing algebra. Shopify can create/update Contacts to `CUSTOMER`, while People Flow reads relationship-health words from the lifecycle field.

This contradiction is distinct from F197/C147 (commercial evidence does not converge to CLIENT) and F203/C153 (KeyCortex queries non-canonical status aliases). It is the persisted customer-state algebra itself that is not singular.

Finding: F205.

Target direction: separate lifecycle, relationship health, deal/pipeline state and descriptive segmentation into explicit owned dimensions with versioned adapter mappings; do not create one larger catch-all status vocabulary.

No production implementation is authorized by this supplement.
