# KF-KERNEL-001 — Tenant Genesis & Identity

Status: ACTIVE / DIRECTIONALLY CONVERGED / NOT FROZEN

## A. Definition / Scope

Owns the canonical relationship between authenticated humans and KeyFlowOS businesses, including Business birth, User identity, Membership, ownership metadata, invitation claims, workspace discovery and tenant isolation.

## B. Product Intent

A person should move from authentication or invitation into the correct Business context without identity duplication, hidden authority gaps or constructor-dependent behavior.

Historical product direction strongly supports transactional Business + OWNER Membership formation and Membership-driven discovery.

## C. Truth Ownership

Working target:

```text
Business.ownerId
= distinguished ownership/founding identity

Membership
= canonical authenticated-human ↔ Business relationship
```

`ownerId` should not independently become the ordinary workspace-access mechanism.

## D. Current Implementation Sources

Primary evidence surfaces include IdentityService business creation/bootstrap/list/invite paths, BusinessGuard, ModuleScopeGuard and Membership persistence.

## E. Inputs

- authenticated principal;
- verified external identity;
- founder intent;
- invitation claim;
- Business creation request;
- ownership transfer/exit state.

## F. Outputs / Consumers

- current Business context;
- Membership;
- founding OWNER relationship;
- tenant access decisions;
- workspace list;
- downstream authority resolution;
- onboarding/business-birth state.

## G. State / Transition Semantics

Target invitation model:

```text
INVITATION
-> authenticated/verified person
-> claim invitation
-> revalidate invitation + grantability
-> atomic Membership creation
-> position/authority assignment if applicable
-> workspace becomes available
```

An invitation is not a placeholder User.

## H. Journey Impact Matrix

Primary:

- J1 Business Birth
- J25 Human Authority Lifecycle
- J2 Governed Action
- J19 Privacy / Deletion / Exit
- J20 Plan / Subscription / AI Cost

Also affects every authenticated journey through tenant context.

## I. Canonical Vocabulary / Contracts

- ExternalIdentity
- User
- Business
- Membership
- Founding Owner
- Invitation
- Invitation Claim
- Active Workspace

## J. Authority / Governance

Business birth must establish a founding OWNER Membership invariant.

Invitation authority intent must be revalidated at claim time rather than treated as permanently granted at invitation issuance.

## K. Transactions / Concurrency / Idempotency

Founding tenant creation should be atomic enough that Business and canonical human relationship cannot diverge.

Invitation claim should prevent duplicate claim and identity collision.

## L. Failure / Recovery

Known failure class:

```text
invite email
-> placeholder local User
-> Membership on placeholder
-> real external authentication with different ID
-> same email collision
-> account_email_conflict
```

This is an identity-model failure, not merely redirect UX.

## M. Security / Privacy

- tenant isolation must use canonical relationships;
- invitation claim requires verified identity binding;
- revoked/expired invitations must not confer stale authority;
- ownership semantics must remain distinguishable from ordinary Membership access.

## N. Evidence / Observability

Need durable evidence for:

- Business created by whom;
- founding Membership created/repaired;
- invitation issued/claimed/revoked;
- identity conflicts;
- ownership changes.

## O. Reachability / Consumers

Current implementation has mixed ownerId and Membership consumers. Consumer proof is required before tightening access semantics.

## P. Duplication / Legacy / Compatibility

Primary duplication:

```text
ownerId-based business discovery/access
vs
Membership-based business access
```

Bootstrap and explicit business creation also initialize tenant state differently.

## Q. Invariants

1. `Business.ownerId = U` implies exactly one active founding OWNER Membership for U in that Business unless ownership has been explicitly transferred under a defined state transition.
2. Membership is canonical tenant relationship for authenticated humans.
3. Invitation is a claim awaiting an authenticated principal, not a fake User.
4. Business creation paths must not produce different tenant/security semantics.
5. Tenant access and discovery must eventually converge on the same relationship model.
6. Invitation claim must revalidate the requested authority at claim time.

## R. Findings

Relevant global findings include F003–F006, F024 and later convergence findings concerning Membership/authority semantics.

## S. Contradictions

Key contradiction family:

- ownerId as access/discovery authority vs Membership as access authority;
- bootstrap constructor vs explicit constructor;
- placeholder identity vs authenticated identity.

## T. Open Questions

- exact migration from ownerId-based discovery to Membership-first discovery;
- ownership transfer semantics;
- how invitation objects should preserve intended JobRole/authority without granting it prematurely;
- repair strategy for existing placeholder Users/Memberships.

## U. Target-State Candidate

```text
authenticated principal
-> canonical User
-> Membership relationship
-> active workspace
-> Effective Authority Resolver
```

Founding path:

```text
create Business
+ create founding OWNER Membership
+ initialize knowledge/policy/operating state
-> Business Birth can proceed
```

## V. Migration / Compatibility

Candidate staged migration remains:

```text
observe
-> repair founding invariant
-> dual-read verification
-> access convergence
-> consumer migration
-> tighten ownerId shortcut
```

## W. Proof / Test Ratchets

Must eventually prove:

- owner sees all authorized businesses;
- invited staff sees only claimed businesses;
- explicit creation always creates usable founding Membership;
- invitation claim works for pre-existing and newly authenticated users;
- revoked invitation cannot later create authority;
- tenant guard and module guard agree on tenant relationship;
- migration does not strand existing owners.

## X. Layered Improvement

L0: eliminate contradictory tenant states.
L1: transactional claim/creation, isolation, audit.
L2: Membership-first canonical tenancy.
L3: authority/version-aware invitation claims and ownership transitions.
L4: frictionless role-aware business entry where KEY explains the workspace/authority context without exposing internal complexity.

## Y. Machine-readable Record

```yaml
id: KF-KERNEL-001
name: Tenant Genesis & Identity
status: directionally-converged-not-frozen
primary_journeys: [J1, J25, J2, J19, J20]
implementation_authorized: false
```
