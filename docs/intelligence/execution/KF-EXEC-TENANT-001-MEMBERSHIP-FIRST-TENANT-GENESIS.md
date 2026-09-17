# KF-EXEC-TENANT-001 — Membership-First Tenant Genesis Compatibility

Status: DRAFT / NO IMPLEMENTATION AUTHORIZATION
Primary kernels: K1, K2
Primary journeys: J1, J25
Baseline: main@8f173bfe79f1418159cf4099ea18b0d60d203ec2

## Objective

Make every supported Business creation path establish an equivalent tenant relationship postcondition without breaking existing Business.ownerId compatibility.

Required semantic postcondition:

Business created
→ distinguished owner identity retained
→ founding OWNER Membership exists
→ authorized workspace is discoverable
→ effective-authority resolver can consume the relationship.

## Current evidence

Known seams:
- apps/server/src/modules/identity/identity.service.ts
- identity controller
- BusinessGuard
- ModuleScopeGuard
- Business / Membership schema
- workspace selection client code.

Historical findings include:
- ownerId and OWNER Membership dual semantics;
- alternate business creation paths with unequal initialization;
- owner-oriented discovery vs Membership access;
- invitation placeholder identity pressure.

Revalidate every concrete writer against current main before edit.

## Target invariants

1. Membership is the ordinary authenticated-human ↔ Business relationship.
2. Business.ownerId may remain distinguished ownership/compatibility metadata but cannot be the only ordinary discovery/access source.
3. every supported Business constructor produces one founding OWNER Membership or fails atomically/repairably;
4. repeated bootstrap is idempotent;
5. existing legitimate non-owner Membership users remain discoverable;
6. browser workspace selection is never authorization;
7. migration detects businesses lacking founding Membership before enforcement;
8. migration does not silently assign ownership where historical truth is ambiguous.

## Existing seams to strengthen

Prefer IdentityService/bootstrap/business creation and Membership.
Do not create TenantMembership2 or a second workspace registry.

## Prohibited shortcuts

- no access check that trusts kf_business_id;
- no deleting ownerId before consumer proof;
- no blind owner Membership backfill if owner identity is ambiguous;
- no placeholder User creation as the long-term invitation model inside this packet;
- no authority expansion beyond founding OWNER repair.

## Likely affected systems

- identity.service.ts / identity.controller.ts;
- Business/Member relations and queries;
- business-list/workspace discovery;
- BusinessGuard/ModuleScopeGuard consumers only where needed for compatibility;
- migration/backfill scripts/schema only after deliberate current-main/schema revalidation;
- tests around bootstrap/create/list.

## Migration

Stage:
1. inventory Business rows and OWNER Membership relationships;
2. classify exact match / missing / conflicting / ambiguous;
3. add compatibility read adapter if required;
4. backfill deterministic missing founding Memberships;
5. enforce constructor postcondition;
6. move discovery toward Membership-first;
7. retain ownerId compatibility until downstream proof;
8. report ambiguous rows for explicit repair.

## Acceptance proof

- explicit business create yields OWNER Membership;
- bootstrap retry does not duplicate;
- alternate creation path has equivalent postcondition;
- owner with Membership discoverable;
- non-owner member discoverable;
- unrelated user cannot discover/access;
- workspace cookie cannot grant access;
- migration detects missing/conflicting owner membership;
- concurrent bootstrap/create cannot create duplicate founding relationships;
- rollback preserves both ownerId and legitimate Membership history.

## Non-goals

Invitation claim redesign, full EffectiveAuthority, role/delegation algebra and owner transfer are separate packets.
