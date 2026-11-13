# Module Contract — Authentication & Business Boundary v1

**Status:** DRAFT FOR CHARACTERIZATION / NOT AN IMPLEMENTATION DIRECTIVE
**Source main:** `b1948d2797e1bae3660a3d7173abb75397e05aad`
**Scope:** identities, business membership, tenant selection, authorization guards, module permissions and API/UI enforcement that protect Contacts, Invoicing and Payments.

## 1. Customer outcome
A legitimate user can authenticate, select an accessible business and act only within its permissions. Users outside the business cannot infer, view, create or mutate its records. Existing role and membership behavior must be discovered, not redesigned without evidence.

## 2. Code owners to verify
| Concern | Initial code location | Verification |
|---|---|---|
| Authentication guards | `apps/server/src/core/auth/` | Trace principal, token verification, failures |
| Business/tenant guards | `apps/server/src/` guards and commerce/CRM controllers | Enumerate member lookups and tenant binding |
| Module/role permissions | CRM and commerce authorization helpers | Compare list/detail/write and service contexts |
| Membership and identity schema | `packages/db/prisma/schema.prisma` | Field/constraint inventory required |
| Client sessions | `apps/web/src/` session/navigation components | Trace selected business and invalidated sessions |
| Real-DB tests | server integration tests | Verify membership and tenant boundary cases |

All entries are starting hypotheses, not exhaustive ownership claims. Exact file names, blobs, line anchors and guard order are OPEN pending full read-only inspection.

## 3. Domain and API contract
Discover current principals, business membership statuses, roles, scope inheritance, invitation/onboarding, ownership transfers, session expiration, identity revocation and multi-business switching. Trace the exact request identity propagation and authorization order for bare-resource-ID versus business-prefixed routes. Do not assume a controller guard enforces record-level constraints.

## 4. UI contract
Business switcher and protected navigation must reflect actual server authorization. An unauthorized or expired session must not appear as a successful empty-data result. Existing invite/session experiences are preserved until a separate design decision.

## 5. Invariants
- Authentication must precede access to private business data.
- Every resource lookup binds actor, membership, business scope and where applicable record visibility.
- Denial should not leak hidden/private record existence.
- Role/module changes, removed members and revoked sessions take effect according to a tested freshness policy.
- A shared system-context service method must never silently bypass actor checks on request-derived calls.
- Cross-tenant relation IDs and direct child-resource routes must fail closed.
- No reliance on UI hiding as backend authorization.

## 6. Pilot proof matrix
| ID | Required proof |
|---|---|
| AB-P01 | Valid user and membership can access own business |
| AB-P02 | Invalid/expired identity denied, no data |
| AB-P03 | Cross-business URL and foreign record ID denied |
| AB-P04 | Removed/suspended member denied on fresh request |
| AB-P05 | No module scope denies read/write even by guessed ID |
| AB-P06 | Private ownership and sharing policy consistent across list/detail |
| AB-P07 | Multi-business switch cannot carry foreign IDs/data |
| AB-P08 | System-context/actor-context calls independently characterized |
| AB-P09 | Real DB and HTTP test paths verify guards and row predicates |

## 7. Return
Read-only inventory with exact source main blob anchors, threat and trust boundaries, test inventory, gaps ranked by exposure, and explicit dependency edges to Invoicing/Payments. No source mutations, credentials, production sessions, migrations, directive or merge authorized.
