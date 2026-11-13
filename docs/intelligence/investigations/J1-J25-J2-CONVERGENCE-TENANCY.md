# J1 / J25 / J2 Convergence — Axis A: Tenant Relationship

Status: ACTIVE REVALIDATION

Implementation evidence baseline: `main@e1203b34d0b3091a73657dc358508d7a14109575`

Canonical intelligence branch: `docs/keyflow-intelligence-foundation`

Scope: revalidate and converge the relationship among authenticated User, Business ownership, Membership, workspace discovery, tenant access and authority baseline before J15 admission.

No production-code changes are authorized by this investigation.

---

## 1. Revalidated implementation facts

### A1 — Explicit business creation is ownerId-only

`IdentityService.createBusiness()` creates a `Business` with `name` and `ownerId`, then best-effort seeds default autopilot triggers/settings. It does not create or upsert an OWNER Membership in this path.

Evidence: `apps/server/src/modules/identity/identity.service.ts` on current evidence baseline.

Historical finding relation: strengthens recovered F004 and F005.

### A2 — Bootstrap business creation repairs/creates OWNER Membership

`bootstrapUser()` finds the oldest non-deleted Business where `ownerId = user.id`; if absent it creates a Business with onboarding initialization. It then upserts Membership for `(userId, businessId)` and sets role `OWNER`.

Therefore the first authentication/bootstrap path and explicit later create path do not share one founding-tenant invariant.

Historical finding relation: strengthens recovered F003, F004, F005 and C006.

### A3 — Business discovery remains owner-based

`IdentityService.listBusinesses(userId)` queries Business rows using:

```text
ownerId = userId
AND deletedAt = null
```

It does not discover workspaces through Membership.

Consequence: a non-owner team member's valid Membership is not represented by this discovery method.

Historical finding relation: strengthens F006 / C005.

### A4 — BusinessGuard treats ownerId and Membership as alternate tenant-access proofs

For non-SUPER_ADMIN principals, BusinessGuard accepts a business when either:

- `Business.ownerId == user.id`; or
- the business has a Membership for the user.

Therefore ownerId can independently establish tenant access even if Membership is absent.

### A5 — ModuleScopeGuard requires Membership

When a route declares a module-scope requirement, ModuleScopeGuard loads Membership by `(userId, businessId)` and rejects if none exists. It then resolves permission scopes from Membership or role defaults.

Therefore a user can theoretically satisfy BusinessGuard through ownerId but fail a scoped endpoint because no Membership exists.

This is not merely duplicate representation: the two tenant/authority paths are behaviorally non-equivalent.

### A6 — Membership already carries material authority state

Current Membership usage includes:

- role;
- `permissionScopes`;
- `maxApprovalTier`;
- org assignments / JobRole context;
- team-management authorization;
- scoped-route authorization.

Thus Membership is already more than a discovery join table in current implementation.

### A7 — Invitation still creates a local User before authenticated identity exists

`inviteTeamMember()` finds User by email and, if missing, immediately creates a local User, then creates Membership.

This preserves the recovered conceptual defect: invitation claim and authenticated identity remain collapsed.

### A8 — Historical blueprint intended Membership-driven tenancy

The historical KeyFlow blueprint explicitly intended:

- `createBusiness(userId, name)` to create Business + OWNER Membership atomically;
- `listBusinesses(userId)` to query Membership.

This is product/architecture source evidence, not current implementation truth, but it demonstrates that Membership-first tenancy is not an invented post-hoc direction.

---

## 2. Current contradiction model

Current implementation simultaneously asserts:

```text
Business.ownerId
  = enough to discover owned businesses
  = enough to pass BusinessGuard
```

and:

```text
Membership
  = required for module-scoped authorization
  = source of role/scopes/approval tier
  = representation of team/workspace membership
```

These models cannot remain independent without producing split-brain tenant semantics.

The problem is not that `ownerId` exists. The problem is that `ownerId` and Membership are both functioning as independent access authorities.

---

## 3. Candidate canonical invariant — version 0.1

WORKING DIRECTION — NOT YET ACCEPTED DECISION

### Relationship invariant

> Membership is the canonical Business-to-human tenant relationship. `Business.ownerId` identifies the distinguished legal/founding owner principal but does not independently grant application workspace access.

This preserves ownership semantics while eliminating dual access models.

Candidate interpretation:

```text
User / authenticated principal
        |
        v
Membership ------------------------------+
        |                                 |
        | tenant relationship             | base authority envelope
        v                                 v
Business                           role/scopes/tier
        |
        +--> ownerId = distinguished owner identity metadata/invariant
```

### Founding invariant

For every active Business with a human owner:

```text
Business.ownerId = U
=> exactly one active Membership exists for (U, Business)
   with founding owner semantics
```

Business creation must not commit a durable Business state in which this invariant is absent unless a deliberately defined system-owned/business-without-human-owner state is introduced later.

### Access invariant

For normal humans:

```text
Business access
  requires active Membership
```

`SUPER_ADMIN` remains an explicit platform-level bypass if retained.

`ownerId` should validate/identify owner semantics, not bypass Membership.

### Discovery invariant

Workspace discovery should be Membership-first:

```text
principal
  -> Memberships
  -> authorized Businesses
```

not:

```text
principal
  -> Business.ownerId only
```

### Authority invariant

Membership establishes the base authority envelope but should not necessarily contain the final resolved authority. Effective authority remains Axis B and may derive from role, JobRole/position, grants, denials, delegation, capability and context.

---

## 4. Migration problem — required before acceptance

A Membership-first target cannot simply remove `ownerId` checks. Migration must first classify existing data:

### Required data classes

1. Business has ownerId + matching OWNER Membership — coherent.
2. Business has ownerId but no matching Membership — repair required.
3. Business owner Membership exists but role/scopes/tier are inconsistent — reconciliation required.
4. Membership exists for non-owner users — preserve.
5. invited placeholder User + Membership — identity-claim migration required.
6. Business ownerId references a stale/deleted/missing User — exceptional repair path.
7. multiple owner-like Memberships — determine whether product supports co-owners or only one distinguished owner.

### Safe migration sequence — working proposal

```text
Phase T0 — Observe
  inventory ownerId/Membership consistency
  inventory business discovery consumers
  inventory ownerId authorization consumers

Phase T1 — Repair invariant
  create/repair missing founding OWNER Memberships
  preserve ownerId

Phase T2 — Dual-read verification
  introduce Membership-first discovery/resolution
  compare results against old owner-based behavior
  instrument mismatches

Phase T3 — Access convergence
  require Membership for normal human Business access
  retain explicit platform-admin bypass
  ownerId becomes ownership identity, not alternate tenant ACL

Phase T4 — Consumer migration
  remove ownerId-as-access assumptions from callers
  preserve owner-specific business rules through an explicit owner predicate

Phase T5 — Tighten invariants
  creation paths enforce Business + founding Membership coherently
  database/application invariant tests cover all creation routes
```

This is a migration model, not an implementation plan yet.

---

## 5. Why ownerId should probably remain

WORKING INTERPRETATION

Membership-first tenancy does **not** imply deleting `Business.ownerId`.

A distinguished owner identity can still be useful for:

- ultimate business ownership semantics;
- transfer-of-ownership workflow;
- non-delegable actions;
- billing/legal/account recovery policy;
- default founder identity;
- invariant checks.

The architectural correction is to separate:

```text
WHO OWNS THE BUSINESS?
```

from:

```text
WHO HAS A TENANT RELATIONSHIP WITH THE BUSINESS?
```

and from:

```text
WHAT MAY THIS PRINCIPAL DO RIGHT NOW?
```

Those are three different questions.

---

## 6. Consequences for active journeys

### J1 — Business Birth

Business Birth tenant state should not be considered coherent merely because a Business row exists.

Candidate tenant-birth condition becomes:

```text
authenticated/local human identity
  + Business
  + founding Membership
  + explicit distinguished-owner relationship
  = TENANT_READY
```

This strengthens the recovered understanding that Business Birth contains a tenant/authority birth, not only a database insert.

### J25 — Human Authority Lifecycle

Membership becomes the stable relationship anchor on which effective authority can be calculated, but it must not automatically be treated as the complete final authority model.

Axis B must answer how base role/scopes interact with JobRole, grants, denials and delegation.

### J2 — KEY Request -> Governed Action

Every human principal entering governed action evaluation should have a tenant relationship resolved before capability authorization/approval logic is evaluated.

This prevents J2 from inheriting two incompatible meanings of “user belongs to this business.”

---

## 7. Questions still blocking final tenancy decision

1. Are there current production data cases with ownerId but no Membership, and in what volume?
2. Are any flows intentionally designed for a Business owner to operate without Membership?
3. Does current product intent allow co-owners, or exactly one distinguished owner plus delegated admins?
4. Which repository consumers use ownerId specifically for ownership semantics versus merely access control?
5. What exact behavior should ownership transfer have?
6. How should invited placeholder User records be claimed/migrated when real external identity appears?
7. Should founding OWNER Membership permission fields be stored or derived from the distinguished-owner invariant?
8. What database constraint/application transaction boundary can prove that no normal Business is left without its founding Membership?

---

## 8. Preliminary convergence verdict

Axis A status: `DIRECTIONALLY CONVERGED / NOT YET FROZEN`.

Strong candidate architecture:

```text
ownerId
  = distinguished ownership identity

Membership
  = canonical tenant relationship + base authority envelope

EffectiveAuthorityResolver
  = final human capability authority (Axis B)
```

Do not convert this into production implementation until Axis B authority semantics and migration evidence are sufficiently resolved.
