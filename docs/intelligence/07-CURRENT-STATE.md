# KeyFlowOS Current State

Last updated: 2026-09-03

## Analytical phase

`COMPUTABLE_MICROSCOPIC_MODEL / CROSS-JOURNEY_CONVERGENCE`

## Active unit

```text
KF-JOURNEY-001 — Business Birth
        ↕
KF-JOURNEY-025 — Human Authority Lifecycle
        ↕
KF-JOURNEY-002 — KEY Request → Governed Action
```

## Status

`CONVERGENCE — FOUNDATIONS BEFORE J15`

## Major continuity recovery completed

The exhausted prior conversation produced a structured recovery packet that restored substantially more work than the initial continuation checkpoint had access to.

Recovered with high confidence:

- canonical 25-journey programme;
- recursive/bidirectional journey methodology;
- full journey-dossier schema;
- substantial J1 first/second-pass work;
- substantial J2 first/second-pass work;
- partial J25 work;
- findings F003–F043 where historical IDs were recoverable;
- contradictions C005–C021;
- provisional recommendations KF-REC-001–018;
- refined macro model around facts, capabilities, authority, clearance, execution claims and evidence;
- exact immediate continuation anchor from the exhausted thread.

The source packet is durably preserved at:

`docs/intelligence/sessions/2026-09-03-exhausted-thread-recovery.md`

## Previous gap resolved

`KF-Q-001` — unrecovered journey catalogue — is now resolved by recovery.

The programme is recorded in `03-ANALYSIS-MAP.md` through:

`KF-JOURNEY-025 — Human Authority Lifecycle`.

No J26+ identifier should be inferred from the recovery.

## Current canonical macro thesis

> KeyFlowOS is a governed business-state transition system.

```text
External reality
  -> observation/signal
  -> Business Graph
  -> Genome interpretation
  -> KEY reasoning
  -> capability
  -> human authority + KEY autonomy + readiness + policy
  -> clearance
  -> execution claim
  -> execution
  -> business state transition
  -> event/evidence/outcome
  -> Business Graph
  -> Genome evolution
```

## J1 recovered state

Business Birth is no longer at first-pass scoping. Recovered work models a high-level implementation spine:

```text
PROSPECT
  -> auth provisioning/authentication
  -> local User
  -> Business
  -> OWNER Membership
  -> active workspace
  -> onboarding
  -> Genesis/Blueprint population
  -> operating configuration
  -> Genome/readiness
  -> Three-Pillar Minimum
  -> markOnboardingComplete
  -> Command Center / operating business
```

Recovered semantic refinement treats Business Birth as interlocking human, tenant, knowledge and operating initialization.

Remaining J1 foundations are now tightly coupled to J25/J2 rather than requiring a broad repository inventory from zero.

## J25 recovered state

Human Authority Lifecycle exists because current tenancy/authorization behavior appears fragmented across:

- `Business.ownerId`;
- Membership;
- Membership role/scopes/maxApprovalTier;
- JobRole/OrgAssignment-derived permissions;
- explicit grants/delegations;
- approval semantics;
- resource/capability context.

Working missing primitive: a central explainable Effective Authority Resolver.

## J2 recovered state

Governed action analysis exposed:

- capability identity collapse through generic wrappers;
- multiple governance regimes;
- human authority vs KEY autonomy conflation in some paths;
- approval state not equivalent to exact-action clearance;
- plan/proposal execution concurrency weaknesses;
- idempotency not equivalent to an execution claim;
- promising existing seams such as CapabilityContractService and ActionDispatcherService that may be strengthened rather than replaced.

## Immediate unresolved convergence

### A. Tenant relationship migration

Resolve:

```text
Business.ownerId + Membership
  -> safe Membership-first tenancy
```

without breaking existing ownership/data semantics.

Need establish:

- founding OWNER Membership invariant;
- ownerId long-term role;
- tenant discovery semantics;
- BusinessGuard/scoped authorization convergence;
- active workspace resolution;
- invitation claim lifecycle and migration.

### B. Effective human-authority algebra

Resolve:

```text
principal
+ business
+ Membership/base role
+ JobRole/position
+ explicit grants/overrides
+ explicit denials
+ delegations
+ approval tier
+ capability
+ resource/context
+ validity/revocation
-> effective authority
```

Need define source precedence, expansion/narrowing rules, explainability and revocation behavior.

### C. Execution claim / dispatcher convergence

Resolve:

```text
proposal execution
+ plan execution
+ queue/BullMQ
+ direct Flow execution
+ retries
+ provider idempotency
-> one concurrency-safe execution claim and post-clearance dispatch model
```

Need decide whether ActionDispatcherService should become the load-bearing post-clearance executor and whether direct Flow plan execution remains.

## Current recommendation posture

Recovered `KF-REC-001`–`KF-REC-018` remain **provisional**, not implementation tickets.

Important recovered revisions:

- Tenant Genesis must include founding authority, not merely Business creation.
- Business self-model authority should converge on platform capability/principal authority semantics.
- Knowledge/module readiness must remain separate from final governed-action clearance.
- Invitation should become a claim lifecycle, preserving intended scopes/tier.

## Do not yet

- modify production code;
- freeze target schemas for authority/clearance/execution claim;
- fully open J15;
- create parallel `v2` registries/services before proving existing seams insufficient;
- delete legacy BusinessGenome/BusinessGuidanceProfile or other residue without consumer proof;
- assign historical F-numbers beyond F043 without source evidence;
- treat recovered commit-sensitive implementation facts as current without revalidation.

## Next analytical pass

Perform a **three-axis convergence pass** rather than opening a new journey:

1. revalidate current repository implementation for tenant identity / ownerId / Membership / invitation / JobRole authority;
2. construct candidate effective-authority algebra and test it against J1 and J2 scenarios;
3. revalidate proposal/plan/direct/queue execution paths and construct candidate clearance -> atomic claim -> dispatcher semantics;
4. feed findings backward into J1/J25/J2;
5. update contradictions/recommendations;
6. perform J15 admission review only if foundations stabilize.

## Context-integrity status

`PASS — PRIOR THREAD CONTINUATION SUBSTANTIALLY RECOVERED AND PERSISTED`
