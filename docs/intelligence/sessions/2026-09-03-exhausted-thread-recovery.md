# KeyFlowOS Exhausted-Thread Recovery — 2026-09-03

Status: HISTORICAL CONTEXT EVIDENCE — PRESERVED

Source: structured recovery packet produced from the prior KeyFlowOS analysis conversation after it reached the conversation-length limit and then supplied by the user to the continuation thread.

Purpose: preserve the prior thread's unique architectural work before canonical reconciliation. This file is intentionally broader than the canonical registers. Statements retain their recovered status and must not be silently promoted from hypothesis/working direction into accepted architecture.

Classification vocabulary used below:

- ESTABLISHED FACT
- IMPLEMENTATION FACT
- ACCEPTED DECISION
- WORKING HYPOTHESIS / WORKING DIRECTION
- OPEN QUESTION
- DEPRECATED / SUPERSEDED
- RECOVERY UNCERTAIN

Governing discipline: evidence -> interpretation -> decision.

---

## A. Exact continuation state

### ESTABLISHED FACT — operating methodology

The prior thread was conducting a forensic, architecture-first reconstruction of `SaCH-PRO/KEYFLOWOS` to build a durable, computable mental/digital model before making architectural changes.

Recovered operating pipeline:

```text
MAP
  -> CROSS-REFERENCE
  -> RE-ANALYZE
  -> CONCEPTUALIZE
  -> VALUE ENGINEER
  -> DESIGN TARGET STATE
  -> BUILD EXECUTION PLAN
  -> EXECUTE
  -> PROVE
  -> INGRAIN INTO KEYFLOWOS
  -> RE-CROSS-REFERENCE
```

Governing repository rule: `MAP BEFORE MODIFYING`.

No production/code modifications had been authorized or made as part of this analysis.

### ACCEPTED DECISION — journey analysis is iterative and bidirectional

Recovered loop:

```text
J1 Business Birth
  -> J2 KEY Request -> Governed Action
  -> back into J1 using J2 findings
  -> revise both
  -> return to J2 as needed
  -> converge
  -> freeze execution packets only after convergence
```

This later evolved into the active mesh:

```text
J1 Business Birth
  <-> J25 Human Authority Lifecycle
  <-> J2 KEY Request -> Governed Action
```

Journeys were not to be treated as independent one-pass analyses. Each journey should expose assumptions in the others.

### ESTABLISHED FACT — work substantially completed before the prior thread ended

1. Macroscopic architecture reconstruction.
2. Initial nine-plane architecture.
3. Canonical state-transition thesis.
4. Business Graph/Genome/Blueprint/Evidence distinctions.
5. Canonical journey programme.
6. Journey dossier schema.
7. Extensive first and second passes through `KF-JOURNEY-001 — Business Birth`.
8. Extensive first and second passes through `KF-JOURNEY-002 — KEY Request -> Governed Action`.
9. Major authority/permission findings feeding backward into J1.
10. Introduction and partial analysis of `KF-JOURNEY-025 — Human Authority Lifecycle`.
11. Cross-journey consolidation around identity, Membership, authority, capability, approvals, clearance, idempotency, execution claims, and provenance.
12. Identification of existing architecture seams worth strengthening rather than replacing.

### ESTABLISHED FACT — exact immediate continuation point

The next convergence pass was to stay inside the J1/J25/J2 mesh and answer three unresolved questions before formally opening J15:

1. Tenant relationship migration:
   `ownerId + Membership -> Membership-first tenancy` without breaking existing ownership semantics/data.
2. Effective authority algebra:
   `base role + JobRole/position + explicit overrides + explicit denials + delegations + approval tier + resource/capability context`.
3. Execution claim convergence:
   `proposal execution + plan execution + BullMQ + direct Flow execution + retries + provider-side idempotency -> one concurrency-safe execution claim / dispatcher path`.

### ACCEPTED DECISION — final direction before prior thread ended

Do not broaden into more journeys yet.

Do not fully open `KF-JOURNEY-015 — Approval / Governance Lifecycle` yet.

First converge:

```text
J1 <-> J25 <-> J2
```

until tenant identity, human authority, capability identity, clearance and execution-claim semantics are stable enough that J15 can analyze approval without redefining its foundations.

---

## B. Recovered accepted decisions and strong directions

### B1 — Journey-first computable architecture analysis

ACCEPTED DECISION: model KeyFlowOS through canonical end-to-end business/user/system journeys rather than merely module-by-module code review.

Rationale: modules hide cross-boundary truths. Journeys reveal UX, authorization, state transitions, mutations, events, AI behavior, failure behavior, and architectural contradictions.

### B2 — Bidirectional journey loop

ACCEPTED DECISION: journey analysis is recursive (`J1 -> J2 -> J1 -> J2`, later `J1 <-> J25 <-> J2`).

Rejected alternative: analyze each journey once in isolation and mark it finished.

### B3 — No code changes until architectural convergence

ACCEPTED DECISION: remain read-only while reconstructing the system. Premature fixes risk hardening incorrect architecture.

### B4 — Architecture Atlas eventually becomes durable project memory

ACCEPTED DIRECTION: analysis must be ingrained into the project so future ChatGPT/Claude/Kimi agents share the same architectural model.

Recovered working target had considered:

```text
architecture/
  atlas/
  knowledge/
  generated/
  journal/
```

But there was also an ACCEPTED DECISION not to freeze the Atlas schema until early journey analysis validated the ontology.

Note: the continuation thread subsequently established `docs/intelligence/` as the durable canonical store; this recovered Atlas structure is historical design evidence rather than the current file-layout decision.

### B5 — Preserve implementation truth over narrative documentation

ACCEPTED DECISION: when maintained narrative documentation conflicts with current code/current behavior, implementation is the stronger evidence of current reality. Generated state, maintained architecture docs, historical plans, product source vision, and implementation must remain distinguishable evidence classes.

### B6 — Strengthen Capability Contract rather than replace it

WORKING DIRECTION, not frozen final decision: `CapabilityContractService` already approximates the desired canonical business-action definition layer. Direction was to avoid an `ActionRegistry2` and make the existing Capability Contract seam load-bearing if validation supports it.

### B7 — Membership remains the tenant relationship

WORKING DIRECTION, not yet frozen: Membership should remain the canonical statement that an authenticated human belongs to a business. Authority should increasingly be derived around Membership rather than repeatedly copied into it.

### B8 — Invitation should become a claim, not a fake User

STRONGLY ESTABLISHED WORKING DIRECTION: target lifecycle should be `Invitation -> authenticated identity proves claim -> Membership`, rather than creating a placeholder/fake User immediately.

### B9 — Hierarchical plan approval

WORKING DIRECTION: an approved plan snapshot may authorize contained child actions only when the exact child capability identities and material parameters are within the approved bounds. Material changes require new clearance.

---

## C. Recovered concepts

### Core architectural thesis

WORKING CANONICAL CONCEPT:

> KeyFlowOS is a governed business-state transition system.

Recovered canonical loop:

```text
External reality
  -> observation
  -> Business Graph
  -> Genome interpretation
  -> KEY reasoning
  -> capability
  -> authority
  -> action
  -> state transition
  -> evidence/outcome
  -> Business Graph
```

### Universal primitives

WORKING CANONICAL CONCEPTS: Fact, Interpretation, Intent, Authority, Transition, Evidence / Outcome.

### Business Graph

REFINED WORKING CANONICAL CONCEPT: the complete factual business state KeyFlowOS can treat as business reality.

Candidate decomposition:

```text
Business Graph
  = Operational Graph
  + Knowledge Graph
  + Evidence Graph
  + Authority Graph
  + Temporal history
```

Distinctions: Business Graph != Genome; Business Graph != Blueprint; Business Graph != Prisma/database tables alone.

### Blueprint

ESTABLISHED CONCEPT: operator declaration/configuration of the business — what founders/operators say or configure about the business.

Not equivalent to observed operational truth, canonical evidence-backed fact resolution, or Genome interpretation.

### Evidence

ESTABLISHED CONCEPT: why a business claim/fact should be believed. Evidence can support verification, confidence, provenance, supersession and readiness.

### Genome

REFINED CONCEPT: what KEY should currently believe about the business, including interpreted business knowledge, confidence, readiness, gaps, stage, actionability and risk.

Not equivalent to raw Business Graph, Blueprint declarations, or generic database state.

### Business Knowledge Kernel

WORKING CANONICAL CONCEPT with four primitives:

- OBSERVATION — something seen, stated or inferred.
- ASSERTION — a source claims a value.
- EVIDENCE — why the assertion should be believed.
- RESOLVED FACT — what KEY currently treats as canonical truth.

Recovered pipeline:

```text
SOURCE
  -> observation/signal
  -> semantic normalization
  -> FactDefinition
  -> assertion
  -> evidence/confidence/verification/freshness/risk
  -> resolution policy
  -> canonical Genome fact
```

### Canonical Fact

WORKING CONCEPT: ontology-defined business fact that may participate in readiness, governance, automation, and business reasoning.

### Contextual Fact / Signal

WORKING CONCEPT: open-world information useful for reasoning but not yet canonical enough to unlock readiness/governance. Contextual signals must not silently unlock operational readiness or autonomous action.

### FactDefinition Registry

WORKING CONCEPT with candidate fields: `key`, `section`, `domain`, `field`, `valueSchema`, `aliases`, `sourceMappings`, `defaultRiskIfWrong`, `freshnessPolicy`, `moduleImpacts`, `readinessImpact`, `verificationPolicy`.

### Fact precedence invariant

WORKING INVARIANT: a weaker assertion must never silently overwrite a stronger verified assertion.

### Readiness Lattice

WORKING CONCEPT with distinct dimensions:

1. Knowledge Readiness
2. Operational Readiness
3. Connectivity Readiness
4. Compliance Readiness
5. Authority Readiness
6. Action Readiness

Recovered synthesis:

```text
Knowledge
  + Operational
  + Connectivity
  + Capability
  + Authority
  + Risk Policy
  -> Action Readiness
```

Critical distinction: `onboardingComplete != Genome healthy != module ready != action authorized != automation safe`.

### Genome Snapshot

WORKING CONCEPT with candidate shape:

```text
GenomeSnapshot {
  knowledgeVersion
  computedAt
  overall
  sections
  confidence
  integrity
  stage
  executiveReadiness
  moduleReadiness
  evidenceHealth
  gaps
}
```

### Business Birth

ESTABLISHED/REFINED CONCEPT: recovered thread described Business Birth as interlocking dimensions of birth and enumerated:

- HUMAN: authentication
- TENANT BIRTH: Business -> Membership -> authority
- KNOWLEDGE BIRTH: Blueprint -> observations -> facts -> evidence -> Genome
- OPERATING BIRTH: products/services/hours/public asset/connectors

Then readiness -> Command Center -> operating business.

Note: recovery source described these as “three interlocking births” while enumerating four categories. Preserve the enumeration; do not rely on the recovered count.

### Membership

REFINED WORKING CONCEPT: `Membership = workspace relationship + base human authority envelope`.

Current implementation also uses Membership as a materialized cache/projection of role/position authority. Unresolved: whether permission/tier fields remain canonical overrides or become derived projections.

### Human Authority Envelope

WORKING CONCEPT: authority associated with a human's Business membership. Inputs include Membership role, `permissionScopes`, `maxApprovalTier`, JobRole/OrgAssignment and possible explicit grants/denials/delegations.

### Effective Authority Resolver

WORKING CONCEPT / MISSING IMPLEMENTATION PRIMITIVE:

```text
principal
  + business
  + Membership
  + role
  + position
  + explicit overrides
  + denials
  + delegations
  + capability
  + resource/context
  -> effective authority
```

No central resolver had been found by the prior analysis.

### Capability

REFINED CONCEPT: a stable business action contract. Existing `CapabilityContractService` projected name, version, owner module, schemas, risk tier, permission, approval requirement, execution mode, idempotency, family, manual equivalent and changed entities.

Invariant direction: capability identity must survive proposal -> approval -> execution.

### Impact Tier vs Control Requirement

WORKING REFINEMENT: distinguish “How impactful is the action?” from “What control does this invocation require?”

Candidate control outcomes included: `AUTO`, `DIRECT_HUMAN`, `QUICK_CONFIRM`, `FORMAL_APPROVAL`, `ADMIN_APPROVAL`, `STEP_UP_AUTH`, `EXPLICIT_DELEGATION`, `BLOCK`.

### Governed Action Envelope

WORKING CONCEPT: normalized action representation containing identity, capability, principal, humanAuthority, parameters, knowledgeContext, operatingContext, policy and clearance. Potential clearance metadata includes decision, requiredApproverTier, confirmationRequirements, ruleTrace, policyVersion, actionFingerprint and expiry. Name was not frozen.

### Action Fingerprint

WORKING CONCEPT: approval should bind to exact material action, approximately hashing business ID, capability name/version, normalized parameters, affected entities and risk tier. Material mutation invalidates prior approval.

### Clearance

WORKING CONCEPT: answers “Is this exact action presently authorized to execute?” It should incorporate capability, principal authority, KEY delegation/autonomy, readiness, policy, approval and current context.

### Execution Claim

WORKING CONCEPT distinct from clearance.

Clearance: this action may execute.

Execution claim: this execution process is the one permitted to consume that clearance.

Target lifecycle:

```text
CLEARANCE GRANTED
  -> atomic claim
  -> CLAIMED
  -> RUNNING
  -> SUCCEEDED / FAILED
```

Designed to address duplicate proposal execution, plan races, queue retry races, idempotency races and crash recovery.

### Hierarchical Clearance

WORKING CONCEPT: parent plan can authorize child actions without repeated approvals if children remain inside exact approved bounds; material changes require new clearance.

### Principal lineage

WORKING CONCEPT: distinguish `requestedBy`, `proposedBy`, `approvedBy`, `executedBy`, `executedFor`, `delegatedBy` rather than collapsing identity into a single actor.

### Human authority vs KEY autonomy

ESTABLISHED DISTINCTION: human permission and KEY autonomy are separate systems. A human's authority to perform an action is not equivalent to KEY's delegation to autonomously perform it.

### AuthorityGrant

WORKING CONCEPT: existing model is useful but semantically incomplete. Desired dimensions: grantor, grantee, capability/scope, bounds, valid time and revocation. Invariant: `grant <= grantor's grantable authority`.

### Synthetic data classification

WORKING CONCEPT: persisted onboarding/demo data must not silently contaminate financial truth, Business Graph learning, Genome or analytics. Candidate universal classification includes `REAL`, `SYNTHETIC`, etc.

### Activation Proof / First Live Asset

WORKING CONCEPT: Business Birth should expose tangible value early. Existing storefront capability suggested a path from template configured -> preview/live asset card -> preview/copy/publish/share -> first real value.

---

## D. Recovered macroscopic model

### Nine architecture planes

WORKING MACRO MODEL:

1. Experience Plane
2. Business Semantic Model
3. Business Capability Fabric
4. KEY Intelligence
5. Authority & Governance
6. Domain Execution
7. Coordination / Flow / Time
8. Business State / Operational Graph
9. Integration / Infrastructure

Outside these: Engineering Control Plane.

### Refined causal architecture

```text
REAL WORLD / EXTERNAL SYSTEMS
  -> OBSERVATION
  -> BUSINESS GRAPH          "What is true?"
  -> GENOME                  "What does it mean?"
  -> KEY                     "What should happen?"
  -> CAPABILITY              "What action exists?"
  -> AUTHORITY + POLICY + READINESS  "May it happen?"
  -> CLEARANCE
  -> EXECUTION CLAIM
  -> EXECUTION
  -> BUSINESS STATE TRANSITION
  -> EVENT / EVIDENCE / OUTCOME
  -> BUSINESS GRAPH
  -> GENOME EVOLUTION
```

Major conceptual refinement: move from thinking primarily in modules/services/controllers/AI/database toward facts/authority/capabilities/state transitions/evidence/journeys.

Founding modularity principle preserved: isolation is the build strategy; seamless integration is the user-facing outcome.

Founding AI loop `Observe -> Plan -> Create -> Act -> Learn` was refined so “Act” becomes governed through capability -> authority -> policy -> clearance -> execution -> outcome.

---

## E. Recovered microscopic / computable model

Primary unit: Journey dossier.

Recovered dossier dimensions:

A. Definition
B. Product Intent
C. Actors
D. Entry Surfaces
E. State Machine
F. Frontend Path
G. API Path
H. Backend Chain
I. Data Mutation Ledger
J. Tenant / Identity
K. Events / Coordination
L. KEY / AI
M. Capability Mapping
N. Authority / Governance
O. Blueprint / Graph / Genome
P. Invariants
Q. Failure Matrix
R. Idempotency / Transactions / Concurrency
S. Security / Privacy
T. Observability
U. Proof / Test
V. Reachability
W. Duplication
X. Architecture Alignment
Y. Contradictions
Z. Unknowns
AA. Findings
AB. Canonical Journey Graph
AC. Machine-readable record

Additional recovered rules:

- Model journeys as explicit state transitions including invalid transitions, bypasses, transactions, asynchronous state and stale states.
- Frontend analysis includes route/component, trigger, browser workspace context, UX gates, discarded backend results and user-visible activation proof.
- API analysis records endpoint, guards, principal, business binding, input/DTO, service and result.
- Backend analysis traces Controller -> Guard -> Service -> Orchestrator -> Policy -> Capability -> Domain Service -> DB/external integration.
- Data mutation ledger records model/table reads/creates/updates/deletes, side effects, transaction membership, async writes, cache invalidation and projections.
- Tenant/identity analysis records external auth identity, local User, Business, Membership, owner semantics, active workspace, multi-business selection, invited vs founder and principal provenance.
- Event analysis tracks payload identity, consumers, commit semantics, sync/async behavior and duplicate/lost-event risk.
- KEY analysis distinguishes observation, reasoning, proposal, capability selection, governance, approval, execution and learning.
- Governance analysis asks: who requested, who proposed, who may approve, which capability/risk/policy/evidence/readiness/delegation applies, what exact action was approved, and who executes.
- Failure matrix includes validation, authorization, stale data, duplicate request, concurrency race, connector failure, partial transaction, timeout, policy change, revocation, retry and compensation failure.
- Test/proof model distinguishes implementation exists, test source exists, test currently passes, runtime behavior reproduced, and generated registry reports state.
- Reachability distinguishes mounted/reachable, UI-linked, called by code, externally callable, orphaned, legacy and compatibility-only. Non-navigation does not automatically imply dead code.

---

## F. Recovered canonical journey programme

High-confidence recovered programme:

1. `KF-JOURNEY-001 — Business Birth`
2. `KF-JOURNEY-002 — KEY Request -> Governed Action`
3. `KF-JOURNEY-003 — Lead -> Customer -> Cash`
4. `KF-JOURNEY-004 — Booking -> Service -> Payment`
5. `KF-JOURNEY-005 — Conversation -> Business Action`
6. `KF-JOURNEY-006 — Proactive KEY / Autonomy`
7. `KF-JOURNEY-007 — Financial Truth`
8. `KF-JOURNEY-008 — Project / Work Delivery`
9. `KF-JOURNEY-009 — Marketing -> Lead Generation`
10. `KF-JOURNEY-010 — Commerce / Fulfilment`
11. `KF-JOURNEY-011 — Contract -> Obligation -> Renewal`
12. `KF-JOURNEY-012 — Document / Evidence Lifecycle`
13. `KF-JOURNEY-013 — Connector Lifecycle`
14. `KF-JOURNEY-014 — Webhook / External Event Ingress`
15. `KF-JOURNEY-015 — Approval / Governance Lifecycle`
16. `KF-JOURNEY-016 — Business Genome Evolution`
17. `KF-JOURNEY-017 — Command Center -> Priority -> Action`
18. `KF-JOURNEY-018 — Failure -> Recovery`
19. `KF-JOURNEY-019 — Privacy / Deletion / Exit`
20. `KF-JOURNEY-020 — Plan / Subscription / AI Cost`
21. `KF-JOURNEY-021 — Public Customer Experience`
22. `KF-JOURNEY-022 — KEY Voice`
23. `KF-JOURNEY-023 — Temporal Flow / Long-Running Workflow`
24. `KF-JOURNEY-024 — System Change / Engineering Safety`
25. `KF-JOURNEY-025 — Human Authority Lifecycle`

J25 was introduced after J1/J2 findings established that human authority required its own first-class journey before J15.

Working cross-cutting kernels recovered:

- Tenant / Identity Kernel
- Knowledge Kernel
- Genome / Readiness Kernel
- Capability Kernel
- Authority Kernel
- Governance / Clearance Kernel
- Execution Claim / Idempotency Kernel
- Evidence / Outcome Kernel

These kernel names were working groupings rather than confirmed frozen official identifiers.

---

## G. Recovered KF-JOURNEY-001 — Business Birth state

### Intended scope

Unknown/prospective human -> authentication -> local identity -> tenant/workspace -> onboarding -> business knowledge creation -> configuration -> readiness -> onboarding completion -> operating Command Center.

### Implemented high-level spine recovered

```text
PROSPECT
  -> /auth/signup
  -> POST /identity/signup
  -> Supabase auth
  -> authenticated external identity
  -> POST /identity/bootstrap
  -> local User
  -> Business
  -> OWNER Membership
  -> active business/workspace
  -> /app
  -> onboarding gate
       incomplete -> /app/onboarding
       complete   -> /app/command-center
```

### Onboarding flow recovered

```text
/app/onboarding
  -> persistent KEY onboarding session
  -> welcome
  -> intake
  -> business description
  -> ModelGateway / Genesis extraction
  -> preview/review
  -> BusinessBlueprint mutation
  -> selected Business-field mirroring
  -> compliance/projection/readiness
  -> GenomeFact + GenomeEvidence attempts
  -> template selection
  -> configure products/hours/payments/storefront/contacts
  -> Blueprint/Genome reconciliation
  -> DNA/integrity/stage/readiness
  -> Three-Pillar Minimum
  -> markOnboardingComplete()
  -> onboardingComplete=true
  -> completedAt
  -> demo seed / milestone / legal side effects
  -> /app/command-center
```

### Recovered state machine

`S0 PROSPECT`
`S1 AUTH_PROVISIONED`
`S2 AUTHENTICATED`
`S3 LOCAL_IDENTITY_READY`
`S4 TENANT_READY`
`S5 ONBOARDING_WELCOME`
`S6 ONBOARDING_INTAKE`
`S7 BUSINESS_CONCEPT_CAPTURED`
`S8 BLUEPRINT_POPULATING`
`S9 TEMPLATE_SELECTED`
`S10 BUSINESS_CONFIGURING`
`S11 GENOME_MINIMUM_PENDING`
`S12 THREE_PILLAR_MINIMUM_MET`
`S13 ONBOARDING_COMPLETE`
`S14 OPERATING`

Observed onboarding order: `welcome -> intake -> template -> configure -> complete`.
Legacy aliases: `genesis -> intake`; `genome -> configure`.
`saveStep('complete')` was intentionally rejected; `markOnboardingComplete()` owns completion.
Three-Pillar threshold recovered as founder >= 50, business >= 50, market >= 50.

### Relevant repository areas recovered

- `apps/server/src/modules/identity/`
- `apps/server/src/modules/blueprint/`
- `apps/server/src/modules/business-genome/`
- `apps/server/src/modules/onboarding-concierge/`
- `apps/server/src/modules/business-genesis/`
- `apps/server/src/modules/ai/`
- `apps/server/src/modules/key-cortex/`
- `apps/server/src/modules/structure/`
- `apps/web/src/lib/workspace.ts`
- `apps/web/src/app/app/onboarding/`

### Recovered J1 open questions

- What is the single canonical Tenant Genesis command?
- Should `Business.ownerId` remain authoritative or become compatibility metadata around Membership?
- How should existing businesses migrate to Membership-first discovery?
- How should invitation authority be represented before identity exists?
- What is the canonical business-knowledge write boundary?
- How much Genome completeness is required to leave onboarding?
- What readiness is onboarding responsible for versus later progressive completion?

Working hypothesis: the first customer-visible asset should appear earlier than full Genome completion.

---

## H. Recovered implementation findings

The following are preserved as historical investigation findings. Current code should be rechecked before implementation work.

### H1 — Multiple Business creation paths

IMPLEMENTATION FACT: multiple Business creation paths existed, including `IdentityService.createBusiness`, `IdentityService.bootstrapUser`, and a tRPC identity/business creation path. At least some paths did not create OWNER Membership consistently.

INTERPRETATION: Business creation lacked one canonical Tenant Genesis command.

ARCHITECTURAL IMPLICATION: Business + founding authority baseline should become one invariant.

### H2 — listBusinesses ownership semantics

IMPLEMENTATION FACT: `IdentityService.listBusinesses(userId)` was owner-oriented rather than purely Membership-oriented.

INTERPRETATION: workspace discovery and authorization used different tenancy concepts.

IMPLICATION: converge tenant discovery on Membership while preserving explicit owner semantics where needed.

### H3 — BusinessGuard vs ModuleScopeGuard

IMPLEMENTATION FACT: BusinessGuard allowed roughly SUPER_ADMIN OR `Business.ownerId` OR Membership, while ModuleScopeGuard depended on Membership scopes.

INTERPRETATION: an owner without proper Membership could pass tenant access but fail scoped endpoints.

IMPLICATION: tenant relationship and authority baseline need one coherent invariant.

### H4 — Invitation placeholder User defect

IMPLEMENTATION FACT: `IdentityService.inviteTeamMember()` created a local User for an invited email when none existed, then Membership. Later bootstrap reconciled by authenticated external user ID rather than claiming that invited placeholder; duplicate email could yield `account_email_conflict`.

INTERPRETATION: “person invited” and “authenticated identity exists” were incorrectly collapsed.

IMPLICATION: first-class Invitation claim lifecycle.

### H5 — Workspace storage

IMPLEMENTATION FACT: `apps/web/src/lib/workspace.ts` stored active workspace via `kf_business_id` in localStorage/cookie; `ensureWorkspace()` and `refreshWorkspace()` called bootstrap and selected returned business.

INTERPRETATION: browser workspace ID is selection state, not authorization.

IMPLICATION: multi-business selection should restore/select among authorized Memberships.

### H6 — No first-class switcher found

IMPLEMENTATION FACT: no mature multi-business workspace selector had been identified.

INTERPRETATION: product behaved largely as though one active business were dominant.

IMPLICATION: expose selection when multiple Memberships exist.

### H7 — Business-definition mutation under-scoped

IMPLEMENTATION FACT: ordinary Business members could reach multiple Blueprint/onboarding/Genesis/Genome mutation surfaces.

INTERPRETATION: contribution and canonical truth mutation were insufficiently distinguished.

IMPLICATION: low-authority contributions should often become signals/proposals rather than direct canonical fact mutation.

### H8 — GenomeFactService precedence/ontology weakness

IMPLEMENTATION FACT: no strong central ontology normalization/validation boundary identified; a weaker incoming write could replace value/source while stronger verification metadata remained.

INTERPRETATION: value precedence and verification provenance could diverge.

IMPLICATION: assertion-resolution policy and semantic normalization.

### H9 — Noncanonical Genome producers

IMPLEMENTATION FACT: variant producers included Genesis, device visual intake, Temporal Flow, Key Inbox and conversation extraction; section/name normalization was inconsistent.

IMPLICATION: canonicalize the signal -> Fact boundary.

### H10 — Genome scoring inconsistency

IMPLEMENTATION FACT: `GenomeScoringService` and `KeyGenomeService` did not resolve Blueprint fallback/fact scoring identically; unknown sections participated differently.

IMPLICATION: one resolved-section model should feed all Genome scoring.

### H11 — Blueprint update ordering

IMPLEMENTATION FACT: `BlueprintService.updateBlueprint()` could calculate scoring/readiness before asynchronous fact backfill reconciled the Blueprint.

IMPLICATION: Blueprint -> fact -> Genome transition needs coherent commit/recompute semantics.

### H12 — genesisCompleted lifecycle weakness

IMPLEMENTATION FACT: observed default/expression behavior made `genesisCompleted` effectively remain false in common cases.

IMPLICATION: explicit transition command should own lifecycle state.

### H13 — Legacy BusinessGenome

IMPLEMENTATION FACT: parallel mutable `BusinessGenome` representation remained live in Cortex alongside modern GenomeFact architecture.

IMPLICATION: compatibility projection or migration only after consumer proof.

### H14 — BusinessGuidanceProfile

IMPLEMENTATION FACT: still used as live AI/document context source.

IMPLICATION: consumer-driven migration; do not delete first.

### H15 — Module readiness weakness

IMPLEMENTATION FACT: `GenomeModuleReadinessService` relied strongly on fact-address presence/heuristics and did not robustly incorporate nonempty value, confidence, verification, evidence, freshness or dispute state.

INTERPRETATION: `automationAllowed` could overstate what had been proven.

IMPLICATION: separate knowledge prerequisites from final execution authorization.

### H16 — Synthetic onboarding data contamination

IMPLEMENTATION FACT: demo/synthetic onboarding rows could enter Cortex context and some operational counts.

IMPLICATION: classify and exclude synthetic data from truth-dependent analytics by default.

### H17 — Storefront first-value opportunity

IMPLEMENTATION FACT: template configuration could create/configure a storefront slug/public booking surface, but frontend did not prominently expose the result before advancing.

IMPLICATION: expose first customer-visible activation proof earlier.

### H18 — KeyActionProposalController authorization gap

IMPLEMENTATION FACT: `apps/server/src/modules/key-autonomy/key-action-proposal.controller.ts` used AuthGuard, BusinessGuard and ModuleScopeGuard, but approve/reject/cancel/execute routes lacked explicit `@RequireModuleScope(...)`; ModuleScopeGuard was inert without scope metadata.

IMPLICATION: one central human approval authority resolver.

### H19 — Proposal numeric risk mismatch

IMPLEMENTATION FACT: proposal had `riskLevel: LOW|MEDIUM|HIGH|CRITICAL` but no canonical numeric `riskTier`; compatibility code could use `proposal.riskTier ?? 2`.

IMPLICATION: capability identity should own canonical impact classification.

### H20 — EXECUTE_TOOL capability identity collapse

IMPLEMENTATION FACT: high-risk plan steps could be wrapped as generic `actionType = EXECUTE_TOOL` with underlying `toolName` and args. Example recovered: `payments_refund_charge` was a real Tier-3/high Flow tool.

INTERPRETATION: proposal governance could see generic wrapper rather than underlying capability.

INVARIANT DIRECTION: THE THING APPROVED = THE THING EXECUTED.

### H21 — Capability Contract non-load-bearing

IMPLEMENTATION FACT: `CapabilityContractService` projected Flow tools into a strong platform capability definition but had little meaningful execution consumption.

IMPLICATION: operationalize/reuse rather than replace if current validation confirms.

### H22 — AiOversight role ceiling strength

IMPLEMENTATION FACT: `AiOversightService` clamped business autonomy by KEY role; for multi-role crew, effective ceiling used the minimum among roles granting a tool rather than maximum.

IMPLICATION: preserve non-escalation pattern.

DISTINCTION: KEY-role governance != human Membership authorization.

### H23 — Parallel governance regimes

IMPLEMENTATION FACT: paths such as GraphActionsController, FlowOrchestrator, ActionDispatcherService, KeyActionProposal/KeyCortex and PlanExecutor/queue did not all use one governance stack.

IMPLICATION: converge on common capability/authority/clearance boundary.

### H24 — GraphActionsController execution semantics

IMPLEMENTATION FACT: evaluated AI oversight then could directly execute Flow; human Membership permission was not consistently integrated.

IMPLICATION: separate human capability authorization from KEY autonomy.

### H25 — ActionDispatcherService

IMPLEMENTATION FACT: useful concerns already present — retries, circuit breaker, idempotency key, execution logging, undo registration and feedback integration — but decision handling did not itself enforce every approval-required condition.

IMPLICATION: potential post-clearance executor, not presently a safe clearance boundary.

### H26 — Flow chat confirmation binding

IMPLEMENTATION FACT: `/ai/businesses/:businessId/flow/confirm` accepted client-supplied tool call ID/name/args/confirmed; FlowOrchestrator re-evaluated governance against supplied real tool and routed formal/admin actions to approval. However it did not prove confirmation matched an immutable server-stored pending action.

INTERPRETATION: narrower confirmation/action-binding integrity weakness, not fully ungoverned arbitrary action.

### H27 — Plan approval provenance

IMPLEMENTATION FACT: AiPlan stored requesting user ID; approval used approver identity for auth but primarily persisted status rather than full principal lineage.

IMPLICATION: typed requestedBy/approvedBy/etc provenance.

### H28 — Tier-4-only strong plan approval check

IMPLEMENTATION FACT: strong OWNER/ADMIN-like check was specific to max tier >= 4; lower-risk plans did not receive equivalent Membership approval-tier enforcement.

IMPLICATION: one authority model across approval surfaces.

### H29 — Direct plan executor

IMPLEMENTATION FACT: direct plan execution required status approved; formal-approval-required children created approval items while Tier-2 quick confirmations were treated as implicitly satisfied by plan approval.

IMPLICATION: hierarchical clearance with immutable parent-child bounds.

### H30 — Plan execution race

IMPLEMENTATION FACT: `plan.approved` could trigger queued PlanExecutor work while a direct Flow plan endpoint could separately start the same approved plan; no clear single-winner CAS claim was identified.

IMPLICATION: Execution Claim Kernel.

Status: code-level concurrency weakness; no runtime reproduction claimed.

### H31 — Proposal state transition race

IMPLEMENTATION FACT: proposal transitions often used read-status then update-by-ID rather than atomic compare-and-set.

IMPLICATION: atomic state transitions/version checks.

### H32 — KeyIdempotencyService weakness

IMPLEMENTATION FACT: durable idempotency existed, but an existing pending key could be treated as new; requestHash equality was not robustly enforced.

IMPLICATION: idempotency != single-executor claim.

### H33 — SafetyShell

IMPLEMENTATION FACT: process-local in-memory idempotency and limited rollback/compensation wiring.

IMPLICATION: useful local tripwire, not distributed safety guarantee.

### H34 — KeyAutonomySafetyService scope

IMPLEMENTATION FACT: kill switch, daily autonomous action limit, spend cap and max tier without approval existed, but primarily in Cortex-oriented execution rather than universally across Flow direct execution.

IMPLICATION: common clearance boundary should consume control policy.

### H35 — BusinessAutonomyProfile write protection

IMPLEMENTATION FACT: class-level AuthGuard + BusinessGuard existed; autonomy-profile PATCH lacked stronger explicit authority requirements.

IMPLICATION: control-plane mutation authority must be at least as strong as behavior it enables.

### H36 — AuthorityGrant

IMPLEMENTATION FACT: grantor/grantee/scope/maxAmount/validity shape existed, but grantor identity could be caller-supplied and runtime did not fully enforce bounds such as maxAmount.

IMPLICATION: keep concept, strengthen provenance/bounds.

### H37 — JobRole -> Membership copying

IMPLEMENTATION FACT: structure assignment could write JobRole-derived permissions/approval tier into Membership.

INTERPRETATION: Membership acted as relationship + base authority + copied role projection.

IMPLICATION: derive effective authority rather than destructive/copy-based merging.

---

## I. Recovered finding register IDs

Journey-1 finding IDs confidently recovered:

- F003 ownerId and OWNER Membership dual authority
- F004 explicit createBusiness lacks OWNER Membership
- F005 bootstrap/explicit create different initialization
- F006 discovery owner-based vs access Membership
- F007 generic onboardingComplete patch bypass
- F008 Blueprint->Genome stale projection
- F009 genesisCompleted ineffective
- F010 BusinessGenome parallel mutable
- F011 heuristic source->canonical mapping
- F012 live BusinessGuidanceProfile
- F013 incoherent Blueprint/fact score
- F014 Command Center cached/fresh mixture
- F015 tests don't prove Blueprint->ontology compatibility
- F016 payment recommendation masquerades as config
- F017 readiness mixes domains
- F018 synthetic contamination VERIFIED
- F019 first-value capability exists; activation weak
- F020 business self-model mutation authority under-scoped
- F021 missing central semantic fact normalization
- F022 module readiness address-presence only
- F023 some KEY execution trusts weak module readiness
- F024 tRPC underinitialized tenant creation
- F025 no reliable Business lifecycle creation event
- F026 weaker fact can replace value while retaining stronger verification state
- F027 demo invoice affects Cortex and latent ecommerce inference
- F028 fresh Business can have modern Genome but no legacy BusinessGenome

Journey-2 provisional findings confidently recovered:

- F029 canonical proposal controller approval/execution under-authorized
- F030 approval confirmation booleans can be hard-coded instead of evidence-backed
- F031 proposal/execution actor provenance drift
- F032 parallel governance regimes
- F033 generic EXECUTE_TOOL loses underlying capability identity/risk
- F034 payments_refund_charge Tier 3 -> generic wrapper risk collapse
- F035 CapabilityContract exists but is non-load-bearing
- F036 AI approval resolver and proposal controller use different human authority semantics
- F037 canonical proposal has riskLevel but no riskTier; resolver may default Tier 2
- F038 plan approval only strongly enforces role for Tier 4
- F039 canonical AI_PLAN proposal approval can re-enter evaluation/re-proposal
- F040 ActionDispatcher ignores approval-required flags as standalone boundary
- F041 proposal transition concurrency weakness / no CAS
- F042 SafetyShell in-memory idempotency and weak compensation
- F043 ordinary Flow direct execution does not universally pass KeyAutonomySafety

RECOVERY UNCERTAIN: later issues were discovered but no historical F-number should be invented without source recovery. These included invitation placeholder identity/email conflict, JobRole authority copying, direct plan executor vs PlanExecutor race, hierarchical plan approval ambiguity, chat confirmation binding weakness, and autonomy-profile under-authorization.

---

## J. Recovered contradiction register IDs

- C005 founding Membership discovery vs ownerId
- C006 founding Business+OWNER Membership invariant vs partial creation paths
- C007 completion transition command vs generic Business patch
- C008 modern Genome truth vs legacy BusinessGenome
- C009 Blueprint vs BusinessGuidanceProfile
- C010 canonical ontology vs source-specific fact producers
- C011 stale Genome roadmap vs implemented Genome kernel
- C012 Membership grants business-definition mutation despite differentiated roles
- C013 module automationAllowed naming vs weak implementation
- C014 BusinessGenome/Cortex vs modern Genome divergence
- C015 synthetic data treated as live by some intelligence
- C016 first live asset exists but activation proof discarded
- C017 canonical approval claim vs multiple authority regimes
- C018 real capability risk vs generic proposal-wrapper risk
- C019 Capability Contract claims platform contract but execution does not consume it
- C020 approval state != portable clearance
- C021 Membership has approval primitives but many approval surfaces do not consistently consume them

---

## K. Recovered recommendation register

The following J1 recommendation IDs were recoverable, but were explicitly provisional and subject to J2/J25 revision:

- `KF-REC-001` One canonical Tenant Genesis entry point
- `KF-REC-002` Membership-first workspace resolution
- `KF-REC-003` Repair invitation provisioning/landing
- `KF-REC-004` Capability-scoped Business self-model authority
- `KF-REC-005` Onboarding completion as single transition command
- `KF-REC-006` Canonical FactDefinition/normalization boundary
- `KF-REC-007` Fact assertion precedence/conflict resolution
- `KF-REC-008` Reconcile Genome scoring through one section-resolution model
- `KF-REC-009` Canonical Genome Snapshot
- `KF-REC-010` Trust-aware knowledge/module readiness
- `KF-REC-011` Separate knowledge readiness from final action authority
- `KF-REC-012` BusinessGenome compatibility projection
- `KF-REC-013` BusinessGuidanceProfile consumer migration
- `KF-REC-014` Synthetic examples out of canonical operational truth
- `KF-REC-015` Live storefront as Business Birth activation proof
- `KF-REC-016` Explicit lifecycle events
- `KF-REC-017` Architecture provenance/supersession metadata
- `KF-REC-018` Retire ineffective lifecycle concepts only after consumer proof

Recovered later semantic revisions:

- KF-REC-001 should include the founding OWNER authority envelope.
- KF-REC-004 should converge on platform capability/principal-authority integration rather than isolated onboarding permission names.
- KF-REC-011 depends directly on J2 clearance/governed-action architecture.
- Invitation recommendations must preserve intended scopes/maxApprovalTier and move toward first-class invitation claim lifecycle.

Exact final recommendation wording was not frozen.

---

## L. Critical unresolved convergence questions at recovery

### Tenant authority

How should `Business.ownerId` coexist with Membership after migration, including existing data and ownership semantics?

### Invitation

How should existing placeholder invitation Users be migrated without breaking real users?

### Authority source precedence

What sources may expand authority and which may only narrow it?

Candidate sources: Membership role, JobRole, explicit override, explicit denial, delegation, AuthorityGrant, approval tier and resource/capability context.

No final algebra frozen.

### Capability permission vocabulary

How should coarse module scopes map to fine-grained Capability Contract permissions?

### Approval invalidation

What changes invalidate clearance/approval? Candidates included capability version, parameters, amount, recipient/entity, authority revocation, policy version, readiness change, connector state and expiry.

### Execution gateway

Should `ActionDispatcherService` become the canonical post-clearance executor? Direction favorable but not frozen.

### Plan execution

Should direct synchronous Flow plan execution remain after queue path convergence?

### Approval architecture

J15 intentionally remained closed until authority/clearance foundations stabilize.

---

## M. Recovered methodological rules

1. MAP BEFORE MODIFYING.
2. Preserve evidence taxonomy: IMPLEMENTATION FACT, TEST SOURCE, GENERATED STATE, MAINTAINED ARCHITECTURE DOC, HISTORICAL/STALE DOC, PRODUCT SOURCE, INFERENCE, WORKING HYPOTHESIS, UNVERIFIED LEAD.
3. Code/current behavior is stronger evidence of implementation reality than conflicting narrative docs.
4. Do not claim tests were run unless actually executed.
5. Commit-sensitive implementation claims must be rechecked against the current default branch before implementation decisions.
6. Do not call code dead merely because UI navigation does not link it; classify mounted/reachable/consumed/UI-linked/orphaned/legacy/compatibility.
7. Findings lifecycle: PROVISIONAL -> VERIFIED -> RE-ANALYZED -> strengthened/narrowed/unchanged/superseded/refuted.
8. Preserve evidence -> interpretation -> decision.
9. Prefer strengthening existing seams before inventing parallel v2 systems.
10. Progressive canonicalization only after implementation evidence + cross-journey validation + contradiction resolution + target-state convergence.
11. Legacy residue must be classified and consumer-proven before retirement.
12. Architecture Atlas/rules for coding agents were intended eventually, but exact Atlas schema was deferred.

---

## N. Deprecated / superseded assumptions

Do not resume analysis from these simplified assumptions:

- Business Graph = database
- Membership = mere relationship
- Genome readiness = action authorization
- module `automationAllowed` = safe autonomous execution
- proposal approved = action safely cleared
- idempotency key = execution claim
- KEY role governance = human authority
- plan approved = every future child action automatically authorized
- Invitation = create a User now

All were materially refined or rejected.

---

## O. Continuation anchor recovered from the prior thread

Active journey mesh:

```text
KF-JOURNEY-001 — Business Birth
        <->
KF-JOURNEY-025 — Human Authority Lifecycle
        <->
KF-JOURNEY-002 — KEY Request -> Governed Action
```

Immediate convergence:

A. `ownerId + Membership -> safe Membership-first tenant relationship model`

B. `role + JobRole + override + denial + delegation + tier -> Effective Authority algebra`

C. `proposal + plan + queue + Flow + retries + idempotency -> atomic Execution Claim + canonical post-clearance dispatcher`

Then:

```text
re-run J1/J25/J2 convergence
  -> perform J15 admission review
  -> only open KF-JOURNEY-015 if prerequisites are stable
```

No code changes until that convergence is accepted.

---

## P. Recovery uncertainty

- Exact full historical conversation transcript is not preserved here.
- Original 24-journey programme and J25 identity are high-confidence recovered content.
- No journey identifier beyond J25 should be inferred from this recovery.
- Finding IDs are confidently recovered through F043. Later issues must not receive invented historical F-numbers.
- Exact final wording of J2/J25-updated recommendations was not frozen.
- The source thread reportedly referenced default branch `2c3da5d...` at a later point; all commit-sensitive code facts must be revalidated against the current repository before execution planning.

END OF PRESERVED RECOVERY SOURCE
