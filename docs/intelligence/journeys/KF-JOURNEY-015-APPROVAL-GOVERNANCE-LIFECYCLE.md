# KF-JOURNEY-015 — Approval / Governance Lifecycle

Status: **L4 SEMANTICALLY RECONCILED / ENTERING L5 VALUE-ENGINEERED**

Implementation evidence baseline: `main@d7c5b86cfa276d75ffa42d5f1707c43704dc9f21`.

Production implementation remains unauthorized.

J15 is no longer in initial scoping. The current approval/governance regimes, human-control surfaces, authority writers, capability/risk binding, invalidation gaps, concurrency boundaries and execution handoff have been mapped deeply enough that the shared semantics are now stable enough to be stress-tested by J6 Proactive KEY / Autonomy.

J15 remains open. J6 may invalidate or refine it.

Detailed evidence lives in:

- `investigations/J15-APPROVAL-EVIDENCE-AND-INVALIDATION.md`
- `investigations/J15-APPROVAL-REGIME-CONVERGENCE.md`
- `investigations/J15-CAPABILITY-PLAN-AND-REPLY-BINDING.md`
- `investigations/J15-AUTHORITY-INVALIDATION-AND-CONTROL-PLANE.md`
- `investigations/J1-J25-CONTROL-PLANE-AUTHORITY-WRITERS.md`
- `investigations/J15-FRONTEND-CONTROL-EVIDENCE.md`

---

## A. Definition

J15 models how KeyFlowOS determines:

1. the exact action being governed;
2. what control that invocation requires;
3. who may satisfy the control;
4. what durable evidence proves satisfaction;
5. what changes invalidate that evidence;
6. how valid evidence becomes exact-action Clearance;
7. how Clearance admits one atomic ExecutionClaim.

Core distinction:

```text
APPROVED != CLEARANCE_GRANTED
```

Approval is one possible evidence source. Clearance is the complete current authorization result for the exact action.

---

## B. Product Intent

Governance must be strong without making routine business operation hostile.

Target user experience:

```text
KEY proposes/prepares an action
→ KeyFlow understands the exact business consequence
→ proportionate control is selected
→ the right person sees the significant action data
→ their decision is bound to exactly what they saw
→ changed actions visibly invalidate/reopen control
→ once fully cleared, the action executes once
→ outcome evidence closes the loop
```

The architecture should enable lower friction, not simply add more approval dialogs.

---

## C. Actors / Principal Classes

Current working classes:

- authenticated human principal = User + active Membership;
- position-bound external human principal = active OrgAssignment + contact/channel identity + JobRole authority;
- requesting human;
- proposing KEY/AI principal;
- routed approver;
- effective authorized approver;
- business owner/admin;
- explicit/delegated grantor/delegate;
- KEY autonomous executor;
- queue/system claimant executor;
- external provider.

Principal lineage must remain distinct:

```text
requestedBy
proposedBy
approvedBy / controlSatisfiedBy
executedFor
claimantExecutor
executedBy
delegated/grant provenance
```

---

## D. Current Entry Surfaces

Material current regimes traced:

1. `KeyActionProposal` create/approve/reject/execute;
2. `AiApprovalItem` queue/resolution/timeout/routing;
3. `ApprovalRequest + ApprovalStep` multi-step human workflow;
4. AI plan-level approval;
5. plan-step governance / proposal generation;
6. `AiOversightService` control decisions;
7. `AutonomyOrchestratorService` proposal execution evaluation;
8. `ApprovalRoutingService + DelegationRule`;
9. Membership approval tier;
10. JobRole approval tier / position authority;
11. AuthorityGrant;
12. Flow quick-confirm;
13. staff WhatsApp/SMS approval reply;
14. BusinessAutonomyProfile and AutopilotSettings control-plane mutation;
15. ActionDispatcher / Flow direct execution after governance.

User-visible surfaces traced:

```text
/app/approvals
  ├ Team Requests → ApprovalRequest
  └ KEY Actions   → AiApprovalItem

/app/plans/:planId
  └ AiPlan approval

KEY chat
  └ Flow quick-confirm
```

No dedicated current `apps/web` KeyActionProposal approval surface was found in the latest scoped search.

---

## E. Canonical Target State Machine

Working target semantics:

```text
ACTION_IDENTIFIED
→ ACTION_NORMALIZED
→ CONTROL_EVALUATING

CONTROL_EVALUATING
→ AUTO
→ DIRECT_HUMAN
→ QUICK_CONFIRM_REQUIRED
→ FORMAL_APPROVAL_REQUIRED
→ ADMIN_APPROVAL_REQUIRED
→ STEP_UP_REQUIRED
→ EXPLICIT_DELEGATION_REQUIRED
→ BLOCKED

CONTROL_REQUIRED
→ PENDING
→ SATISFIED
→ REJECTED
→ EXPIRED
→ REVOKED
→ INVALIDATED

SATISFIED
→ CLEARANCE_EVALUATING
→ CLEARANCE_GRANTED | CLEARANCE_DENIED

CLEARANCE_GRANTED
→ CLAIMED
→ RUNNING
→ SUCCEEDED
   | FAILED_RETRYABLE
   | FAILED_FINAL
   | OUTCOME_UNKNOWN
```

Workflow-specific records may use richer states, but must normalize into these shared semantics where they affect authorization.

---

## F. Frontend / Human Control Evidence

### AiApprovalItem KEY Actions

The SideSheet can display:

- title/status;
- risk/module;
- rationale/benefit/risks;
- full `inputPayload`;
- `affectedEntities`.

However the user may approve directly from the queue without opening that detail, and the confirmation dialog restates only the title.

### ApprovalRequest

The client API exposes structured `payload`, but the approval detail page does not render it. The human sees title/type/threshold/description/steps but not the structured subject data the backend may use.

### AiPlan

The browser receives `toolName`, `inputPayload`, `riskTier`, `requiresApproval`, dependencies and descriptions. The approval UI shows action/description and high-risk badges but omits exact tool/parameters. `Approve & Execute` is a single action.

### Flow quick-confirm

Favorable current pattern:

- description/name visible;
- risk visible;
- exact JSON arguments expandable;
- Allow/Deny sends the same in-memory action fields.

Remaining weakness is server binding: the confirmation request resubmits `toolName/toolArgs` rather than referencing an immutable server-side ActionEnvelope.

### Conversational reply approval

Bare YES/NO does not carry approval/challenge identity. StaffChatBridge resolves the oldest routed pending item. Authentic duplicate delivery can therefore be replayed against successive pending items because staff processing occurs before normal inbound dedupe.

---

## G. API / Authority Boundary

Current approval surfaces do not share one Effective Authority boundary.

Examples:

- logged-in AiApprovalItem resolution uses Membership tier but does not require routed assignment identity;
- position reply approval uses active OrgAssignment + JobRole tier without User/Membership;
- plan approval strongly checks OWNER/ADMIN only at highest tier;
- proposal controller/orchestrator does not universally resolve Membership approval tier;
- ApprovalRequest step assignment/delegation has its own semantics.

Target:

```text
principal + business + exact capability/action + requested control
→ EffectiveAuthorityResolver
→ can this principal satisfy this control now?
```

Routing is not authority proof.

---

## H. Backend Governance Chain

Current strong partial seam:

`AiOversightService`

```text
real tool name
→ Flow risk tier
→ autonomy settings
→ KEY crew/role ceiling
→ optional JobRole envelope
→ blocked tools/modules
→ mode/autonomy settings
→ Tier-4 AuthorityGrant condition
→ governance decision
```

Favorable property:

`MIN` over actual KEY-role grantor ceilings prevents adding a permissive role from raising the auto-execution band of a stricter grantor.

But governance is fragmented across Flow/AiOversight, AutonomyOrchestrator, proposal policy, plans, ApprovalRequest and direct execution paths.

---

## I. Data / Mutation Semantics

Key mutation classes traced:

- KeyActionProposal state;
- AiApprovalItem state + dependent plan-step state;
- ApprovalRequest/ApprovalStep state;
- AiPlan/AiPlanStep state;
- DelegationRule;
- JobRole/OrgAssignment;
- Membership copied scopes/tier;
- AuthorityGrant;
- AutopilotSettings;
- BusinessAutonomyProfile.

Important transaction/concurrency observations:

- KeyActionProposal and AiApprovalItem resolution use read-then-update rather than proven atomic expected-state CAS;
- AiApprovalItem resolution and plan-step release are separate writes;
- ApprovalRequest groups some progression transactionally but expected-state ownership remains read-before-write;
- approval does not create an atomic execution claim.

---

## J. Tenant / Identity

J15 consumes the current K1/K2 direction:

```text
Membership
= canonical authenticated-human ↔ Business relationship
+ baseline authority envelope
```

but not every valid approver must be a Membership principal. Position-bound external humans remain legitimate when their channel identity and live organizational authority are sufficient for the required control.

Business/browser selection is never authorization proof.

---

## K. Events / Coordination

Current events include proposal lifecycle events and `plan.approved`.

Material weakness:

Proposal approval for a plan step does not produce portable child clearance. PlanExecutor returns the step to pending, re-governs the real tool and may create another proposal.

Therefore event progression currently communicates state changes more reliably than portable authorization semantics.

---

## L. KEY / AI

KEY authority is separate from human permission.

Current control-plane findings reinforce:

```text
human approval history != standing KEY authority
```

DelegationLoop can currently promote `maxAutoTier` up to tier 2 from high historical approval rates without a contemporaneous human policy transition.

Target:

```text
learning
→ policy recommendation
→ authorized human accepts/rejects
→ policy version changes
```

Automatic tightening may be allowed where intentionally designed; autonomous expansion should not silently self-grant.

---

## M. Capability Mapping

Current problem:

```text
real capability/tool
→ sometimes wrapped as EXECUTE_TOOL / REQUEST_APPROVAL
→ proposal policy evaluates wrapper
→ executor later unwraps actual tool
```

Verified example:

A Tier-3/4 plan step can become a MEDIUM `EXECUTE_TOOL` KeyActionProposal because the computed plan risk is discarded at proposal creation.

Target:

```text
CapabilityContract(name, version, permission, impact, schemas, changed entities)
→ ActionEnvelope
→ action fingerprint
```

`actionType` may describe workflow choreography but must not replace business capability identity.

---

## N. Authority / Governance

Working authority laws:

```text
granted/delegated authority <= grantor grantable authority
```

```text
manage organizational structure != grant arbitrary authority
```

```text
control-plane mutation authority >= authority enabled by that mutation
```

Current counterexamples include:

- `team:write` can invite/promote ADMIN and construct powerful JobRoles/delegations without grantability comparison;
- JobRole authority is copied into Membership and can remain after assignment end/delete;
- AuthorityGrant accepts caller-supplied grantor identity and lacks central grantability proof;
- BusinessAutonomyProfile hard-safety mutation uses only broad Business access.

---

## O. Blueprint / Graph / Genome / Readiness

Approval does not satisfy readiness.

```text
approval evidence
!= knowledge readiness
!= operational readiness
!= connectivity readiness
!= compliance readiness
!= policy satisfaction
!= clearance
```

Genome/readiness must remain independent inputs to final clearance where material.

---

## P. Canonical Invariants

Current J15 invariant set:

1. Every governed mutation is evaluated as an exact versioned capability invocation.
2. Workflow/actionType identity cannot replace underlying business capability identity.
3. Approval/confirmation is bound to immutable material action identity.
4. The human must be able to understand the significant business data they are authorizing.
5. Material action mutation invalidates prior control evidence.
6. Approval authority is checked for the exact action/control requirement.
7. Routing does not prove authority.
8. Grant/delegation cannot exceed grantable authority unless an explicit separately governed escalation capability permits it.
9. Authority/policy changes material to an approval force re-evaluation/invalidation.
10. Approval evidence has validity/expiry/revocation semantics.
11. Approval artifact is not an open-ended execution token.
12. Mutable workflow plan is separate from immutable parent clearance bounds.
13. Parent clearance covers only bounded child capability/parameter sets.
14. Approval does not claim execution.
15. Execution claim is atomic before side effects.
16. Authentic event delivery does not equal unique event consumption.
17. Messaging control challenge is exact-action-bound and one-time consumable.
18. Principal lineage is preserved.
19. Learning may recommend greater autonomy but cannot silently grant itself standing authority.
20. Control-plane policy mutation requires proportional human authority.

---

## Q. Failure Matrix

Current material classes:

- wrong approver routed;
- routed principal no longer delegated;
- tier-qualified principal bypasses intended routed exclusivity;
- contact-only reply identity insufficient for action impact;
- approval applied to wrong oldest pending request;
- authentic provider retry consumed twice;
- approval of stale/changed parameters;
- human never shown material payload;
- wrapper risk lower than underlying capability risk;
- plan approved without exact child parameter visibility;
- new child inserted after parent approval;
- authority revoked after approval;
- policy tightened/changed after approval;
- approval never expires;
- concurrent approval resolution;
- split approval/plan-step state;
- approval re-enters approval loop;
- duplicate concurrent execution;
- provider timeout after side effect → ambiguous outcome.

---

## R. Idempotency / Transactions / Concurrency

Canonical distinction:

```text
control evidence
!= clearance
!= execution claim
!= response idempotency
```

Required target sequence:

```text
CLEARANCE_GRANTED
→ atomic CLAIMED
→ RUNNING
→ terminal/unknown outcome
```

Inbound governance events also need event-consumption idempotency before business side effects.

---

## S. Security / Privacy

Relevant external minimums researched:

- OWASP Authorization: least privilege, deny by default, validate exact authorization on each request;
- Kubernetes RBAC anti-escalation: role creation/binding cannot exceed caller authority unless explicit `escalate`/`bind` privilege exists;
- OWASP Transaction Authorization: significant transaction data, server-controlled authorization, unique operation binding, mutation invalidation, final execution check;
- NIST SP 800-63B-4 principles for one-time replay-resistant out-of-band transaction binding; PSTN/SMS treated as restricted authenticator;
- OWASP GenAI Excessive Agency / agent controls: least privilege, complete mediation, human controls for high-impact actions.

These are design properties to adapt, not technologies to copy blindly.

---

## T. Observability / Evidence

Target governance trace:

```text
actionFingerprint
capability/version
controlRequirement
ControlPresentation
ControlEvidence type
satisfiedBy principal + assurance
EffectiveAuthority trace/version
policy/readiness version
clearance issue/expiry/invalidation
ExecutionClaim
provider/domain outcome
reconciliation state
```

---

## U. Proof / Test Ratchets

Future implementation proof must include:

- two simultaneous approvers;
- two simultaneous executors;
- same idempotency key concurrent callers;
- duplicate authentic WhatsApp/SMS event;
- changed action parameters after review;
- new plan child after parent approval;
- approver demoted/revoked before execution;
- delegation expiry before approval consumption;
- policy tightened between approval and execution;
- same challenge replayed;
- capability wrapper cannot downgrade underlying impact;
- user-visible significant data corresponds to executed ActionEnvelope;
- outcome-unknown provider timeout reconciliation.

Test source existing is not proof that these pass.

---

## V. Reachability

Current reachability classification:

- AiApprovalItem: mounted, UI-linked, live product path;
- ApprovalRequest: mounted, UI-linked, multi-step human workflow;
- KeyActionProposal: mounted/backend-live and migration/convergence seam; no dedicated web UI found in scoped search;
- AiPlan approval: mounted, UI-linked;
- Flow quick-confirm: mounted, UI-linked through unified KEY chat;
- position reply approval: externally reachable through verified messaging ingress;
- direct Flow execution: reachable from multiple services outside ActionDispatcher.

Legacy/convergence decisions require consumer proof.

---

## W. Duplication / Regime Classification

Do not collapse everything into one table.

Current conceptual roles:

### A. Control Requirement resolver
Current seam: AiOversight / AutonomyOrchestrator.

### B. Single-action proposal workflow
Current seam: KeyActionProposal + KeyCortexApprovalOrchestrator.

### C. Multi-step human workflow
Current seam: ApprovalRequest + ApprovalStep.

### D. Routing workflow
ApprovalRouting + DelegationRule + JobRole.

### E. Typed ControlEvidence
Target missing shared primitive.

### F. Exact-action Clearance
Target missing shared primitive.

Specialized workflows should converge on shared capability/authority/evidence/clearance semantics, not one mega-table.

---

## X. Architecture Alignment

Current target:

```text
CapabilityContract
→ ActionEnvelope + fingerprint
→ Effective Human Authority
  + KEY autonomy/delegation
  + readiness
  + policy
→ ControlRequirement
→ specialized workflow/channel
→ ControlPresentation
→ ControlEvidence
→ Clearance
→ atomic ExecutionClaim
→ ActionDispatcher
→ domain/provider execution
→ OutcomeEvidence
```

Existing strong seams should be evolved before parallel replacements:

- CapabilityContractService;
- KeyCortexApprovalOrchestrator;
- ApprovalRequest for multi-step workflows;
- AiOversight control distinctions;
- ActionDispatcher;
- AuthorityGrant concept, after semantic repair.

---

## Y. Contradictions

J15 currently intersects canonical contradiction candidates through C051, especially:

- C017–C021 governance/capability/approval foundations;
- C022–C030 authority/routing/capability identity;
- C031–C039 concurrency/regime convergence;
- C040 wrapper risk;
- C041 mutable plan vs approval;
- C042–C043 conversational binding/replay;
- C044–C047 autonomy/invalidation/control plane;
- C048 alternate authority constructors;
- C049 backend-significant payload vs human-visible data;
- C050 canonical proposal direction vs visible AiApprovalItem regime;
- C051 detail availability vs authorization-moment summary.

---

## Z. Remaining Unknowns

J15 is not target-converged yet. Remaining high-value unknowns:

1. exact migration relationship among AiApprovalItem, KeyActionProposal and ApprovalRequest after shared ControlEvidence exists;
2. final persistence shape for ControlEvidence / Clearance / ExecutionClaim;
3. complete mapping of manual direct business actions intentionally outside proposal workflows;
4. exact authority-version invalidation strategy: event-driven invalidation versus evaluation-time fingerprint comparison or hybrid;
5. how much of current AutopilotSettings vs BusinessAutonomyProfile survives target convergence;
6. precise step-up authentication policy by capability/impact/origin;
7. final ControlPresentation contract and channel-specific display rules;
8. migration sequencing that avoids breaking live approval UI and compatibility consumers.

These are target/migration questions, not undefined foundational concepts.

---

## AA. Findings

Canonical global findings now extend through F089 in current investigations/register pooling work.

Highest-leverage J15 findings include:

- F029–F043 historical governed-action findings;
- F044–F056 authority/execution convergence;
- F057–F075 approval regime/evidence convergence;
- F076 wrapper risk collapse;
- F077 exact capability not reconstructed at proposal execution;
- F078 mutable plan child set;
- F079–F080 reply binding/replay;
- F081–F084 authority freshness/control-plane/autonomy learning;
- F085 `team:write` authority construction beyond caller grantability;
- F086 stale Membership authority after OrgAssignment end/delete;
- F087 KEY Action approval without viewing significant structured action data;
- F088 ApprovalRequest payload available but not rendered;
- F089 AI Plan approval omits exact tool/input payload available to browser.

Finding lifecycle correction:

The earlier placeholder-User invitation collision claim is **narrowed / partially superseded** by current `reconcileUserId()` behavior. Current remaining invitation problem is claim/tenant-selection semantics, not unavoidable authentication failure.

F067 quick-confirm concern is also **narrowed**: the current client shows/passes the same action object and server re-governs; remaining problem is durable server-side exact-action binding.

---

## AB. Canonical Journey Graph

```text
Action intent
→ CapabilityContract
→ ActionEnvelope
→ action fingerprint
→ EffectiveAuthority + principal assurance
→ KEY autonomy + readiness + policy
→ ControlRequirement
     ├ AUTO
     ├ DIRECT_HUMAN
     ├ QUICK_CONFIRM
     ├ FORMAL_APPROVAL
     ├ ADMIN_APPROVAL
     ├ STEP_UP
     ├ EXPLICIT_DELEGATION
     └ BLOCK
→ ControlPresentation
→ specialized control workflow
→ typed ControlEvidence
→ freshness / invalidation check
→ Clearance
→ atomic ExecutionClaim
→ ActionDispatcher
→ domain/provider effect
→ OutcomeEvidence
→ Business Graph / Genome feedback
```

---

## AC. Machine-readable Record

```yaml
journey_id: KF-JOURNEY-015
name: Approval / Governance Lifecycle
maturity: L4_SEMANTICALLY_RECONCILED
next_maturity: L5_VALUE_ENGINEERED
implementation_evidence:
  branch: main
  commit: d7c5b86cfa276d75ffa42d5f1707c43704dc9f21
active_kernels:
  - KF-KERNEL-002
  - KF-KERNEL-003
  - KF-KERNEL-005
  - KF-KERNEL-006
  - KF-KERNEL-007
  - KF-KERNEL-008
  - KF-KERNEL-011
core_distinctions:
  - workflow_type_not_equal_capability_identity
  - risk_not_equal_control_requirement
  - routing_not_equal_authority
  - approval_not_equal_clearance
  - clearance_not_equal_execution_claim
  - mutable_plan_not_equal_hierarchical_clearance
  - authentic_event_not_equal_unique_consumption
  - learned_preference_not_equal_standing_authority
current_regimes:
  - key_action_proposal
  - ai_approval_item
  - approval_request_steps
  - ai_plan_approval
  - flow_quick_confirm
  - position_reply_approval
shared_target_primitives:
  - capability_contract
  - action_envelope
  - effective_authority
  - control_requirement
  - control_presentation
  - control_evidence
  - clearance
  - execution_claim
  - action_dispatcher
implementation_authorized: false
next_stress_test:
  journey: KF-JOURNEY-006
  purpose: proactive_key_autonomy_stress_test
reopen_on_new_evidence: true
```
