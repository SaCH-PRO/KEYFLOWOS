# KeyFlowOS Finding Register — Current Supplement

Status: CANONICAL CONTINUATION OF `08-FINDING-REGISTER.md`

Purpose: preserve newly pooled findings without risking whole-file truncation of the large canonical register through connector replacement. This file is part of the canonical finding register until the next safe compaction/export pass.

Implementation baseline: `main@d7c5b86cfa276d75ffa42d5f1707c43704dc9f21`

Canonical sequence continues after F084.

---

## F085 — `team:write` can construct authority stronger than the caller through multiple paths

**Status:** VERIFIED CODE-LEVEL / SYSTEMIC AUTHORITY FINDING

Multiple authority constructors are guarded by coarse `team:write` without central grantability comparison:

- `inviteTeamMember()` can create ADMIN/STAFF Membership with caller-selected valid permission scopes and `maxApprovalTier` up to 4;
- Membership role mutation can promote a non-owner member to ADMIN;
- JobRole creation/update accepts arbitrary record-shaped permissions and integer approval tier;
- OrgAssignment can bind that role and copy its authority into Membership;
- DelegationRule can be created between active assignments without proving caller/delegator grantability.

The root defect is not that `team:write` is always wrong. It is that organizational management and authority minting/escalation are conflated.

Target law:

```text
requestedGrantedAuthority <= caller.grantableAuthority
OR
caller possesses an explicit, separately governed escalation/grant capability
```

External working-model property: Kubernetes RBAC separates ordinary role/binding management from explicit `escalate`/`bind` privileges and prevents a user from granting permissions they do not already possess unless separately authorized.

Affected kernels: K2, K3, K6.
Affected journeys: J1, J2, J15, J25.

---

## F086 — ending/deleting OrgAssignment does not revoke copied Membership authority

**Status:** VERIFIED CODE-LEVEL / AUTHORITY-LIFECYCLE FINDING

Assignment creation / JobRole changes copy:

```text
JobRole.permissions -> Membership.permissionScopes
JobRole.defaultApprovalTier -> Membership.maxApprovalTier
```

But setting `endedAt` or deleting the OrgAssignment does not recompute/clear those copied fields.

Therefore position-derived authority can survive after the organizational relationship that created it no longer exists.

This strengthens F044 and C023.

Target is not more ad-hoc synchronization callbacks. Effective authority should be resolved from authoritative live inputs; any retained projection/cache should be explicitly derived/versioned.

Affected kernels: K2, K6.
Affected journeys: J25, J15, J2.

---

## F087 — KEY Action approval can occur without the human viewing significant structured action data

**Status:** VERIFIED UX / CONTROL-EVIDENCE FINDING

The `/app/approvals` KEY Actions panel is a live AiApprovalItem consumer.

Its optional SideSheet exposes useful evidence including:

- rationale;
- expected benefit;
- risks;
- full `inputPayload`;
- `affectedEntities`.

However the user can press Approve directly from the list row without opening that detail. The final confirmation dialog restates only the title:

```text
You are about to approve "<title>". This will apply immediately.
```

Thus approval can be collected without acknowledgement of the material data that distinguishes one action from another.

Target: authorization-moment `ControlPresentation` derived from the exact ActionEnvelope, showing concise significant business data with expandable technical detail.

Affected kernels: K3, K5, K8.
Affected journeys: J15, J2.

---

## F088 — ApprovalRequest payload is available to the client but not rendered to the approver

**Status:** VERIFIED UX / CONTROL-EVIDENCE FINDING

The client `ApprovalRequest` type includes:

```text
payload?: Record<string, unknown> | null
```

but `/app/approvals/[id]` renders title/type/threshold/requester/description/steps and never renders `req.payload`.

Backend workflow/policy logic can inspect payload subject/amount-like data, while the human approval surface omits that same structured transaction data.

Affected kernels: K3, K8.
Affected journeys: J15 plus domain journeys using ApprovalRequest.

---

## F089 — AI Plan approval omits exact tool and parameter data already available to the browser

**Status:** VERIFIED UX / HIERARCHICAL-CLEARANCE FINDING

Browser `PlanStep` already includes:

- `toolName`;
- `inputPayload`;
- `riskTier`;
- `requiresApproval`;
- dependencies;
- expected benefit.

The `/app/plans/:planId` approval page shows human action/description and T3/T4 badges, but does not show `toolName` or `inputPayload` before the single-click `Approve & Execute` action.

Therefore current plan approval cannot establish strong hierarchical clearance over exact child capabilities/parameters.

Target: a bounded plan approval summary derived from exact child ActionEnvelopes, e.g. capability set, material amounts/recipients/external side effects and explicit exclusions, bound to a plan version/fingerprint.

Affected kernels: K3, K5, K7, K8.
Affected journeys: J15, J2, J23.

---

# Finding lifecycle corrections

## Invitation placeholder identity conclusion

Earlier historical interpretation:

```text
placeholder User
-> later external-auth userId
-> same-email collision
-> unavoidable account_email_conflict
```

Current status:

`NARROWED / PARTIALLY SUPERSEDED`

Current `bootstrapUser()` detects a verified-email local User with a different ID and invokes transactional `reconcileUserId()`, which creates the authenticated-ID User and re-points Membership and other references.

Remaining defects are:

- invitation is still premature User+Membership provisioning rather than a first-class claim;
- authority intent is not revalidated at claim time;
- bootstrap remains owner-first after reconciliation;
- invited-only user can receive a newly created owned workspace as the returned bootstrap Business;
- business discovery remains owner-based rather than Membership-first.

Do not repeat the old unconditional authentication-dead-end claim.

## F067 — Flow quick-confirm

Current lifecycle status:

`RE-ANALYZED / NARROWED`

The shipped `KeyPlanCard` displays the same action description/risk and expandable `step.arguments` that its Allow/Deny callback passes into confirmation. Flow also re-evaluates governance server-side.

Therefore there is no current evidence that the shipped client intentionally substitutes a different action after display.

The remaining defect is architectural binding:

> the server accepts reconstructed `toolName/toolArgs` in the confirmation request rather than consuming an immutable server-side pending ActionEnvelope by reference.

Preserve the current concise quick-confirm UX while strengthening the server contract.

---

# Pool impact

F085–F089 strengthen the current target stack:

```text
CapabilityContract
-> ActionEnvelope
-> EffectiveAuthority
-> ControlRequirement
-> ControlPresentation
-> specialized workflow/channel
-> typed ControlEvidence
-> Clearance
-> ExecutionClaim
-> ActionDispatcher
```

No production implementation is authorized by this supplement.
