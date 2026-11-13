# KeyFlowOS Contradiction Register — Public Customer Boundary Supplement

Status: CANONICAL CONTINUATION AFTER C181.

## C182 — portal token semantics imply one tenant/customer context while grant creation does not prove business/contact co-membership

```text
PortalAccess.businessId = A
PortalAccess.contactId = B-contact
→ validate token returns A + B-contact
```

The public grant therefore can represent a mixed tenant/subject context.

Target: a portal grant binds one verified business-scoped customer subject before token issuance.

Related F232.

## C183 — booking availability and write validation claim an available slot while concurrent writers do not own that slot atomically

```text
availability/write rule says slot free
+ two simultaneous writers pass same read
→ two writes can occupy one slot
```

A shared validator is necessary but not sufficient for concurrent reservation.

Target: semantic slot ownership/constraint at commit.

Related F233.
