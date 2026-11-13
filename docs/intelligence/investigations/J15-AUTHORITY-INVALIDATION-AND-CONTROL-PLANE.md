# J15 — Authority Invalidation & Control-Plane Forensics

Status: ACTIVE FORENSICS / POOLED KERNEL INPUT

Implementation baseline: `main@d7c5b86cfa276d75ffa42d5f1707c43704dc9f21`

Affected journeys:

- J2 — KEY Request → Governed Action
- J6 — Proactive KEY / Autonomy
- J15 — Approval / Governance Lifecycle
- J23 — Temporal Flow / Long-Running Workflow
- J25 — Human Authority Lifecycle

Affected kernels:

- K2 Human Authority & Organization
- K3 KEY Authority & Governance
- K5 Capability Fabric
- K6 State Transition
- K7 Temporal / Event / Workflow
- K8 Evidence & Outcome
- K11 Recovery & Reliability

---

## 1. Invalidation question

The governing question is not merely whether an approval table has an expiry column.

It is:

> If authority, delegation, policy, readiness or action identity materially changes after control evidence is produced, what prevents stale evidence from authorizing a later action?

Target causal requirement:

```text
ControlEvidence
  binds actionFingerprint
  + satisfiedBy principal
  + authorityVersion
  + policyVersion
  + validity window

material change
  -> evidence invalid / re-evaluation required
```

---

## F081 — Approved KeyActionProposal has no observed expiry or human-authority version binding

**Status:** VERIFIED CODE-LEVEL / DATA-CONTRACT FINDING

`KeyActionProposalData` exposes:

- `approvedBy`
- `approvedAt`
- status
- action/payload fields
- execution metadata

but no observed:

- `expiresAt` for approval;
- `authorityVersion`;
- `policyVersion`;
- `actionFingerprint`;
- explicit `invalidatedAt` / invalidation reason.

`KeyActionProposalService.execute()` requires only that the proposal is currently `APPROVED`, then re-evaluates KEY autonomy and Genome policy before execution.

It does **not** re-prove that `approvedBy` still possesses the authority that originally satisfied the human control, nor compare against a captured human-authority version.

Therefore an approval can outlive a later human-authority reduction unless another path manually cancels/blocks it.

### Important nuance

Execution-time KEY autonomy/readiness re-evaluation is favorable and should be preserved, but it is not equivalent to human approval freshness because the two authority axes are distinct.

### Target implication

Human control evidence should carry sufficient authority provenance/version to determine whether it remains valid at clearance time.

---

## F082 — DelegationRule expiry/revocation does not invalidate or re-route an already-routed AiApprovalItem

**Status:** VERIFIED CODE-LEVEL FINDING

`ApprovalRoutingService.resolveApprover()` correctly applies current DelegationRule bounds when it first routes an approval:

```text
isActive = true
activeFrom <= now
activeUntil null or >= now
maxTier >= requested tier
scope match
```

It persists only the resulting routing state onto the `AiApprovalItem`:

```text
approverAssignmentId
approverMethod
```

Later, `resolveApprovalByAssignment()` verifies:

- item remains pending;
- persisted `approverAssignmentId` equals caller assignment;
- assignment remains active;
- `autoApprovalViaReply` remains enabled;
- current JobRole approval tier remains sufficient.

It does **not** re-evaluate whether the DelegationRule that originally produced that route is still active/unexpired.

Thus:

```text
DelegationRule valid at routing
→ AiApprovalItem routed to assignment A
→ DelegationRule expires / disabled / deleted
→ assignment A remains active and tier-qualified
→ pending item can still be approved by A
```

### Architectural implication

Routing preference and authority provenance must remain distinguishable.

If a control decision depends materially on delegated authority, the evidence/clearance evaluator needs the grant/delegation provenance and its validity, not merely the persisted recipient of an old routing calculation.

---

## Favorable current behavior — AuthorityGrant validity is checked at lookup time

Both inspected AuthorityGrant consumers apply:

- business binding;
- grantee identity;
- scope;
- `revokedAt = null`;
- `validFrom <= now`;
- `validUntil` absent or current.

This is a good freshness property **for direct grant lookup**.

However, it does not solve downstream authorization invalidation because current approval/clearance-like artifacts do not carry grant provenance/version.

F046 remains the broader finding that AuthorityGrant grantability/provenance and stored bounds are incomplete end-to-end.

---

## Latent ApprovalRequest concern — not promoted to a production finding yet

`ApprovalRequestService.checkApprovalStatus()` can identify a historical approved request matching generic payload subject keys without expiry/fingerprint semantics.

Repository search in this pass found no current in-process consumer of that helper outside the service itself.

Classification:

`LATENT / REACHABILITY NOT PROVEN`

Do not treat it as a live bypass until a consumer is identified.

---

# 2. Control-plane mutation

A control-plane mutation is more sensitive than an ordinary business-state mutation when it can change what KEY or another principal may do later.

Candidate law:

> Authority to mutate a policy must be at least as strong as the authority that policy can grant or remove.

---

## F083 — BusinessAutonomyProfile hard-safety mutation is protected only by Business access

**Status:** VERIFIED CODE-LEVEL AUTHORITY FINDING

`KeyCortexController` is class-guarded by:

```text
AuthGuard + BusinessGuard
```

The `PATCH /api/v1/cortex/autonomy-profile` route has no observed `ModuleScopeGuard`/capability-level authority requirement.

It calls `KeyAutonomySafetyService.updateProfile()` directly.

The service performs no actor authorization.

The profile controls:

- `globalKillSwitch`;
- `maxDailyAutoActions`;
- `maxDailySpendTtd`;
- `maxTierWithoutApproval`;
- notification behavior.

`UpdateAutonomyProfileDto` validates numeric type for action/spend/tier settings but has no observed range constraints.

Therefore a principal with ordinary BusinessGuard-level access may reach a mutation whose purpose is to set hard future KEY-autonomy limits.

### Architectural implication

Control-plane policy mutation should be expressed as explicit capabilities and evaluated through Effective Human Authority.

For selected changes, especially increasing autonomy or spend/tier ceilings, the required human authority should be at least as strong as the behavior being enabled and may itself require stronger control/step-up.

---

## Contrast — AiOversight autonomy settings have stronger human checks

`AiOversightService.updateAutonomySettings()` behaves differently when a `userId` is supplied:

- loads User and Membership;
- accepts SUPER_ADMIN, OWNER or ADMIN;
- rejects other roles;
- fails closed if current governance settings cannot be read safely;
- clamps `maxAutoTier` into the supported 1–4 range.

This is a favorable improvement relative to the hard-profile route, but it creates another governance-regime contradiction: two related control planes use different authority models.

Internal callers can omit `userId`, which is relevant to F084 below.

---

## F084 — approval-history learning can automatically increase standing KEY maxAutoTier

**Status:** VERIFIED CODE-LEVEL / ARCHITECTURAL FINDING

`DelegationLoopService` contains governance adaptation logic that computes approval history.

When:

```text
approvalRate >= 0.90
and total approvals >= 15
```

it resolves the loop tool's current tier and, if that tier exceeds the current `maxAutoTier` but is `<= 2`, calls:

```text
AiOversightService.updateAutonomySettings(
  businessId,
  { maxAutoTier: currentToolTier }
)
```

without a `userId`.

The human OWNER/ADMIN check in `updateAutonomySettings()` is conditional on `userId`, so this internal adaptive path can raise standing autonomous tier without a contemporaneous authorized-human policy transition.

The increase is currently bounded to tool tiers <= 2, which limits severity but does not change the architectural principle.

### Architectural interpretation

Historical human approvals are evidence about preference/tolerance.

They are not themselves a fresh grant of standing authority.

Target distinction:

```text
learning signal
  -> policy recommendation / confidence

!=

standing authority mutation
```

A system may safely learn that an owner is likely to approve a class of actions and suggest reducing friction. The actual grant of future autonomous authority should cross a separately authorized policy/control-plane transition.

### Candidate ratchet

```text
KEY observes high approval rate
→ proposes autonomy-policy change
→ explains evidence + bounded scope + expected friction reduction
→ authorized human accepts/rejects
→ new authority/policy version
→ future actions consume new version
```

This preserves learning and innovation without allowing successful history to become self-granted authority.

---

# 3. External research cross-reference

Research date: 2026-09-03.

## OWASP LLM06:2025 — Excessive Agency

Current OWASP GenAI guidance identifies excessive functionality, permissions and autonomy as roots of agentic risk.

Applicable properties:

- minimize available functions and permissions;
- execute actions in the user's authorization context;
- require human approval for high-impact actions;
- use complete mediation: downstream systems should validate authorization rather than relying on the LLM/agent to decide whether an action is allowed.

Transferability: **ADOPT AS SECURITY FLOOR**.

KeyFlow implication:

KEY learning/adaptation may inform policy, but standing authority must remain externally bounded and enforced at deterministic decision/execution boundaries.

## OWASP Agent Control Standard (ACS)

Current OWASP ACS emphasizes inspectable, traceable agents and runtime-enforceable safety policies through control hooks.

Transferability: **RESEARCH / ADAPT**.

KeyFlow implication:

The evolving Capability → Authority → ControlEvidence → Clearance → Claim architecture is compatible with a runtime-control model. Do not make policy changes implicit inside opaque AI learning.

---

# 4. New contradiction candidates

## C044 — historical human approval vs standing autonomous authority

A high historical approval rate is evidence of likely preference, while current adaptive code can turn it directly into higher standing `maxAutoTier`.

## C045 — temporal delegation authority vs persisted approval routing

DelegationRule is time/revocation-bounded, while an AiApprovalItem route derived from it remains valid until independently resolved even after the rule ceases to be valid.

## C046 — hard autonomy policy importance vs BusinessGuard-only mutation

BusinessAutonomyProfile is described/enforced as a hard safety ceiling, while its mutation endpoint uses only broad Business access.

## C047 — approval timestamp vs durable approval validity

KeyActionProposal records when/who approved, but has no observed authority/policy version or expiry semantics capable of determining whether that approval remains valid later.

---

# 5. Kernel laws strengthened

## K2 Human Authority

```text
authority provenance must be versionable/freshness-aware when used as control evidence
```

## K3 KEY Governance

```text
learning cannot silently grant standing authority
```

and:

```text
control-plane mutation authority >= authority enabled by the mutation
```

## K6 State Transition

```text
policy/authority change is a first-class transition capable of invalidating dependent authorization artifacts
```

## K8 Evidence

```text
approval evidence must record the authority/policy basis under which it was satisfied
```

## K11 Recovery/Reliability

```text
revocation/invalidation must be consumable by later stages; merely updating the source grant is insufficient if stale downstream artifacts remain executable
```

---

# 6. Target invalidation model

Candidate target:

```text
EffectiveAuthorityResult
  authorityVersion / fingerprint
  provenance[]
  validUntil?

PolicyDecision
  policyVersion

ActionEnvelope
  actionFingerprint

ControlEvidence
  actionFingerprint
  satisfiedBy
  authorityVersion
  policyVersion
  expiresAt?
  invalidatedAt?
  invalidationReason?

Clearance
  actionFingerprint
  authorityVersion
  policyVersion
  expiresAt
  status
```

At clearance consumption:

```text
exact action unchanged
AND required evidence valid
AND authority version acceptable
AND delegated/granted provenance still valid
AND policy version acceptable
AND clearance unexpired/unrevoked
→ eligible for atomic ExecutionClaim
```

Not every authority change must invalidate every approval. The resolver should determine whether the changed source was material to that authorization.

---

# 7. Next loops

1. control-plane writers: JobRole, OrgAssignment, DelegationRule, AuthorityGrant and governance settings — exact grantability/self-escalation analysis;
2. frontend approval evidence: what significant action data is actually presented;
3. stale-tab / version semantics;
4. recommendation pool update;
5. backward replay through J25 and J2;
6. prepare J6 admission as a stress test only after current governance semantics are sufficiently coherent.

Production implementation remains unauthorized.
