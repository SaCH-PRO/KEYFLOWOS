# KeyFlowOS Finding Register — Public Customer Boundary Supplement

Status: CANONICAL CONTINUATION AFTER F231.

## F232 — PortalAccess can bind a business to an unverified contact identity from another tenant

`PortalAccess` stores a Business relation plus a scalar `contactId`; the schema does not declare a Contact relation that enforces business/contact co-membership.

`PortalService.createAccess(businessId, contactId)` creates or rotates the bearer token without an inspected lookup proving the Contact belongs to that business.

The public validation endpoint then returns `businessId` and `contactId` from that row as one context.

Thus:

```text
BusinessGuard(A)
+ caller supplies ContactId(B)
→ PortalAccess(A, ContactB)
→ bearer token returns mixed tenant context
```

Runtime exploitation was not reproduced. This is a static tenant-binding defect.

Affected: J21, J8, K1, K2, K9. Related: C182.

## F233 — public booking slot ownership remains a concurrent read-before-create race

All current booking writers and availability use one shared `assertSlotFree()`, a positive convergence seam.

But the write path remains:

```text
SELECT overlapping booking
→ none
→ INSERT booking
```

with no database exclusion/claim spanning the test and insert.

The maintained source test explicitly states the simultaneous-request race remains open and needs a database constraint plus a decision for existing overlapping rows.

Therefore two concurrent public requests can both observe a free slot and then both create bookings, conditional on normal transaction isolation and absence of an external serialization mechanism.

Affected: J21, J4, K6, K7, K11. Related: C183.

No runtime incident is claimed by this supplement.
