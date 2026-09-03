# KeyFlowOS Current State

Last updated: 2026-09-03

## Analytical phase

`COMPUTABLE_MICROSCOPIC_MODEL / CROSS-JOURNEY_CONVERGENCE`

## Active unit

```text
KF-JOURNEY-001 — Business Birth
        ↕
KF-JOURNEY-025 — Human Authority Lifecycle
        ↕
KF-JOURNEY-002 — KEY Request → Governed Action
        ↓
KF-JOURNEY-015 — Approval / Governance Lifecycle (READY FOR SCOPING)
```

## Status

`THREE-AXIS CONVERGENCE DIRECTIONALLY COMPLETE — J15 READY FOR SCOPING`

Production implementation remains blocked.

## Context integrity

`PASS`

The exhausted prior conversation has been recovered and persisted. The active convergence has now also been revalidated against current `main` implementation evidence at `e1203b34d0b3091a73657dc358508d7a14109575`.

## Canonical macro thesis

> KeyFlowOS is a governed business-state transition system.

```text
External reality
  -> observation/signal
  -> Business Graph
  -> Genome interpretation
  -> KEY reasoning
  -> Capability Contract
  -> Effective Authority + KEY autonomy + readiness + policy
  -> control requirement
  -> approval/confirmation evidence when required
  -> exact-action clearance
  -> atomic execution claim
  -> canonical post-clearance dispatch
  -> domain/provider execution
  -> durable evidence/outcome
  -> Business Graph
  -> Genome evolution
```

## Three-axis convergence outcome

### Axis A — Tenant relationship

Status: `DIRECTIONALLY_CONVERGED / NOT_FROZEN`

Investigation:

`docs/intelligence/investigations/J1-J25-J2-CONVERGENCE-TENANCY.md`

Revalidated implementation facts include:

- bootstrap establishes/repairs founding OWNER Membership;
- explicit `createBusiness()` still creates Business without equivalent OWNER Membership;
- `listBusinesses()` remains ownerId-based;
- `BusinessGuard` accepts ownerId or Membership;
- `ModuleScopeGuard` requires Membership.

Working target:

```text
Business.ownerId
  = distinguished ownership identity

Membership
  = canonical authenticated-human ↔ Business relationship
    + baseline human authority envelope
```

Business Birth semantic postcondition should include founding OWNER Membership even if ownerId remains durable ownership metadata.

### Axis B — Effective human authority

Status: `DIRECTIONALLY_CONVERGED / NOT_FROZEN`

Investigation:

`docs/intelligence/investigations/J1-J25-J2-CONVERGENCE-AUTHORITY.md`

Current implementation was revalidated across Membership scopes/tier, JobRole/OrgAssignment, DelegationRule, AuthorityGrant, ApprovalRouting and CapabilityContract.

Working model:

```text
Membership baseline grants
+ active JobRole/OrgAssignment grants
+ valid explicit bounded grants
+ valid bounded delegations
- explicit denials
∩ resource/value/time/business/policy constraints
-> EffectiveAuthorityResult
```

Key distinctions:

- Membership is relationship + baseline authority, not the final flattened permission set.
- JobRole/OrgAssignment is a dynamic organizational authority source.
- Delegation cannot create authority the delegator does not possess/delegably control.
- explicit denial is a first-class target narrowing source and normally dominates additive grants.
- approval authority is distinct from request/execute authority.
- CapabilityContract permission identity should become the exact action permission vocabulary.
- a central explainable Effective Authority Resolver is still missing from implementation.

New current findings from this pass: F044–F049.
New contradiction candidates: C022–C024.

### Axis C — Clearance / execution claim / dispatcher

Status: `DIRECTIONALLY_CONVERGED / NOT_FROZEN`

Investigation:

`docs/intelligence/investigations/J1-J25-J2-CONVERGENCE-EXECUTION.md`

Revalidated implementation facts include:

- ActionDispatcher has useful circuit-breaker/retry/logging/idempotency/feedback mechanics but consumes fresh governance decisions rather than a durable exact-action clearance;
- dispatcher idempotency lookup is not an atomic pre-side-effect claim;
- KeyIdempotencyService explicitly lets another caller proceed when a key is pending;
- PlanExecutor + BullMQ re-evaluate governance at multiple layers;
- deterministic BullMQ job IDs provide transport-local dedupe, not platform-wide execution ownership;
- proposal execution and plan/dispatcher execution remain separate fabrics;
- FlowOrchestrator direct execution remains reachable from multiple callers;
- proposal read/status/update transitions do not yet prove atomic expected-state execution claiming.

Working target:

```text
CapabilityContract
  -> ActionEnvelope
  -> action fingerprint
  -> EffectiveAuthority + KEY autonomy + readiness/policy
  -> control requirement
  -> approval/confirmation evidence
  -> CLEARANCE_GRANTED
  -> atomic CLAIMED transition
  -> canonical post-clearance ActionDispatcher
  -> domain/provider execution
  -> durable outcome
```

`ActionDispatcherService` is the preferred existing seam to evolve before inventing a parallel replacement.

New current findings from this pass: F050–F056.
New contradiction candidates: C025–C028.

## J1 feed-back

Business Birth now has a sharper semantic completion requirement:

```text
Business
+ founding OWNER Membership
+ discoverability through authorized relationships
+ owner baseline resolvable through EffectiveAuthorityResolver
+ initialized knowledge/readiness state
```

`Business.ownerId` may remain explicit ultimate-ownership identity, but should not be the ordinary tenant-access mechanism.

## J25 feed-back

J25 now has a candidate authority algebra and a new requirement:

`EffectiveAuthorityResult` should expose an `authorityVersion` / fingerprint suitable for binding approvals and clearances so later authority mutation can invalidate unconsumed authorization.

## J2 feed-back

Governed Action is now better modeled around one exact capability invocation rather than proposal/plan/tool wrappers as primary governance identities:

```text
request/proposal
  -> exact Capability Contract
  -> canonical ActionEnvelope
  -> effective authority / autonomy / readiness / policy
  -> control requirement
  -> evidence-backed approval or confirmation
  -> exact-action clearance
  -> atomic execution claim
  -> dispatcher
  -> outcome
```

## J15 admission verdict

`READY_FOR_SCOPING`

This does **not** mean J15 is ready for implementation design.

The conceptual distinctions are now stable enough to perform a full forensic Approval / Governance Lifecycle analysis without the foundational questions being undefined.

J15 must now resolve at least:

- approval request identity and exact action binding;
- who may approve and how EffectiveAuthority is consumed;
- control requirement calculation vs risk tier;
- confirmation vs formal approval vs admin approval vs step-up auth;
- approval evidence durability;
- approval expiration/revocation;
- action mutation and fingerprint invalidation;
- authority-version invalidation;
- hierarchical plan approval bounds;
- approval-to-clearance issuance;
- clearance expiry/revocation;
- claim admission semantics;
- principal lineage.

## Do not yet

- modify production code;
- freeze target persistence schemas;
- convert provisional recommendations directly into implementation tickets;
- delete legacy systems without consumer proof;
- create parallel v2 registries/resolvers/dispatchers before proving existing seams insufficient;
- claim tests pass unless actually executed;
- infer dead code from UI non-navigation;
- treat J15 scoping admission as implementation authorization.

## Next analytical pass

Open `KF-JOURNEY-015 — Approval / Governance Lifecycle` for microscopic scoping/forensics only.

Use J15 to challenge and refine the three-axis model, especially approval-to-clearance binding and invalidation. Any J15 finding that changes tenancy, authority, capability identity or execution claim semantics must feed backward into J1/J25/J2 before target architecture is frozen.
