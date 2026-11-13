# KeyFlowOS Contradiction Register

Status: ACTIVE ARCHITECTURAL CONTRADICTION REGISTER

Contradictions are not automatically bugs. They identify places where two apparently valid models, code paths, semantics or architectural claims cannot both be treated as canonical without reconciliation.

Recovered historical IDs are preserved. Commit-sensitive implementation claims must be revalidated before execution work.

---

# Recovered contradictions C005–C021

## C005 — Founding Membership discovery vs ownerId
**Status:** ACTIVE
Business ownership/discovery semantics lean on `Business.ownerId`, while authorization/scoped access leans on Membership.

## C006 — Business + OWNER Membership invariant vs partial creation paths
**Status:** ACTIVE
The semantic expectation that a founding owner has OWNER Membership conflicts with alternate Business creation paths that do not always create equivalent Membership state.

## C007 — Completion transition command vs generic Business patch
**Status:** ACTIVE / REVALIDATE CURRENT CODE
Dedicated onboarding completion enforces transition semantics, while generic Business mutation historically could alter completion state directly.

## C008 — Modern Genome truth vs legacy BusinessGenome
**Status:** ACTIVE / LEGACY CONSUMER PROOF REQUIRED
Modern GenomeFact/evidence architecture and legacy mutable BusinessGenome can disagree for the same business.

## C009 — Blueprint vs BusinessGuidanceProfile
**Status:** ACTIVE / LEGACY CONSUMER PROOF REQUIRED
Multiple live business-knowledge projections can compete as AI/document grounding sources.

## C010 — Canonical ontology vs source-specific fact producers
**Status:** ACTIVE
Genome/business-knowledge producers use inconsistent section/name/verification semantics rather than one ontology-normalized resolution boundary.

## C011 — Stale Genome roadmap vs implemented Genome kernel
**Status:** HISTORICAL ARCHITECTURE-DOC CONTRADICTION
Narrative/roadmap understanding can lag implemented GenomeFact/evidence/scoring infrastructure.

## C012 — Membership grants business-definition mutation despite differentiated roles
**Status:** ACTIVE J1/J25
Broad membership access can enable mutation of canonical business self-model surfaces even though differentiated authority exists elsewhere.

## C013 — module `automationAllowed` naming vs weak implementation
**Status:** ACTIVE / REFINED INTO READINESS LATTICE
A field sounding like final authorization can be computed from weaker knowledge/address readiness semantics.

## C014 — BusinessGenome/Cortex vs modern Genome divergence
**Status:** ACTIVE / LEGACY COMPATIBILITY
Cortex consumers of legacy BusinessGenome can observe different business understanding from modern GenomeFact-based systems.

## C015 — synthetic data treated as live by some intelligence
**Status:** ACTIVE / HIGH PRIORITY
Demo/synthetic bootstrap data can influence live business context/analytics/intelligence.

## C016 — first live asset exists but activation proof discarded
**Status:** PRODUCT/UX CONTRADICTION
Business Birth contains machinery capable of producing a public/customer-facing asset while onboarding does not prominently surface it as the moment of value.

## C017 — canonical approval claim vs multiple authority regimes
**Status:** ACTIVE J2/J25/J15
The product concept of governed approval conflicts with multiple runtime paths using different authority/policy semantics.

## C018 — real capability risk vs generic proposal-wrapper risk
**Status:** ACTIVE / REVALIDATED AND STRENGTHENED
Underlying capability impact can be obscured by generic workflow identity such as EXECUTE_TOOL.

## C019 — Capability Contract claims platform contract but execution does not consume it
**Status:** ACTIVE / FAVORABLE EXISTING-SEAM OPPORTUNITY
A strong capability-definition seam exists but is not load-bearing across execution/governance.

## C020 — approval state != portable clearance
**Status:** ACTIVE / REFINED CANONICAL DISTINCTION
A record being approved does not necessarily bind exact action, material parameters, authority context, policy version, expiry or execution-time conditions.

## C021 — Membership has approval primitives but many approval surfaces do not consistently consume them
**Status:** ACTIVE J25/J2/J15
Membership contains role/scope/approval-tier concepts while approval controllers/plans/Flow paths do not uniformly use them.

---

# Current contradiction candidates C022–C047

## Authority / tenancy convergence

### C022 — coarse module scope vs fine capability permission
**Status:** ACTIVE CANDIDATE
Human access is expressed through coarse module scope vocabulary while CapabilityContract uses finer business-action permission identities, with no canonical bridge.

### C023 — dynamic organizational authority vs copied Membership authority
**Status:** ACTIVE CANDIDATE
JobRole/OrgAssignment is dynamic organizational truth while permissions/tier are copied into Membership and can become stale or provenance-free.

### C024 — approver routing vs approver authority
**Status:** ACTIVE CANDIDATE
Routing logic can identify an approver while effective authority to satisfy the exact control is a separate unresolved question.

## Clearance / execution convergence

### C025 — approval state vs exact-action clearance
**Status:** ACTIVE CANDIDATE
Approval records are treated as progression state even though they do not universally bind the exact material invocation or current authority/policy state.

### C026 — idempotency semantics vs execution ownership
**Status:** ACTIVE CANDIDATE
Existing idempotency mechanisms can permit concurrent pending requests, while target execution semantics require one atomic claimant before side effects.

### C027 — canonical dispatcher aspiration vs direct executor reachability
**Status:** ACTIVE CANDIDATE
ActionDispatcher is the strongest candidate post-clearance seam, yet current direct Flow and proposal executors remain reachable outside it.

### C028 — plan-step approval vs generic EXECUTE_TOOL identity
**Status:** ACTIVE CANDIDATE / STRENGTHENED BY F076–F077
A plan step is governed as a real tool/capability but its proposal can become the generic EXECUTE_TOOL action identity.

## J15 authority/control evidence

### C029 — routed approver vs tier-qualified resolver
**Status:** ACTIVE CANDIDATE
An item can be routed to one assignment while another logged-in principal with sufficient Membership tier may resolve it.

### C030 — authenticated Membership authority vs contact-only position authority
**Status:** ACTIVE CANDIDATE / REQUIRES EXPLICIT PRINCIPAL MODEL
Some approval semantics assume authenticated User+Membership, while reply-based approval intentionally permits position-bound contact-only humans.

### C031 — approval resolution vs dependent plan-state atomicity
**Status:** ACTIVE CANDIDATE
Approval item resolution and plan-step release represent one semantic transition but are written separately.

### C032 — human approval label vs autonomous timeout approval
**Status:** ACTIVE CANDIDATE
An approval lifecycle can appear to await human control while stale low-tier items may become approved through autonomy timeout policy.

### C033 — canonical proposal migration vs live AiApprovalItem consumers
**Status:** ACTIVE CANDIDATE
KeyActionProposal is described as the canonical migration direction while AiApprovalItem remains mounted/reachable and materially consumed.

### C034 — plan approval authority vs item approval authority
**Status:** ACTIVE CANDIDATE
Planner approval and AiApprovalItem approval resolve human authority using different rules.

### C035 — confirmation UI intent vs client-reconstructed execution parameters
**Status:** ACTIVE CANDIDATE
Quick confirmation semantically suggests acceptance of a presented pending action while the current Flow endpoint accepts reconstructed tool name/args from the client.

## ApprovalRequest / proposal convergence

### C036 — canonical proposal claim vs shadow unsynchronized ApprovalRequest state
**Status:** ACTIVE CANDIDATE
ApprovalRequest can independently progress while its shadow KeyActionProposal remains in an unrelated state.

### C037 — transactionally grouped ApprovalRequest vs non-atomic expected-state ownership
**Status:** ACTIVE CANDIDATE
Request/step changes are grouped in transactions, but read-before-write checks still permit concurrent transition ambiguity.

### C038 — delegated workflow assignee vs delegated authority
**Status:** ACTIVE CANDIDATE
A workflow delegation pointer identifies who should act but does not itself prove that authority was legitimately delegable and remains valid.

### C039 — workflow action type vs exact business capability identity
**Status:** ACTIVE CANDIDATE
Values such as REQUEST_APPROVAL/EXECUTE_TOOL describe governance choreography while target authorization needs stable exact business capability identity.

## Capability / plan / reply binding

### C040 — real plan-step risk vs proposal wrapper risk
**Status:** VERIFIED ACTIVE CONTRADICTION
A plan step can be Tier 3/4 while `KeyActionProposal.riskLevel` becomes MEDIUM because EXECUTE_TOOL's wrapper policy replaces the underlying risk identity.

### C041 — approved plan semantics vs mutable child set
**Status:** VERIFIED ACTIVE CONTRADICTION
`AiPlan.status = approved` suggests bounded authorization, while FeedbackLoop can add new children during execution and MorningBriefing can construct pre-approved plans without a human approval snapshot.

### C042 — conversational approval intent vs oldest-pending selection
**Status:** VERIFIED ACTIVE CONTRADICTION
A user's `YES` is naturally interpreted as approval of the presented action, while implementation resolves whichever routed item is oldest at processing time.

### C043 — authenticated webhook vs replay-safe authorization
**Status:** VERIFIED ACTIVE CONTRADICTION
Valid webhook signatures prove provider/transport authenticity but do not prove the same inbound governance event has not already been consumed. Staff approval processing currently precedes normal inbound deduplication.

## Invalidation / control plane

### C044 — historical human approval vs standing autonomous authority
**Status:** VERIFIED ACTIVE CONTRADICTION
Historical approvals are evidence of likely preference, while DelegationLoop adaptation can convert high approval rates directly into a higher standing `maxAutoTier` without a fresh authorized-human policy transition.

### C045 — temporal delegation authority vs persisted approval routing
**Status:** VERIFIED ACTIVE CONTRADICTION
DelegationRule has active/expiry semantics at routing time, while a pending AiApprovalItem derived from it can remain resolvable by the old assignment after the rule expires or is disabled.

### C046 — hard autonomy policy importance vs BusinessGuard-only mutation
**Status:** VERIFIED ACTIVE CONTRADICTION
BusinessAutonomyProfile is enforced/described as a hard autonomy safety ceiling, while its mutation route uses only broad Business access and no capability-level authority proof.

### C047 — approval timestamp vs durable approval validity
**Status:** VERIFIED ACTIVE CONTRADICTION
KeyActionProposal records who/when approved but has no observed authority/policy version, action fingerprint, expiry or invalidation semantics that establish whether approval remains valid later.

---

# Current contradiction-resolution priorities

1. **C005 + C006** → Membership-first tenancy + founding OWNER Membership invariant + safe migration.
2. **C022 + C023 + C024 + C029 + C030 + C038 + C045** → canonical permission vocabulary + Effective Authority Resolver + explicit principal classes + bounded grantability + temporal provenance.
3. **C017 + C018 + C019 + C020 + C025 + C028 + C035 + C039 + C040 + C047** → load-bearing CapabilityContract + ActionEnvelope/fingerprint + ControlRequirement + normalized ControlEvidence + exact-action Clearance + invalidation/version semantics.
4. **C026 + C027 + C031 + C037 + C043** → atomic state/ExecutionClaim + event-consumption idempotency + canonical post-clearance dispatcher.
5. **C032 + C033 + C034 + C036** → approval-regime convergence without destroying legitimate specialized workflows.
6. **C041** → explicit distinction between mutable orchestration plan and immutable hierarchical clearance bounds.
7. **C044 + C046** → control-plane authority model in which learning can recommend policy but cannot silently grant standing authority, and policy mutation requires authority proportional to behavior enabled.
8. **C010 + C013 + C015** → trusted knowledge/readiness/evidence semantics.

Resolution must be backward-tested through all affected journeys and kernels before execution planning.
