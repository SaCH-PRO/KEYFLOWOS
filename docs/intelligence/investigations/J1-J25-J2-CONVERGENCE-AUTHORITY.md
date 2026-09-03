# J1 ↔ J25 ↔ J2 Convergence — Effective Human Authority

Status: ACTIVE CONVERGENCE / CANDIDATE ALGEBRA

Implementation evidence baseline: `main` at `e1203b34d0b3091a73657dc358508d7a14109575`.

Scope: establish one explainable model for human authority that can feed Business Birth (J1), Human Authority Lifecycle (J25), and Governed Action (J2) without prematurely opening J15.

No production-code changes are authorized by this document.

---

## 1. Question being solved

KeyFlowOS needs one answer to:

> What may this authenticated principal legitimately do in this business, for this exact capability/resource, right now, and why?

The current implementation has several authority-related mechanisms, but they do not form one central algebra.

---

## 2. Current implementation evidence revalidated

### 2.1 Membership is both relationship and authority carrier

`IdentityService` and `ModuleScopeGuard` use Membership as the business relationship required for scoped module authorization.

Membership currently carries or resolves:

- `role`
- `permissionScopes`
- `maxApprovalTier`

`IdentityService` supplies default module scopes and default approval tiers by role when explicit Membership values are absent.

Interpretation: Membership is not merely tenant membership in current code; it is also a material authority envelope/cache.

### 2.2 ModuleScopeGuard evaluates only coarse Membership module scopes

`apps/server/src/core/auth/module-scope.guard.ts`:

- requires a Membership for non-super-admin users;
- reads `membership.permissionScopes` or role defaults;
- evaluates module-level `none | read | write | admin` hierarchy;
- has no dynamic JobRole/OrgAssignment, AuthorityGrant, DelegationRule, explicit-denial, capability-contract or resource-policy composition.

Interpretation: it is a useful coarse access guard, not a complete effective-authority resolver.

### 2.3 JobRole authority is materialized into Membership

`StructureService.createAssignment()` currently treats JobRole as a source of permission and approval authority and writes JobRole-derived values into the Membership:

```text
permissionScopes <- jobRole.permissions
maxApprovalTier <- jobRole.defaultApprovalTier
```

The service contains explicit security commentary and tenant-reference validation around this write because a caller-supplied Membership + JobRole combination had created cross-tenant privilege-escalation risk before the references were scoped.

Interpretation:

- JobRole is semantically an authority source.
- Current implementation flattens that source into Membership instead of resolving it dynamically.
- Provenance is therefore lost: after the copy, downstream guards cannot distinguish base Membership authority from JobRole-derived authority.
- Role changes can destructively overwrite prior explicit Membership settings.

### 2.4 Approval routing has its own authority logic

`ApprovalRoutingService.resolveApprover()` currently selects an approver using:

```text
active DelegationRule matching module/tier
  -> active OrgAssignment / delegate
else qualifying JobRole.defaultApprovalTier
  -> active OrgAssignment
else OWNER Membership fallback
else unresolved
```

This answers **who should receive an approval request**.

It does not centrally prove that the selected human's full effective permission set permits approval of the exact capability/resource. It also does not compose Membership `permissionScopes`, explicit denies, AuthorityGrant or capability-contract permission identity.

Interpretation: approval routing is a routing mechanism, not a general authority resolver.

### 2.5 DelegationRule is approval-routing delegation, not universal authority transfer

Current `CreateDelegationRuleDto` contains:

- `delegatorId`
- `delegateId`
- `scope`
- `maxTier`
- optional expiry/reason

Current approval routing consumes these rules to choose the approver assignment.

Interpretation: DelegationRule presently represents bounded approval-routing delegation through OrgAssignments. It should not automatically be interpreted as permission to execute arbitrary capabilities.

### 2.6 AuthorityGrant exists but is incomplete as a human-authority primitive

Current `AiSettingsService.createAuthorityGrant()` persists:

- business
- grantorId
- grantee type (`KEY | USER`)
- granteeId
- coarse tier-4 scope
- optional `maxAmount`
- validity window
- revocation

Current controller permits `body.grantorId` to override the authenticated request user's ID, falling back to the request user only when the body omits it.

Current `AuthorityGrantRuleService` checks KEY grants by:

- business
- grantee `KEY/key_ai`
- inferred coarse scope
- validity/revocation

but does not enforce `maxAmount` or exact Capability Contract identity.

Interpretation:

- the model shape is reusable;
- authoritative grantor provenance is not yet guaranteed;
- grantor's right to grant is not centrally validated;
- current runtime consumption is narrower than the stored model suggests;
- `maxAmount` is not a complete runtime bound in the inspected KEY grant path.

### 2.7 Capability Contract defines a finer authority vocabulary than current guards consume

`CapabilityContractService` assigns each action a stable permission string:

```text
<ownerModule>.<family>.<capabilityName>
```

Example shape:

```text
money.execute.payments_refund_charge
```

It also owns capability name/version, risk tier, approval requirement, execution mode, idempotency and changed entities.

Current `ModuleScopeGuard` evaluates coarse module keys such as:

```text
crm
revenue
bookings
projects
content
expenses
automations
storefront
settings
ai
team
operations
```

No load-bearing mapping between the coarse Membership scope vocabulary and fine-grained Capability Contract permission vocabulary was found in this pass.

Interpretation: the architecture has a strong capability identity seam and a separate coarse human-permission seam, but no canonical bridge yet.

### 2.8 Explicit-denial mechanism not found in inspected authority paths

Search and inspection of Membership scopes, Structure/JobRole, DelegationRule, AuthorityGrant and approval routing did not reveal a first-class explicit-denial object participating in authority resolution.

This is a scoped finding, not proof that no denial concept exists anywhere in the repository.

Interpretation: the target algebra should reserve an explicit-denial layer even if current implementation does not yet model one coherently.

---

## 3. Refined concept boundaries

The previous model was too close to treating all authority-related state as one flat permission set.

The stronger distinction is:

### Tenant relationship

```text
Membership
  = this authenticated human belongs to this Business
```

### Default authority

```text
Membership role/defaults
  = baseline grants and approval defaults
```

### Organizational authority

```text
active JobRole / OrgAssignment
  = authority associated with the position(s) currently occupied
```

### Explicit authority changes

```text
AuthorityGrant / future explicit override
  = deliberately added bounded authority
```

### Explicit restrictions

```text
ExplicitDeny / policy constraint
  = deliberately removed or constrained authority
```

### Delegation

```text
Delegation
  = temporary bounded transfer/routing of authority already possessed by another principal
```

### Capability requirement

```text
CapabilityContract
  = exact action identity and permission/risk requirements
```

### Effective authority

```text
EffectiveAuthorityResolver
  = deterministic composition of the above for one principal + capability + resource/context + time
```

---

## 4. Candidate authority algebra

Status: WORKING DIRECTION — NOT FROZEN.

### 4.1 Phase 0 — principal and tenant proof

For normal tenant principals:

```text
authenticated principal
  + active Membership(principal, business)
  -> tenant context established
```

`SUPER_ADMIN`/platform principals should be modeled as a separate platform authority class rather than silently pretending to be tenant Memberships.

If tenant Membership is absent, tenant authority fails regardless of browser-selected business ID.

### 4.2 Phase 1 — collect positive grant sources

Build a set of candidate grants from active, valid sources:

```text
Gbase      = grants implied by Membership role/default authority
Gposition  = grants from active JobRole/OrgAssignment positions
Gexplicit  = explicit bounded grants/overrides
Gdelegate  = valid delegated grants that the delegator is itself allowed to delegate

Gcandidate = Gbase ∪ Gposition ∪ Gexplicit ∪ Gdelegate
```

Important refinement: JobRole and explicit grants may legitimately expand beyond Membership role defaults. Membership role should therefore not be treated as a universal hard ceiling on ordinary business capability authority.

However, expansion is bounded by non-delegable platform/business invariants and by the authority of the granting principal.

### 4.3 Phase 2 — grantability proof

Every expanding grant/delegation must satisfy:

```text
grantedAuthority ⊆ grantor.grantableAuthority
```

A principal cannot manufacture authority they do not possess or are not permitted to delegate.

For a delegation:

```text
delegated capability/resource/tier/value bounds
  ⊆ delegator effective authority
  ∩ delegator delegable authority
```

### 4.4 Phase 3 — apply explicit denies and constraints

Candidate rule:

```text
GafterDenial = Gcandidate - Gdeny
```

Explicit deny should normally dominate additive grants because otherwise a later broad role/grant can silently re-enable something deliberately prohibited.

Exceptions, if any, must be explicit platform-level emergency/break-glass semantics rather than accidental role precedence.

Then apply contextual constraints:

```text
Gcontext = GafterDenial
  ∩ resource constraints
  ∩ amount/value constraints
  ∩ time validity
  ∩ business lifecycle constraints
  ∩ legal/compliance constraints
  ∩ capability policy
```

### 4.5 Phase 4 — capability permission resolution

The resolver should consume the exact `CapabilityContract.permission`, not infer authorization solely from action labels or module routes.

A compatibility bridge may translate current coarse module scopes into capability families during migration, but the target decision should be capability-specific.

Example transitional mapping concept:

```text
Membership scope: revenue=write
  -> compatibility grant family
     money.{draft|crud|organize}.*

Membership scope: revenue=admin
  -> broader compatibility family
     money.*
```

The exact mapping is unresolved and must be explicitly reviewed; it must not be generated silently from string prefixes at execution time.

### 4.6 Phase 5 — approval authority

Permission to request/execute and permission to approve are distinct outputs.

For an invocation with risk/approval tier `T`:

```text
canRequest(capability)
canExecute(capability)
canApprove(capability, invocation) AND effectiveApprovalTier >= T
```

`effectiveApprovalTier` should come from the highest currently valid positive authority source that legitimately grants approval for that scope, after denials/constraints, rather than from an opaque copied integer alone.

A JobRole `defaultApprovalTier`, explicit grant, bounded delegation or OWNER default may contribute.

### 4.7 Phase 6 — protected/non-delegable capabilities

Some capabilities should have platform/business invariants independent of ordinary additive grants, for example candidate classes such as:

- transfer/change ultimate business ownership;
- remove founding/ultimate owner;
- modify authority system roots;
- disable critical audit/safety controls;
- expand one's own grantable authority.

These are candidate protected classes, not yet accepted capability policy.

The key rule is that ordinary JobRole or delegation data must not accidentally grant them.

---

## 5. Candidate resolver result

```text
EffectiveAuthorityResult {
  principal
  businessId
  membershipId
  capability: {
    name
    version
    permission
    riskTier
  }

  tenantRelationship: ALLOWED | DENIED

  request: ALLOW | DENY
  execute: ALLOW | DENY
  approve: ALLOW | DENY
  delegate: ALLOW | DENY

  effectiveApprovalTier

  grantsApplied[]
  positionsApplied[]
  delegationsApplied[]
  denialsApplied[]
  constraintsApplied[]

  resourceBounds
  valueBounds
  validUntil

  authorityVersion
  ruleTrace[]
}
```

The resolver must return explainable provenance, not just a boolean.

`authorityVersion` (or equivalent stable fingerprint/version) is important because J2 approval/clearance must be invalidated when authority materially changes.

---

## 6. Worked scenarios

### Scenario A — founder/owner immediately after Business Birth

Required semantic state:

```text
Business.ownerId = U
Membership(U,Business,OWNER)
```

Resolver result should establish tenant membership and owner defaults without requiring JobRole assignment.

J1 implication: founding Business creation is incomplete if the owner cannot be resolved through the same Membership-based authority path used by downstream scoped features.

### Scenario B — STAFF assigned Finance Manager position

Inputs:

```text
Membership role = STAFF
JobRole = Finance Manager
JobRole grants finance/revenue write + approval tier 2
```

Target result:

- STAFF defaults remain a baseline, not a hard universal ceiling.
- active Finance Manager position may expand finance capabilities if the assignment was made by a principal allowed to grant that authority.
- unrelated capabilities remain at STAFF/default level.

This avoids forcing every meaningful organizational position to become ADMIN while still preventing arbitrary self-escalation.

### Scenario C — explicit denial on refunds

Inputs:

```text
ADMIN defaults permit broad money actions
ExplicitDeny: payments_refund_charge
```

Target result:

```text
money execute broadly allowed
BUT payments_refund_charge denied
```

A later JobRole or broad module grant must not silently restore the denied refund capability unless the denial is explicitly removed/superseded by an authorized control-plane operation.

### Scenario D — temporary approval delegation

CFO has tier-3 approval authority for finance.
CFO delegates finance approvals up to tier 2 to Operations Manager for 7 days.

Target result:

- delegate may approve finance tier <=2 during validity window;
- delegate does not automatically gain execution authority for finance tools;
- delegation cannot exceed CFO's own delegable authority;
- expiry removes the delegated authority and should invalidate unconsumed clearance if the clearance depended on it.

### Scenario E — KEY AuthorityGrant with maxAmount

A valid KEY financial grant has `maxAmount=5000`.

Target result:

- grant is insufficient for a 7000 financial action;
- exact capability identity and action amount must be part of evaluation;
- coarse `tier4_financial` existence alone is not enough.

Current inspected `AuthorityGrantRuleService` does not enforce this bound, so this remains a target-state requirement.

---

## 7. New current findings from this pass

These are new findings created after historical recovery and may be assigned current IDs beginning after F043.

### F044 — JobRole authority is destructively materialized into Membership

**Status:** CURRENTLY REVALIDATED / ACTIVE

Evidence: `StructureService.createAssignment()` writes JobRole permissions and default approval tier into Membership.

Interpretation: authority provenance is flattened and role changes can overwrite other authority configuration.

### F045 — ApprovalRoutingService resolves approver routing, not complete effective authority

**Status:** CURRENTLY REVALIDATED / ACTIVE

Evidence: delegation rule -> JobRole approval tier -> OWNER fallback routing does not centrally compose Membership permissions, explicit denies, exact capability permission or AuthorityGrant.

Interpretation: approval routing must consume effective-authority results rather than substitute for them.

### F046 — AuthorityGrant provenance/bounds are not yet authoritative end-to-end

**Status:** CURRENTLY REVALIDATED / ACTIVE

Evidence:

- create route allows body-supplied `grantorId` to override request principal;
- service stores `maxAmount` but inspected KEY rule checks grant existence/scope/validity, not amount;
- exact Capability Contract identity is not used in the inspected rule.

Interpretation: retain the model seam but strengthen grant provenance, grantability and runtime bounds.

### F047 — Capability permission vocabulary and human module scopes are disconnected

**Status:** CURRENTLY REVALIDATED / ACTIVE

Evidence: Capability Contract emits fine-grained permission identities while ModuleScopeGuard evaluates coarse module-level scopes.

Interpretation: J25/J2 need an explicit compatibility/migration mapping and eventual capability-specific human authority evaluation.

### F048 — No first-class explicit-denial layer found in inspected authority paths

**Status:** PROVISIONAL / SEARCH-SCOPED

Interpretation: target algebra should model explicit deny; repository-wide proof remains pending.

### F049 — No central Effective Authority Resolver found in current inspected paths

**Status:** CURRENTLY REVALIDATED / ACTIVE

Evidence: tenant access, module scopes, role copying, approval routing, delegation and KEY AuthorityGrant checks are implemented by separate services/guards with different semantics.

Interpretation: a central resolver is a missing convergence primitive, not merely a refactor convenience.

---

## 8. New contradiction candidates

### C022 — coarse module scope vs fine-grained capability permission

Two permission vocabularies currently coexist without a canonical load-bearing mapping.

### C023 — dynamic organizational authority vs copied Membership authority

JobRole/OrgAssignment is conceptually dynamic organizational state, while current assignment flow materializes its permissions/tier into Membership.

### C024 — approver routing vs approver authority

ApprovalRoutingService can identify a delegate/position/owner, but routing identity and proof that the exact principal may approve the exact action are different questions.

---

## 9. Directional convergence result

Axis B is now:

`DIRECTIONALLY CONVERGED / NOT FROZEN`

High-confidence direction:

```text
Membership
  = canonical tenant relationship + baseline authority defaults

JobRole/OrgAssignment
  = dynamic organizational grant source

Explicit grants
  = bounded additive authority with authoritative grantor provenance

Explicit denials
  = first-class narrowing authority; normally dominate additive grants

Delegation
  = temporary bounded subset transfer/routing; never creates authority from nothing

CapabilityContract
  = exact action permission/risk identity

EffectiveAuthorityResolver
  = one explainable composition point
```

Unresolved before freezing:

1. exact compatibility mapping from existing module scopes to capability permissions;
2. exact model/storage for explicit denials/overrides;
3. which capability classes are non-delegable/owner-only;
4. multiple simultaneous JobRole composition rules;
5. authority fingerprint/version format used by approval/clearance invalidation;
6. migration semantics for existing Membership values that already contain copied JobRole permissions;
7. whether `AuthorityGrant` should be generalized into the human capability-grant primitive or remain a narrower governance object.

---

## 10. Feed-back into J1

Business Birth should establish:

```text
Business
  + founding OWNER Membership
  + baseline owner authority resolvable by EffectiveAuthorityResolver
```

The founder should not require a synthetic JobRole merely to receive the founding authority envelope.

`Business.ownerId` may remain distinguished ownership identity, but ordinary tenant authorization should resolve through Membership.

---

## 11. Feed-forward into J2

Governed Action should not ask several guards/services independently whether an action is allowed.

Target sequence becomes:

```text
exact Capability Contract
  -> human EffectiveAuthorityResult
  -> KEY autonomy/delegation result (if KEY involved)
  -> readiness/policy/context
  -> approval/control requirement
  -> exact-action clearance
  -> execution claim
```

J2 must bind any approval/clearance to an authority version/fingerprint so later revocation, role change, denial or delegation expiry can invalidate unconsumed authority.

---

## 12. Next analytical step

Proceed to Axis C: clearance + action fingerprint + execution claim + canonical post-clearance dispatcher.

During Axis C, feed back any requirements that change the authority result shape, especially:

- what authority state must be snapshotted vs re-evaluated at execution;
- which authority changes invalidate prior approval;
- how principal lineage is preserved;
- how approval hierarchy and plan-child authorization consume the authority result.
