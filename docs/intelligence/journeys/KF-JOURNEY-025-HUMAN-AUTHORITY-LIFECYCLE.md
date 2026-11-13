# KF-JOURNEY-025 — Human Authority Lifecycle

Status: PARTIALLY_MODELLED / ACTIVE CONVERGENCE

Source basis: recovered prior-thread analysis. Commit-sensitive implementation claims must be revalidated before implementation work.

## A. Definition

This journey models how a human acquires, changes, delegates, exercises and loses authority inside a KeyFlowOS business.

It exists because J1 and J2 exposed that tenant relationship, ownership, role, approval tier, JobRole-derived permission, explicit grant/delegation and action-specific authority were not one coherent concept in the current implementation.

## B. Product intent

KeyFlowOS needs one explainable answer to:

> What may this human legitimately do in this business, on this capability/resource, right now, and why?

The answer must preserve tenant membership, ownership semantics, explicit denials, bounded grants/delegations, approval tier and context without silently escalating authority.

## C. Why J25 became first-class

Recovered analysis originally moved from J1 to J2, then discovered that governed action could not be settled while human authority itself was fragmented.

Active mesh:

```text
J1 Business Birth
  <-> J25 Human Authority Lifecycle
  <-> J2 KEY Request -> Governed Action
```

J25 must stabilize before J15 Approval / Governance Lifecycle is fully opened.

## D. Tenant relationship

Working direction:

> Membership remains the canonical statement that an authenticated human belongs to a business.

Current implementation also uses `Business.ownerId` as a material ownership/access concept and Membership as a carrier/cache of role/scopes/tier.

Recovered contradiction:

- tenant discovery/ownership may be ownerId-oriented;
- access/scoped authorization may be Membership-oriented;
- some creation paths may establish Business without equivalent OWNER Membership.

Working migration objective:

```text
ownerId + Membership
  -> Membership-first tenant relationship
```

without losing explicit ownership semantics or breaking existing data.

## E. Founding authority

Business Birth should not merely create a Business. Founding tenant creation should establish a coherent founding authority envelope.

Working invariant direction:

```text
Business creation
  -> founding Membership
  -> OWNER/base authority envelope
  -> tenant discoverability
  -> authority-resolver visibility
```

Any alternate creation path should satisfy equivalent semantic postconditions even if implementation differs.

## F. Membership

Recovered refined concept:

> Membership = workspace relationship + base human authority envelope.

Current implementation also appeared to use it as a materialized projection/cache of JobRole-derived `permissionScopes` and `maxApprovalTier`.

Open design question: which Membership fields are canonical base/override inputs and which should become derived projections?

## G. Invitation lifecycle

Recovered current defect class:

```text
Invitation
  -> create placeholder User
  -> create Membership
```

This collapses “a person/email has been invited” into “an authenticated local identity exists.” Later external-auth bootstrap can collide with that placeholder identity.

Working target:

```text
Invitation claim
  -> invite addressed to email / subject
  -> authenticated identity proves claim
  -> Membership established/activated
  -> intended scopes/tier/role preserved
```

Invitation authority exists before authenticated identity, but should not require a fake User.

Migration of existing placeholder invitation Users remains unresolved.

## H. JobRole / position

Recovered implementation finding: structure assignment could copy JobRole-derived permissions and approval tier into Membership.

Interpretation: Membership was serving as relationship + base authority + copied organizational-role projection.

Risk: copied values can become stale or destructive when role/position changes, explicit exceptions exist, or multiple roles overlap.

Working direction: effective authority should be derived through a resolver rather than treated as one copied flat scope list.

## I. Effective Authority Resolver

Working missing primitive:

```text
principal
  + business
  + Membership
  + base role
  + JobRole / position
  + explicit grants / overrides
  + explicit denials
  + delegations
  + approval tier
  + capability
  + resource/context
  + validity / revocation
  -> effective authority
```

This resolver should be explainable and produce traceable reasons, not only a boolean.

Candidate result shape:

```text
EffectiveAuthority {
  allowed
  effectiveRole
  permissions
  maxApprovalTier
  grantsUsed
  denialsApplied
  delegationsUsed
  constraints
  expiresAt
  ruleTrace
}
```

Shape is working, not frozen.

## J. Authority source algebra

The unresolved central problem is source precedence.

Potential sources:

- founding OWNER semantics
- Membership base role
- JobRole / OrgAssignment
- explicit permission overrides
- explicit denials
- AuthorityGrant
- temporary delegation
- approval-tier limits
- resource ownership/context
- capability-specific policy

Questions that must be answered:

1. Which sources may expand authority?
2. Which may only narrow authority?
3. Do explicit denials always dominate grants?
4. Can a JobRole expand beyond Membership base role?
5. Can a delegation exceed the delegator's grantable authority? Expected invariant: no.
6. How do multiple simultaneous positions compose?
7. How does expiry/revocation propagate to active approvals/clearances?
8. Which authority is evaluated at request, approval and execution time?

## K. AuthorityGrant

Recovered implementation concept already included grantor, grantee, scope, maxAmount and validity.

Recovered weakness classes:

- grantor provenance could be caller-supplied rather than authoritatively derived;
- runtime did not fully enforce bounds such as amount;
- relation to Membership/JobRole/delegation was not centrally resolved.

Working invariant:

> grant <= grantor's grantable authority

A grant should preserve:

- authoritative grantor principal
- grantee principal
- capability/scope
- resource/value bounds
- start/end validity
- revocation
- provenance/reason

## L. Explicit denial

Working direction: the authority algebra must model denial as a first-class input rather than trying to express all restrictions through missing grants.

Open: exact dominance rules for explicit deny vs ownership/admin role/emergency controls.

## M. Approval tier

Approval tier is not equivalent to general permission.

A human may have permission to request/perform a capability yet lack authority to approve a high-impact invocation. Conversely an approver may authorize another executor without personally being the execution principal.

This distinction feeds directly into J2 principal lineage and J15.

## N. Human authority vs KEY autonomy

Invariant:

> Human permission and KEY autonomy/delegation are different axes.

J25 owns human authority semantics. J2 combines that human authority result with KEY autonomy, readiness and policy to determine clearance.

## O. Control-plane mutation

Recovered concern: policy surfaces such as business autonomy profile could be protected only by broad business membership while materially changing KEY's future authority.

Working invariant:

> Authority to mutate the control plane must be at least as strong as the authority required for the behavior that control-plane mutation can enable.

## P. Business-definition authority

Recovered J1/J25 concern: ordinary business members could reach business-definition/Blueprint/Genesis/Genome write surfaces.

Working distinction:

- contributing information/signal
- proposing a business truth change
- authoritatively mutating canonical business knowledge

These should not automatically require the same authority.

## Q. Multi-business selection

Browser `kf_business_id` is working selection context, not proof of authorization.

Target relationship:

```text
authenticated human
  -> authorized Membership set
  -> active workspace selection
  -> request-bound business context
```

A mature multi-business selector should derive candidates from authorized relationships, not owner-only discovery.

## R. Lifecycle states

Working human-authority lifecycle:

```text
OUTSIDE_BUSINESS
  -> INVITED
  -> CLAIMABLE
  -> MEMBER
  -> ROLE_ASSIGNED
  -> EFFECTIVE_AUTHORITY_RESOLVED
  -> GRANTED / DELEGATED / RESTRICTED as changes occur
  -> SUSPENDED / REVOKED / EXPIRED
  -> REMOVED
```

Founders may enter through a direct founding-membership path rather than Invitation.

## S. Provenance requirements

Authority decisions should be explainable through provenance:

```text
principal
  -> Membership
  -> role/position assignments
  -> grants/delegations
  -> denials/constraints
  -> capability/resource context
  -> effective-authority result
```

Authority changes should produce audit/evidence suitable for later approval invalidation and incident analysis.

## T. Recovered implementation findings feeding J25

High-confidence historical findings/contradictions include:

- F003 ownerId and OWNER Membership dual authority
- F004 explicit createBusiness lacks OWNER Membership
- F006 discovery owner-based vs access Membership
- F020 business self-model mutation authority under-scoped
- F029 canonical proposal controller approval/execution under-authorized
- F036 AI approval resolver and proposal controller use different human authority semantics
- F038 plan approval only strongly enforces role for Tier 4
- C005 founding Membership discovery vs ownerId
- C006 founding Business+OWNER Membership invariant vs partial creation paths
- C012 Membership grants business-definition mutation despite differentiated roles
- C017 canonical approval claim vs multiple authority regimes
- C021 Membership has approval primitives but many approval surfaces do not consistently consume them

Later recovered issues without reliable historical finding numbers:

- invitation placeholder identity/email conflict
- JobRole authority copied into Membership
- autonomy-profile under-authorization

## U. Open questions

1. What is the canonical Membership-first migration plan for existing ownerId data?
2. Does `Business.ownerId` remain canonical ownership metadata, a derived compatibility field, or both?
3. What are the exact authority source precedence/composition rules?
4. How are explicit denials represented and resolved?
5. How do JobRole/OrgAssignment and Membership base role compose?
6. Which fields on Membership remain source-of-truth vs derived cache?
7. How are AuthorityGrant/delegation bounds enforced at runtime?
8. How are invitation placeholders migrated safely?
9. How does authority revocation invalidate approvals and active clearances?
10. How are capability permissions mapped from current coarse module scopes?
11. What authority is required to mutate business-definition truth?
12. What authority is required to change KEY autonomy/control-plane policy?

## V. Admission criteria for convergence

J25 is sufficiently stable to proceed toward J15 only when we can answer, in a single traceable model:

```text
Who is this principal?
Which business relationship grants context?
What is their base authority?
What organizational roles affect it?
What explicit grants/denials/delegations apply?
What capability/resource is being evaluated?
What approval tier applies?
What constraints/expiry/revocation apply?
Why is the final authority decision what it is?
```

Then feed that resolver contract into J1 founding authority and J2 governed action.
