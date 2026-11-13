# KF-KERNEL-002 — Human Authority & Organization

Status: ACTIVE / DIRECTIONALLY CONVERGED / NOT FROZEN

## A. Definition / Scope

Owns effective human authority inside a Business: base relationship, role, position, explicit grants/overrides, denials, delegation, approval authority, grantability, provenance, versioning and revocation.

## B. Product Intent

Authority should feel simple to users while remaining exact, explainable, bounded and safe internally.

## C. Truth Ownership

No single current field is sufficient as effective authority.

Working target:

```text
Membership
= tenant relationship + baseline authority

OrgAssignment + JobRole
= current organizational position authority

Explicit grants/overrides/denials
= bounded policy inputs

Delegation
= bounded authority transfer, not routing alone

EffectiveAuthorityResult
= resolved decision-time output
```

## D. Current Implementation Sources

Membership role/scopes/tier, JobRole, OrgAssignment, StructureService, JobRolePolicyService, ModuleScopeGuard, ApprovalRouting, DelegationRule, AuthorityGrant and route/service-specific checks.

## E. Inputs

- principal identity;
- Business/Membership;
- position/JobRole;
- explicit grant/override;
- explicit denial where introduced;
- delegation;
- capability/resource/value/time context;
- validity/revocation state.

## F. Outputs / Consumers

Candidate `EffectiveAuthorityResult` axes:

```text
canRequest
canExecute
canApprove
canDelegate
effectiveApprovalTier
resource/value/time bounds
provenance
authorityVersion / fingerprint
principal type
authentication evidence strength
```

## G. State / Transition Semantics

Authority lifecycle includes:

```text
invite
-> claim Membership
-> role/position assignment
-> override/grant/delegation
-> promotion/demotion
-> expiry/revocation
-> exit
```

Transitions must not leave copied stale effective authority behind.

## H. Journey Impact Matrix

Primary:

- J25 Human Authority Lifecycle
- J15 Approval / Governance Lifecycle
- J2 Governed Action
- J8 Work Delivery
- J11 Contracts
- J12 Evidence Lifecycle
- J23 Temporal Flow

Also affects all authenticated mutation journeys.

## I. Canonical Vocabulary / Contracts

- Membership baseline authority
- JobRole/Position authority
- OrgAssignment
- ExplicitGrant / Override
- ExplicitDeny
- Delegation
- GrantableAuthority
- EffectiveAuthorityResult
- ApprovalAuthority
- AuthorityVersion
- PrincipalLineage

## J. Authority / Governance

Candidate algebra:

```text
Gbase      = Membership defaults
Gposition  = active JobRole/OrgAssignment grants
Gexplicit  = valid bounded grants/overrides
Gdelegate  = valid bounded delegation
Gcandidate = Gbase ∪ Gposition ∪ Gexplicit ∪ Gdelegate
GafterDeny = Gcandidate - Gdeny
Gcontext   = GafterDeny ∩ capability/resource/value/time/business/policy constraints
```

Important:

- JobRole can potentially expand beyond Membership defaults if legitimately grantable;
- Membership role is not necessarily a universal ceiling;
- protected owner/control-plane capabilities may be non-delegable;
- explicit deny normally dominates additive grant unless an explicit break-glass model exists.

## K. Transactions / Concurrency / Idempotency

Authority changes should update version/provenance atomically enough that stale approvals/clearances can detect invalidation.

## L. Failure / Recovery

Current failure classes:

- JobRole authority copied into Membership and not reliably recomputed;
- different pathways resolve live position authority versus copied Membership authority;
- grantor identity can be caller-provided in some delegation/grant flows;
- routing/delegation records may be treated as if they prove authority;
- approval surfaces use inconsistent authority semantics.

## M. Security / Privacy

Core law:

> No principal may create, assign, delegate or approve authority greater than the authority they are authorized to grant.

Control-plane authority must be stronger than ordinary operational authority where the control can enable high-impact behavior.

## N. Evidence / Observability

Every authority decision should be explainable through provenance:

```text
which relationship
+ which role/position
+ which grant/delegation
+ which denial
+ which capability/resource bound
+ which version
```

## O. Reachability / Consumers

Current authority resolution is scattered across guards, services, approval helpers and channel-specific logic. No central complete Effective Authority Resolver has been found.

## P. Duplication / Legacy / Compatibility

Current permission languages are fragmented across Membership modules, HTTP guard modules, JobRole/Flow tool families and CapabilityContract permission identity.

JobRole authority is also destructively materialized into Membership in current paths.

## Q. Invariants

1. Effective authority is resolved from authoritative inputs, not inferred from stale copies.
2. Granted/delegated authority ≤ grantor/delegator grantable authority.
3. Routing does not prove authority.
4. Approval authority is distinct from request/execute authority.
5. Authority provenance survives async execution.
6. Revocation/expiry must affect unconsumed authorization.
7. Permission vocabulary must become canonical and machine-resolvable.
8. Position-bound external approvers require verifiable principal/channel evidence.

## R. Findings

Primary current findings include F044–F049 and J15 refinements F060–F061, F066, F072.

## S. Contradictions

Primary candidates include C022–C024, C029–C030, C034 and C038.

## T. Open Questions

- exact precedence between base role, JobRole, explicit override, deny and delegation;
- which sources may expand authority versus only narrow it;
- canonical capability permission vocabulary and adapters from module UX concepts;
- authority version semantics;
- secure identity proof for contact-only approvers;
- non-delegable owner/control-plane authorities.

## U. Target-State Candidate

A central explainable Effective Authority Resolver is justified because no current seam appears to provide complete decision-time authority resolution.

It should consume exact CapabilityContract identity and context rather than generic module labels where possible.

## V. Migration / Compatibility

Do not immediately delete Membership permission/tier fields. First classify each field as source, explicit override, cache/projection or compatibility residue, then migrate consumers.

## W. Proof / Test Ratchets

Eventually prove:

- assignment grant cannot self-escalate;
- inviter cannot grant more than grantable authority;
- demotion/revocation takes effect across web/API/KEY/channel paths;
- route authorization and approval authorization consume the same effective model;
- stale authority version invalidates dependent unconsumed clearance;
- external approver identity is spoof/replay resistant.

## X. Layered Improvement

L0: eliminate privilege-escalation contradictions.
L1: deny-by-default canonical permission vocabulary and bounded grants.
L2: central Effective Authority Resolver with provenance.
L3: continuous revocation/version invalidation and resource/value/time bounds.
L4: explainable Authority Graph and safe natural-language “why can/can’t I do this?” behavior.

## Y. Machine-readable Record

```yaml
id: KF-KERNEL-002
name: Human Authority & Organization
status: directionally-converged-not-frozen
primary_journeys: [J25, J15, J2, J8, J11, J12, J23]
implementation_authorized: false
```
