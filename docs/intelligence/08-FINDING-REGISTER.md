# KeyFlowOS Finding Register

Status: ACTIVE EVIDENCE/ANALYSIS REGISTER

Purpose: track material findings discovered during journey/kernel analysis without prematurely converting them into architectural decisions.

Finding lifecycle:

```text
PROVISIONAL
  -> VERIFIED
  -> RE-ANALYZED
       -> STRENGTHENED
       -> NARROWED
       -> UNCHANGED
       -> SUPERSEDED
       -> REFUTED
```

Evidence discipline: **implementation fact -> interpretation -> architectural implication**.

Recovered historical IDs are preserved exactly where confident. Commit-sensitive implementation claims must be revalidated against current code before execution planning.

---

# Recovered historical findings F003–F043

## KF-JOURNEY-001 recovered findings

### F003 — ownerId and OWNER Membership dual authority
**Status:** RECOVERED / NEEDS CURRENT REVALIDATION
Implementation historically used both `Business.ownerId` and OWNER Membership as material authority/relationship concepts.

### F004 — Explicit createBusiness lacks OWNER Membership
**Status:** RECOVERED / REVALIDATED IN CURRENT TENANCY CONVERGENCE
At least one explicit business-creation path creates Business without equivalent founding OWNER Membership.

### F005 — bootstrap and explicit create have different initialization
**Status:** RECOVERED / REVALIDATED DIRECTIONALLY
Business creation/bootstrap paths do not share one semantic initialization contract.

### F006 — discovery owner-based vs access Membership-based
**Status:** RECOVERED / REVALIDATED
Workspace/business discovery and scoped access use different tenant concepts.

### F007 — generic onboardingComplete patch bypass
**Status:** RECOVERED / REVALIDATE CURRENT CODE BEFORE EXECUTION
A generic Business mutation path historically could bypass dedicated onboarding completion semantics.

### F008 — Blueprint → Genome stale projection
**Status:** RECOVERED / NEEDS CURRENT REVALIDATION
Blueprint scoring/readiness could be computed before asynchronous fact reconciliation completed.

### F009 — genesisCompleted ineffective
**Status:** RECOVERED / NEEDS CURRENT REVALIDATION
Lifecycle semantics of `genesisCompleted` were unreliable in common paths.

### F010 — BusinessGenome parallel mutable model
**Status:** RECOVERED / CONSUMER PROOF REQUIRED
Legacy mutable `BusinessGenome` remained live alongside modern GenomeFact architecture.

### F011 — heuristic source → canonical mapping
**Status:** RECOVERED / NEEDS CURRENT REVALIDATION
Some business-knowledge producers used source-specific mapping rather than universal ontology normalization.

### F012 — BusinessGuidanceProfile remains live
**Status:** RECOVERED / CONSUMER PROOF REQUIRED
`BusinessGuidanceProfile` remained an active AI/document context source despite newer knowledge architecture.

### F013 — incoherent Blueprint/fact score
**Status:** RECOVERED / NEEDS CURRENT REVALIDATION
Multiple Genome scoring/resolution paths could disagree.

### F014 — Command Center cached/fresh mixture
**Status:** RECOVERED / NEEDS CURRENT REVALIDATION
Command Center combined data with different freshness/projection semantics.

### F015 — tests do not prove Blueprint → ontology compatibility
**Status:** RECOVERED METHODOLOGICAL FINDING
Existing test presence did not prove all Blueprint/fact ontology mappings were semantically compatible.

### F016 — payment recommendation masquerades as configuration
**Status:** RECOVERED / NEEDS CURRENT REVALIDATION
Onboarding/setup state could count recommended payment setup as stronger operational configuration than actually established.

### F017 — readiness mixes domains
**Status:** RECOVERED / REFINED
Readiness logic conflated distinct knowledge/operational/connectivity/compliance/authority/action dimensions. This informed the Readiness Lattice.

### F018 — synthetic contamination
**Status:** RECOVERED AS VERIFIED HISTORICAL FINDING / REVALIDATE CURRENT CODE
Synthetic/demo onboarding data entered some intelligence/operational contexts as if live.

### F019 — first-value capability exists; activation weak
**Status:** RECOVERED / PRODUCT FINDING
Storefront/public-asset machinery existed during onboarding but UX did not prominently surface it as early activation proof.

### F020 — business self-model mutation authority under-scoped
**Status:** RECOVERED / ACTIVE CROSS-JOURNEY CONCERN
Ordinary members could reach business-definition/Blueprint/Genesis/Genome mutation surfaces without a sufficiently differentiated authority model.

### F021 — missing central semantic fact normalization
**Status:** RECOVERED / ACTIVE KNOWLEDGE-KERNEL CONCERN
No single load-bearing semantic normalization/resolution boundary had been found.

### F022 — module readiness address-presence only
**Status:** RECOVERED / NEEDS CURRENT REVALIDATION
Module readiness relied heavily on fact-address/presence heuristics rather than trust properties.

### F023 — some KEY execution trusts weak module readiness
**Status:** RECOVERED / ACTIVE CROSS-JOURNEY CONCERN
Some autonomous/execution paths treated weak readiness signals as stronger action prerequisites than justified.

### F024 — tRPC underinitialized tenant creation
**Status:** RECOVERED / NEEDS CURRENT REVALIDATION
An alternate tRPC business/identity creation path did not satisfy the same founding initialization semantics as bootstrap.

### F025 — no reliable Business lifecycle creation event
**Status:** RECOVERED / ACTIVE J1 QUESTION
No single reliable committed lifecycle event representing semantic tenant/business creation had been established.

### F026 — weaker fact can replace value while retaining stronger verification state
**Status:** RECOVERED / HIGH-SEVERITY KNOWLEDGE-INTEGRITY CONCERN
Value/source mutation could diverge from verification/provenance strength.

### F027 — demo invoice affects Cortex and latent ecommerce inference
**Status:** RECOVERED / SYNTHETIC-DATA CONCERN
Synthetic demo commerce state could influence intelligence/business inference.

### F028 — fresh Business can have modern Genome but no legacy BusinessGenome
**Status:** RECOVERED / COMPATIBILITY CONCERN
Fresh tenant state could diverge between modern GenomeFact-based and legacy BusinessGenome consumers.

## KF-JOURNEY-002 recovered findings

### F029 — canonical proposal controller approval/execution under-authorized
**Status:** RECOVERED / REVALIDATED AS ACTIVE J15 CONCERN
Proposal approval/execution routes do not consistently enforce fine-grained human approval authority.

### F030 — approval confirmation booleans can be hard-coded instead of evidence-backed
**Status:** RECOVERED / REVALIDATED
Some confirmation/approval conditions are represented as booleans without durable evidence binding.

### F031 — proposal/execution actor provenance drift
**Status:** RECOVERED / ACTIVE PRINCIPAL-LINEAGE CONCERN
Requested/proposed/approved/executed identities can collapse or be lost across transitions.

### F032 — parallel governance regimes
**Status:** RECOVERED / REVALIDATED / ACTIVE CONVERGENCE CONCERN
GraphActions, Flow, proposals/Cortex, ActionDispatcher, plan execution and queue paths do not share one governance stack.

### F033 — generic EXECUTE_TOOL loses underlying capability identity/risk
**Status:** RECOVERED / REVALIDATED / STRENGTHENED BY F076–F077
Generic wrappers can obscure the real capability being approved/executed.

### F034 — payments_refund_charge Tier 3 → generic wrapper risk collapse
**Status:** RECOVERED CONCRETE EXAMPLE / GENERAL MECHANISM NOW REVALIDATED BY F076
A high-impact capability can be represented under generic EXECUTE_TOOL proposal semantics.

### F035 — CapabilityContract exists but is non-load-bearing
**Status:** RECOVERED / REVALIDATED FAVORABLE EXISTING-SEAM FINDING
`CapabilityContractService` approximates the desired canonical capability layer but execution paths do not consistently consume it.

### F036 — AI approval resolver and proposal controller use different human authority semantics
**Status:** RECOVERED / REVALIDATED
Different approval/governance surfaces interpret human authority differently.

### F037 — proposal has riskLevel but no canonical riskTier; resolver may default Tier 2
**Status:** RECOVERED / REVALIDATED CONCEPTUALLY / STRENGTHENED BY F076
Proposal-level risk representation and numeric tier semantics diverge.

### F038 — plan approval only strongly enforces role for Tier 4
**Status:** RECOVERED / REVALIDATED
Lower-tier plans lack equivalent fine-grained Membership approval-tier enforcement in the inspected approval method.

### F039 — canonical AI_PLAN proposal approval can re-enter evaluation/re-proposal
**Status:** RE-ANALYZED / STRENGTHENED
Approved plan-step proposal causes the step to return to `pending`, after which the real tool is governed again and may generate another approval proposal. No portable child clearance was observed.

### F040 — ActionDispatcher ignores approval-required flags as standalone boundary
**Status:** RECOVERED / REVALIDATED FAVORABLE SEAM BUT NOT CLEARANCE BOUNDARY
Dispatcher has useful execution mechanics but cannot independently prove required controls were satisfied.

### F041 — proposal transition concurrency weakness / no CAS
**Status:** RECOVERED / REVALIDATED
Proposal state changes use read-then-update patterns rather than atomic expected-state transitions.

### F042 — SafetyShell in-memory idempotency and weak compensation
**Status:** RECOVERED / ACTIVE RECOVERY-KERNEL CONCERN
SafetyShell is a local safeguard, not a distributed execution guarantee.

### F043 — ordinary Flow direct execution does not universally pass KeyAutonomySafety
**Status:** RECOVERED / REVALIDATED AS ACTIVE GOVERNANCE-CONVERGENCE CONCERN
Global-sounding autonomy controls are not universally consumed by every direct execution path.

---

# Current revalidated findings F044–F084

## Authority convergence — F044–F049

### F044 — JobRole authority is destructively materialized into Membership
**Status:** VERIFIED CODE-LEVEL FINDING
JobRole permissions/default approval tier are copied into Membership on assignment changes, losing source provenance and allowing stale divergence when assignments change.

### F045 — ApprovalRouting resolves routing, not complete authority
**Status:** VERIFIED ARCHITECTURAL FINDING
ApprovalRouting determines who should receive an approval but does not itself prove the routed principal's complete effective authority.

### F046 — AuthorityGrant provenance/bounds are incomplete end-to-end
**Status:** VERIFIED CODE-LEVEL FINDING
AuthorityGrant contains promising bounded-delegation fields, but grantor provenance/grantability and some stored constraints are not universally enforced at decision boundaries.

### F047 — capability permission vocabulary is disconnected from human module scopes
**Status:** VERIFIED ARCHITECTURAL FINDING
Fine-grained capability permission identity and coarse Membership/HTTP module scopes are not bridged by one canonical machine-resolvable permission vocabulary.

### F048 — no first-class explicit-denial layer found in inspected authority paths
**Status:** PROVISIONAL / SEARCH-SCOPED
No load-bearing explicit denial source was found in the authority paths inspected. Revalidate before treating as universal absence.

### F049 — no central Effective Authority Resolver found
**Status:** VERIFIED SEARCH-SCOPED ARCHITECTURAL GAP
Authority calculation remains distributed across guards, services, JobRole policy, approval helpers and controllers rather than one explainable resolver.

## Execution convergence — F050–F056

### F050 — ActionDispatcher idempotency lookup is not a concurrency-safe execution claim
**Status:** VERIFIED CODE-LEVEL FINDING
Pre-execution outcome/idempotency lookup does not atomically grant one executor ownership before side effects.

### F051 — KeyIdempotencyService permits concurrent pending callers to proceed
**Status:** VERIFIED CODE-LEVEL FINDING
An existing pending idempotency record can return semantics allowing another caller to execute rather than returning `IN_PROGRESS`/single ownership.

### F052 — plan execution re-evaluates governance at multiple layers without portable clearance
**Status:** VERIFIED CODE-LEVEL FINDING
Plan/queue/dispatcher paths re-run governance rather than carry exact-action clearance between stages.

### F053 — proposal and plan/dispatcher remain separate execution fabrics
**Status:** VERIFIED ARCHITECTURAL FINDING
Approved proposal execution and plan/dispatcher execution do not converge on one canonical post-clearance execution fabric.

### F054 — FlowOrchestrator direct execution remains reachable outside dispatcher
**Status:** VERIFIED REACHABILITY FINDING
Raw/direct Flow execution is callable from multiple current services, so ActionDispatcher is not a universal choke point.

### F055 — Proposal EXECUTING transition is not proven atomic expected-state claim
**Status:** VERIFIED CODE-LEVEL CONCURRENCY FINDING
Proposal execution reads APPROVED then performs an unconditional status update to EXECUTING rather than one atomic `APPROVED -> EXECUTING` claim.

### F056 — BullMQ deterministic job IDs are transport dedupe, not platform execution ownership
**Status:** VERIFIED ARCHITECTURAL FINDING
Queue-level duplicate suppression does not establish one cross-entry execution claimant for an action.

## J15 governance forensics — F057–F075

### F057 — AiOversight distinguishes controls but still over-couples control requirement to risk
**Status:** VERIFIED / TARGET-SEMANTIC FINDING
Quick confirm, formal approval, admin approval and blocking are represented, but risk tier remains overly load-bearing as the control selector.

### F058 — plan-step preapproval can cause evaluateAutoApproval to return approved without exact immutable binding
**Status:** VERIFIED CODE-LEVEL FINDING
AiApprovalItem preapproval can satisfy automatic approval logic, but exact action binding and authority freshness are not universally proven.

### F059 — MIN-over-grantors KEY role ceiling is a favorable anti-escalation rule
**Status:** VERIFIED FAVORABLE FINDING
Crew/role ceiling uses the strictest applicable grantor limit rather than allowing an additional permissive role to raise autonomy.

### F060 — logged-in AiApprovalItem resolution does not require routed approver identity
**Status:** VERIFIED CODE-LEVEL FINDING
Membership/tier may be sufficient to resolve a pending item even when a routed assignment exists; routing exclusivity/preference is not explicit.

### F061 — contact-only OrgAssignments can approve without Membership/User
**Status:** VERIFIED PRODUCT/ARCHITECTURAL FINDING
Active position-bound external humans can approve through JobRole authority and verified messaging-channel identity without a local User/Membership.

### F062 — AiApprovalItem resolution uses read-then-update rather than atomic pending-state CAS
**Status:** VERIFIED CODE-LEVEL CONCURRENCY FINDING
Concurrent resolvers can observe `pending` before either update wins.

### F063 — approval resolution and dependent plan-step release are separate non-transactional writes
**Status:** VERIFIED CODE-LEVEL FINDING
AiApprovalItem resolution is written before dependent plan-step state, allowing split state on failure.

### F064 — stale low-tier approvals can become autonomous timeout approvals
**Status:** VERIFIED CODE-LEVEL FINDING
Pending Tier 1–2 AiApprovalItems may be marked approved after timeout when autonomy level is high enough, despite a human-approval-looking lifecycle.

### F065 — AiApprovalItem remains live despite KeyActionProposal migration direction
**Status:** VERIFIED REACHABILITY / MIGRATION FINDING
Dedicated controllers, evaluation logic, plan-step workflows and timeout handling still consume AiApprovalItem.

### F066 — plan-level approval uses different human-authority semantics from item approval
**Status:** VERIFIED CODE-LEVEL FINDING
Plan approval strongly checks owner/admin only for highest-tier plans; lower tiers do not use equivalent Membership approval-tier enforcement in the inspected method.

### F067 — Flow quick-confirm trusts client-returned toolName/toolArgs rather than durable pending action
**Status:** VERIFIED CODE-LEVEL BINDING FINDING
The server re-evaluates governance, which narrows bypass risk, but confirmation is not consumption of an immutable server-side ActionEnvelope.

### F068 — current approval artifacts lack canonical exact-action fingerprint binding
**Status:** VERIFIED ARCHITECTURAL FINDING
Useful action fields exist, but no universal platform action fingerprint/version binds approval to material action identity.

### F069 — KeyCortexApprovalOrchestrator is a strong convergence seam but not complete governance boundary
**Status:** VERIFIED FAVORABLE EXISTING-SEAM FINDING
It centralizes proposal lifecycle/audit/identity threads but does not itself provide complete authority, capability fingerprinting, clearance or atomic claim semantics.

### F070 — ApprovalRequest is a legitimate multi-step human workflow primitive
**Status:** VERIFIED FAVORABLE SEMANTIC FINDING
Ordered approvers, thresholds, delegation, cancellation/escalation and inbox semantics justify retaining workflow-specific state rather than collapsing all approvals into one table.

### F071 — ApprovalRequest transactional progression still lacks observed expected-state CAS
**Status:** VERIFIED CODE-LEVEL FINDING
Step/request mutations are transactionally grouped, but pending/current checks occur before the transaction and observed updates are not conditional expected-state claims.

### F072 — ApprovalRequest delegation does not centrally prove delegate/grantability bounds
**Status:** VERIFIED CODE-LEVEL AUTHORITY FINDING
A delegated workflow assignee is recorded without observed central proof of Membership/capability/grantability/expiry bounds.

### F073 — ApprovalRequest threshold auto-approval uses heuristic payload amount extraction
**Status:** VERIFIED CODE-LEVEL POLICY FINDING
Financial thresholds inspect generic payload keys such as amount/total/value rather than capability-normalized monetary parameters.

### F074 — ApprovalRequest shadow migration creates proposal visibility but not synchronized canonical state
**Status:** VERIFIED MIGRATION FINDING
The shadow KeyActionProposal can remain pending while ApprovalRequest independently advances to approved/cancelled/escalated.

### F075 — proposal `actionType` describes governance choreography more reliably than exact business capability
**Status:** VERIFIED ARCHITECTURAL FINDING
Values such as `EXECUTE_TOOL` and `REQUEST_APPROVAL` identify workflow behavior, not necessarily the underlying business capability.

## J15 capability / plan / reply binding — F076–F080

### F076 — Plan step risk is discarded when creating canonical proposal
**Status:** VERIFIED CODE-LEVEL FINDING
`PlanExecutorService.createStepProposal()` computes `mapRiskTier(step.riskTier)` but does not persist it. `KeyActionProposalService.create()` derives risk from `actionType`, and `EXECUTE_TOOL` is statically MEDIUM. A Tier 3/4 plan step can therefore become a MEDIUM proposal.

### F077 — Approved EXECUTE_TOOL proposal is re-evaluated without reconstructing exact capability
**Status:** VERIFIED CODE-LEVEL FINDING
Proposal execution evaluates `key_autonomy.EXECUTE_TOOL`; exact tool identity remains nested. `AutonomyOrchestrator.toExecutableActionType()` does not treat EXECUTE_TOOL as an executable capability and Genome module policy has no EXECUTE_TOOL mapping. Executor later unwraps `payload.toolName`, and bare Flow tools can reach `executeToolDirectly()`.

### F078 — Approved plan child set is mutable during execution
**Status:** VERIFIED CODE-LEVEL / SEMANTIC FINDING
FeedbackLoop can insert a new child step with new tool/parameters/risk into an already executing plan without necessarily returning the parent plan to a new approval cycle. `AiPlan.status='approved'` therefore cannot itself represent immutable hierarchical clearance.

### F079 — reply approval is not bound to an explicit approval/action identifier
**Status:** VERIFIED CODE-LEVEL BINDING FINDING
StaffChatBridge parses bare YES/NO and selects the oldest pending AiApprovalItem routed to the assignment. The message carries no approval ID, nonce or action fingerprint.

### F080 — staff reply approval is processed before inbound event deduplication
**Status:** VERIFIED CODE-LEVEL REPLAY/IDEMPOTENCY FINDING
WhatsApp and generic SMS staff bridges process the approval decision before normal external-message dedupe; staff-handled WhatsApp returns before that dedupe path entirely. A duplicate authentic provider delivery can therefore approve successive pending items for the same assignment. Runtime reproduction has not been performed.

## J15 invalidation / control-plane — F081–F084

### F081 — approved KeyActionProposal has no observed expiry or human-authority version binding
**Status:** VERIFIED CODE-LEVEL / DATA-CONTRACT FINDING
Proposal approval records who/when approved but no approval expiry, authority version, policy version, action fingerprint or explicit invalidation metadata was observed. Execution rechecks KEY autonomy/readiness but does not re-prove the approver's human authority freshness.

### F082 — DelegationRule expiry/revocation does not invalidate or re-route an already-routed AiApprovalItem
**Status:** VERIFIED CODE-LEVEL FINDING
ApprovalRouting respects DelegationRule temporal bounds when initially routing, but reply resolution later trusts the persisted `approverAssignmentId` and current assignment/tier. It does not revalidate the DelegationRule that originally produced that route.

### F083 — BusinessAutonomyProfile hard-safety mutation is protected only by broad Business access
**Status:** VERIFIED CODE-LEVEL AUTHORITY FINDING
`PATCH /api/v1/cortex/autonomy-profile` is under `AuthGuard + BusinessGuard` with no observed capability/module authority guard; `KeyAutonomySafetyService.updateProfile()` performs no actor authorization. Numeric hard-ceiling fields are type-validated but have no observed range constraints in the DTO.

### F084 — approval-history learning can automatically increase standing KEY maxAutoTier
**Status:** VERIFIED CODE-LEVEL / ARCHITECTURAL FINDING
DelegationLoop governance adaptation can raise `maxAutoTier` to a tool tier <=2 when approval rate is >=90% over >=15 observations. It calls `updateAutonomySettings()` without a userId, bypassing the method's conditional OWNER/ADMIN check. Historical approval evidence can therefore become higher standing autonomy without a contemporaneous human policy transition.

---

# Pooled architectural implications

These findings currently support, but do not by themselves authorize implementation of:

- Membership-first tenant relationship with explicit distinguished ownership semantics;
- invitation-as-claim rather than placeholder User;
- canonical capability/permission vocabulary;
- Effective Authority Resolver with provenance and grantability;
- derived authority rather than destructive copies;
- exact CapabilityContract identity through ActionEnvelope/fingerprint;
- ControlRequirement separate from impact/risk tier;
- normalized typed ControlEvidence;
- exact-action Clearance with authority/policy versioning, expiry/revocation/invalidation;
- hierarchical plan clearance distinct from mutable workflow state;
- atomic ExecutionClaim;
- ActionDispatcher as preferred post-clearance execution seam;
- server-generated conversational approval challenge with exact action binding, one-time consumption and ingress-event dedupe;
- proportional step-up authentication for selected high-impact controls;
- control-plane mutation capabilities at least as strong as behavior enabled;
- learning may recommend autonomy changes but must not silently self-grant standing authority;
- explicit principal lineage.

Production implementation remains unauthorized until relevant journey/kernel clusters reach target convergence and execution-readiness gates.
