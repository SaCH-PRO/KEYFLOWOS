# KeyFlowOS Finding Register

Status: ACTIVE EVIDENCE/ANALYSIS REGISTER

Purpose: track material findings discovered during journey/domain analysis without prematurely converting them into architectural decisions.

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

## KF-JOURNEY-001 recovered findings

### F003 — ownerId and OWNER Membership dual authority

**Status:** RECOVERED / NEEDS CURRENT REVALIDATION

Implementation reality historically used both `Business.ownerId` and OWNER Membership as material authority/relationship concepts.

Implication: tenant identity and authority baseline require explicit convergence.

### F004 — Explicit createBusiness lacks OWNER Membership

**Status:** RECOVERED / NEEDS CURRENT REVALIDATION

At least one explicit business-creation path historically created Business without equivalent founding OWNER Membership.

### F005 — bootstrap and explicit create have different initialization

**Status:** RECOVERED / NEEDS CURRENT REVALIDATION

Business creation/bootstrap paths did not share one semantic initialization contract.

### F006 — discovery owner-based vs access Membership-based

**Status:** RECOVERED / NEEDS CURRENT REVALIDATION

Workspace/business discovery and scoped access used different tenant concepts.

### F007 — generic onboardingComplete patch bypass

**Status:** RECOVERED / REVALIDATE CURRENT CODE

A generic Business mutation path historically could bypass the dedicated onboarding-completion transition and associated gates/side effects.

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

Some business-knowledge producers used heuristic/source-specific mapping rather than a universal ontology normalization boundary.

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

Readiness logic conflated distinct knowledge/operational/connectivity/compliance/authority/action dimensions.

This finding directly informed the Readiness Lattice concept.

### F018 — synthetic contamination

**Status:** RECOVERED AS VERIFIED HISTORICAL FINDING / REVALIDATE CURRENT CODE

Synthetic/demo onboarding data entered some intelligence/operational contexts as if live.

### F019 — first-value capability exists; activation weak

**Status:** RECOVERED / PRODUCT FINDING

Storefront/public-asset machinery existed during onboarding but the UX did not prominently surface it as early activation proof.

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

Working invariant response: a weaker assertion must never silently overwrite a stronger verified assertion.

### F027 — demo invoice affects Cortex and latent ecommerce inference

**Status:** RECOVERED / SYNTHETIC-DATA CONCERN

Synthetic demo commerce state could influence intelligence/business inference.

### F028 — fresh Business can have modern Genome but no legacy BusinessGenome

**Status:** RECOVERED / COMPATIBILITY CONCERN

Fresh tenant state could diverge between modern GenomeFact-based and legacy BusinessGenome consumers.

---

## KF-JOURNEY-002 recovered findings

### F029 — canonical proposal controller approval/execution under-authorized

**Status:** RECOVERED / NEEDS CURRENT REVALIDATION

Proposal approval/execution routes historically did not consistently enforce fine-grained human approval authority.

### F030 — approval confirmation booleans can be hard-coded instead of evidence-backed

**Status:** RECOVERED / NEEDS CURRENT REVALIDATION

Some confirmation/approval conditions were represented as booleans without durable evidence binding.

### F031 — proposal/execution actor provenance drift

**Status:** RECOVERED / ACTIVE PRINCIPAL-LINEAGE CONCERN

Requested/proposed/approved/executed identities could collapse or be lost across transitions.

### F032 — parallel governance regimes

**Status:** RECOVERED / ACTIVE CONVERGENCE CONCERN

GraphActions, Flow, proposals/Cortex, ActionDispatcher, plan execution and queue paths did not share one governance stack.

### F033 — generic EXECUTE_TOOL loses underlying capability identity/risk

**Status:** RECOVERED / ACTIVE CAPABILITY-INTEGRITY CONCERN

Generic wrappers could obscure the real capability being approved/executed.

### F034 — payments_refund_charge Tier 3 → generic wrapper risk collapse

**Status:** RECOVERED CONCRETE EXAMPLE / REVALIDATE CURRENT CODE

A high-impact refund capability was historically capable of being represented under generic EXECUTE_TOOL proposal semantics.

### F035 — CapabilityContract exists but is non-load-bearing

**Status:** RECOVERED / FAVORABLE EXISTING-SEAM FINDING

`CapabilityContractService` approximated the desired canonical capability layer but execution paths did not consistently consume it.

### F036 — AI approval resolver and proposal controller use different human authority semantics

**Status:** RECOVERED / ACTIVE J25/J2 CONCERN

Different approval/governance surfaces interpreted human authority differently.

### F037 — proposal has riskLevel but no canonical riskTier; resolver may default Tier 2

**Status:** RECOVERED / NEEDS CURRENT REVALIDATION

Proposal-level risk representation and numeric tier semantics could diverge.

### F038 — plan approval only strongly enforces role for Tier 4

**Status:** RECOVERED / ACTIVE AUTHORITY CONCERN

Lower-tier plans historically lacked equivalent fine-grained Membership approval-tier enforcement.

### F039 — canonical AI_PLAN proposal approval can re-enter evaluation/re-proposal

**Status:** RECOVERED / NEEDS CURRENT REVALIDATION

Approval/execution transitions could loop back through governance rather than consume a stable clearance artifact.

### F040 — ActionDispatcher ignores approval-required flags as standalone boundary

**Status:** RECOVERED / FAVORABLE EXISTING-SEAM BUT NOT CLEARANCE BOUNDARY

Dispatcher had strong execution mechanics but could not independently guarantee that all required approvals/controls had been satisfied.

### F041 — proposal transition concurrency weakness / no CAS

**Status:** RECOVERED / ACTIVE EXECUTION-CLAIM CONCERN

Proposal state changes historically used read-then-update patterns rather than atomic expected-state transitions.

### F042 — SafetyShell in-memory idempotency and weak compensation

**Status:** RECOVERED / NEEDS CURRENT REVALIDATION

SafetyShell was a local safeguard, not a distributed execution guarantee.

### F043 — ordinary Flow direct execution does not universally pass KeyAutonomySafety

**Status:** RECOVERED / ACTIVE GOVERNANCE-CONVERGENCE CONCERN

Global-sounding autonomy safety controls were not universally consumed by every direct execution path.

---

## Later recovered findings without historical IDs

These are preserved without inventing F-numbers:

- invitation placeholder User / authenticated identity collision
- JobRole authority copied/materialized into Membership
- direct Flow plan executor vs PlanExecutor/queue execution race
- hierarchical plan approval lacks immutable parent-child clearance binding
- Flow confirmation not bound to immutable server-side pending action
- BusinessAutonomyProfile/control-plane mutation may be under-authorized

If future analysis confirms them, assign **new current IDs**, not fabricated historical IDs.
