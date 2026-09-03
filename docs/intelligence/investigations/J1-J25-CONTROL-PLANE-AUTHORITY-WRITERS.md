# J1/J25 — Control-Plane Authority Writer Graph

Status: ACTIVE FORENSICS / CROSS-JOURNEY POOL

Implementation baseline: `main@d7c5b86cfa276d75ffa42d5f1707c43704dc9f21`

Affected journeys:
- J1 Business Birth
- J2 KEY Request → Governed Action
- J15 Approval / Governance Lifecycle
- J25 Human Authority Lifecycle

Affected kernels:
- K1 Tenant Genesis & Identity
- K2 Human Authority & Organization
- K3 KEY Authority & Governance
- K6 State Transition

---

## 1. Adversarial correction — invitation identity collision is partially repaired

Earlier analysis concluded that invitation-created placeholder Users necessarily collide with a later Supabase-authenticated identity and end in `account_email_conflict`.

That conclusion is now **narrowed by current implementation evidence**.

Current `bootstrapUser()`:

```text
authenticated Supabase userId
→ no local User by that id
→ lookup local User by verified email
→ if a different local User exists
   → reconcileUserId(oldId, authenticatedId)
```

`reconcileUserId()` transactionally:

- parks the old email;
- creates the new User under the authenticated ID;
- re-points `Membership.userId`;
- re-points Session, AiExecutionLog, AiApprovalItem and AiPlan user references;
- re-points non-FK `Business.ownerId` and TeamActivityLog user IDs;
- deletes the old User.

Therefore the placeholder Membership can now survive the identity-ID reconciliation.

### Remaining semantic failure

After reconciliation, bootstrap searches only:

```text
Business where ownerId = authenticated user
```

If the person is only an invited member and owns no Business, bootstrap creates a **new owned Business**, upserts an OWNER Membership there, and returns that new Business.

The invited Membership still exists, but:

- bootstrap does not select it as the landing workspace;
- `listBusinesses()` remains owner-based in the current tenancy investigation;
- ordinary tenant discovery therefore remains semantically inconsistent with invitation membership.

### Revised conclusion

The current defect is no longer best described as:

> invitation placeholder User makes authentication impossible.

It is better described as:

> invitation is still modeled as premature User+Membership provisioning rather than a claim lifecycle, and authenticated bootstrap/discovery remains owner-first rather than invitation/Membership-aware.

The target `Invitation → authenticated claim → revalidate authority intent → Membership` remains architecturally preferable because it also solves authority freshness and avoids pre-auth principal fabrication, but current code has repaired one historical failure mode.

---

## 2. Authority writer graph

Current authority can be created/expanded through multiple surfaces:

```text
Identity inviteTeamMember
Identity updateMemberRole
Identity updateMemberPermissions
Structure create/update JobRole
Structure create/update OrgAssignment
Structure create/update DelegationRule
AI settings create/revoke AuthorityGrant
Cortex BusinessAutonomyProfile mutation
AiOversight AutopilotSettings mutation
```

These surfaces do not share one grantability resolver.

---

## F085 — `team:write` can construct authority stronger than the caller through multiple paths

**Status:** VERIFIED CODE-LEVEL / SYSTEMIC AUTHORITY FINDING

This is one root finding covering several authority constructors.

### Identity invitation

`POST .../team` requires `team:write`.

`IdentityService.assertTeamAdmin()` explicitly accepts a non-owner whose effective `team` scope is either `write` **or** `admin`.

`inviteTeamMember()` allows:

- role `ADMIN` or `STAFF`;
- caller-provided valid module scopes, including `admin` levels;
- caller-provided `maxApprovalTier` up to 4.

The payload is syntactically validated but not bounded by the inviter's own effective/grantable authority.

Thus a principal with only `team:write` can create a new Membership whose authority exceeds their own.

### Identity role mutation

`PATCH .../team/:membershipId` also requires `team:write` and calls the same `assertTeamAdmin()`.

It permits changing a non-owner Membership to `ADMIN` and writes the ADMIN default scopes/tier.

Again, no grantability comparison to the requester is performed.

### Structure role/assignment construction

All JobRole and OrgAssignment writes use `team:write`.

`CreateJobRoleDto` currently validates:

- `permissions` only as a record-shaped field without canonical permission-vocabulary validation;
- `defaultApprovalTier` only as an integer, with no observed 0–4 bound.

`createAssignment()` can then copy that JobRole's permissions and approval tier directly into a Membership.

### DelegationRule construction

DelegationRule writes also use `team:write`.

The service verifies the named delegator/delegate are active assignments in the business, which is a favorable tenant-integrity check.

But it does not prove:

- the caller is the named delegator;
- the caller may act for that delegator;
- the delegator actually possesses the delegated scope/tier;
- the caller may use an explicit privilege-escalation capability.

`maxTier` is only integer-validated in the create DTO, with no observed supported-range bound.

### Architectural conclusion

The problem is not that `team:write` is universally too weak. The problem is that the same coarse verb means both:

```text
manage team structure
```

and

```text
mint or bind materially stronger authority
```

without an explicit grantability check.

Target law:

```text
newAuthority ⊆ caller.grantableAuthority
OR caller possesses an explicit privileged grant/escalate capability
```

This strongly supports KF-REC-020, KF-REC-021, KF-REC-022 and KF-REC-031.

---

## External working-model cross-reference — Kubernetes RBAC

Current Kubernetes RBAC provides a strong transferable anti-escalation property:

- a user may create/update a Role only if they already possess all permissions in that Role, **or** possess an explicit `escalate` permission;
- a user may bind a Role only if they already possess the Role's permissions, **or** possess an explicit `bind` permission.

Transferability: **ADAPT**.

KeyFlowOS does not need Kubernetes' resource model, but the semantic split is valuable:

```text
MANAGE_AUTHORITY_OBJECTS
!=
GRANT_ARBITRARY_AUTHORITY
```

Candidate KeyFlow concepts could distinguish ordinary team/org editing from explicit grantability/escalation capabilities.

OWASP Authorization guidance also reinforces least privilege, deny-by-default and checking authorization for the exact requested operation/resource on every request.

---

## F086 — ending/deleting OrgAssignment does not revoke copied Membership authority

**Status:** VERIFIED CODE-LEVEL / AUTHORITY-LIFECYCLE FINDING

For membership-backed positions:

```text
assign JobRole
→ copy JobRole.permissions into Membership.permissionScopes
→ copy JobRole.defaultApprovalTier into Membership.maxApprovalTier
```

`updateAssignment()` repeats that copy when `jobRoleId` changes.

However:

- setting `endedAt` does not recompute/clear Membership authority;
- deleting an assignment does not recompute/clear Membership authority;
- changing/removing organizational position therefore can leave the prior copied scopes/tier on Membership.

This strengthens F044 and C023 with explicit lifecycle evidence.

### Architectural implication

The correct target is not “add more synchronization callbacks.”

It is:

> Resolve effective authority from authoritative live inputs at the decision boundary, and keep materialized projections explicitly derived/versioned if they are retained for performance/UI.

---

## F046 — AuthorityGrant re-analysis / strengthened

**Status:** EXISTING FINDING STRENGTHENED — DO NOT CREATE DUPLICATE ID

Current evidence adds:

- create/revoke routes require coarse `operations:write`;
- `CreateAuthorityGrantDto` requires a caller-provided `grantorId`;
- controller prefers `body.grantorId` over authenticated `req.user.id`;
- service persists that grantor without proving the named principal's grantability;
- scope is constrained to Tier-4 domains, but grant authority itself is not;
- `maxAmount` is stored but earlier runtime grant lookup did not enforce it;
- revoke is authorized by `operations:write`, not by grant provenance/effective revocation authority.

Therefore F046 remains the canonical root finding.

Target:

```text
server-derived acting principal
→ EffectiveAuthorityResolver.canDelegate/grant
→ requested grant scope/bounds ≤ grantable authority
→ explicit grant record with provenance/version
```

---

## 3. Authorization strength inconsistency

A useful current contrast:

```text
Direct Membership permission edit
→ requires team:admin

Promote Membership role to ADMIN
→ requires team:write

Create high-power JobRole
→ requires team:write

Bind JobRole to Membership
→ requires team:write

Create DelegationRule
→ requires team:write
```

This demonstrates that route-level module verbs are not a sufficient canonical authority algebra.

---

## C048 — direct authority editor vs alternate authority constructors

**Status:** VERIFIED ACTIVE CONTRADICTION

The direct Membership permission editor is treated as `team:admin`, while semantically equivalent or stronger authority can be constructed indirectly through `team:write` role promotion, JobRole assignment and delegation paths.

Target resolution requires capability-level grantability semantics rather than strengthening one route in isolation.

---

## 4. Kernel laws strengthened

### K1 Tenant / Identity

```text
pre-auth invitation intent should not be mistaken for a fully established authenticated principal
```

### K2 Human Authority

```text
manage organizational structure != authority to grant arbitrary privileges
```

```text
grantedAuthority ⊆ grantor.grantableAuthority
unless an explicit, separately governed escalation capability permits otherwise
```

```text
position removal must immediately cease position-derived authority
```

### K3 Governance

```text
control-plane capabilities need their own authority semantics; coarse module write access is insufficient
```

---

## 5. Target authority-writer architecture

Candidate shape:

```text
AUTHORITY MUTATION INTENT
  principal
  business
  mutation capability
  target principal/position
  grants/removals
  bounds
        ↓
Effective Authority Resolver
        ↓
canManageAuthorityObject?
canGrantRequestedAuthority?
canUseExplicitEscalationCapability?
        ↓
Control Requirement
        ↓
atomic authority transition
        ↓
authority version increments
        ↓
dependent stale authorization artifacts re-evaluated/invalidated as needed
```

This allows ordinary organizational editing to remain usable while protecting actual authority expansion.

---

## 6. Finding lifecycle correction to carry forward

Historical invitation-placeholder conclusion:

```text
placeholder User → unavoidable authenticated email conflict
```

Current status:

`NARROWED / PARTIALLY SUPERSEDED BY CURRENT RECONCILIATION IMPLEMENTATION`

Current remaining invitation findings:

- invitation is not yet a first-class claim object;
- authority intent is materialized before claim rather than revalidated at claim time;
- bootstrap remains owner-first;
- invited Membership does not become the returned/selected workspace;
- owner-based business discovery remains inconsistent with Membership-first target.

Do not repeat the old unconditional conflict claim in future architecture work.

---

## 7. Next loop

Move to J15 frontend/control evidence:

1. KeyActionProposal approval surfaces;
2. AiApprovalItem surfaces;
3. plan approval UI;
4. quick-confirm cards;
5. exact significant parameters/affected entities presented to approver;
6. stale-tab/version behavior;
7. whether UI identity matches server-consumed action identity.

Then cross-reference against the server-side ActionEnvelope/ControlEvidence target and OWASP transaction-authorization properties.

Production implementation remains unauthorized.
