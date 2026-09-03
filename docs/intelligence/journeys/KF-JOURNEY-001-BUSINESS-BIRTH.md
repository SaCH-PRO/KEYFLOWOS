# KF-JOURNEY-001 — Business Birth

Status: SUBSTANTIALLY_MODELLED / ACTIVE CROSS-JOURNEY CONVERGENCE

Source basis: recovered prior-thread analysis plus continuation-thread revalidation. Commit-sensitive implementation claims must still be checked against the current default branch before implementation work.

## A. Definition

Business Birth is the transition from a prospective/unknown founder state into an operating KeyFlowOS business context that has coherent human identity, tenant relationship, foundational business knowledge, enough operating configuration/readiness for the post-birth experience, and a legitimate authority baseline.

It is broader than inserting a `Business` row.

Recovered refinement treats Business Birth as interlocking initialization dimensions:

- **Human birth** — authentication / local identity.
- **Tenant birth** — Business + Membership + founding authority.
- **Knowledge birth** — Blueprint -> observations/assertions/evidence -> resolved knowledge / Genome.
- **Operating birth** — products/services/hours/public asset/connectors and other initial operational configuration.

Then readiness -> Command Center / operating business.

The exact canonical exit boundary remains open (`KF-Q-002`).

## B. Product intent

A founder should move from “I have an idea/business” to “KeyFlowOS knows enough about my business, has established the correct workspace/authority, and can help me operate safely” without requiring the founder to manually assemble an internal system model.

Business Birth should produce both:

1. machine-usable business understanding;
2. visible real value/activation proof early enough that onboarding does not feel like paperwork.

## C. Actors

- prospective founder/operator
- Supabase/external auth identity
- local User
- Business
- founding Membership / owner
- onboarding/Genesis surfaces
- KEY / model gateway
- Blueprint / Genome services
- setup/template/catalog/storefront systems
- readiness/gating systems
- Command Center

## D. Recovered high-level implementation spine

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

Important: alternate Business creation paths were also recovered historically and did not necessarily satisfy equivalent founding Membership/initialization semantics. These must be revalidated.

## E. Recovered onboarding / knowledge / operating flow

```text
/app/onboarding
  -> persistent KEY onboarding session/state
  -> welcome
  -> intake
  -> business description
  -> ModelGateway / Genesis extraction
  -> preview/review
  -> BusinessBlueprint mutation
  -> selected Business-field mirroring
  -> compliance/projection/readiness work
  -> GenomeFact + GenomeEvidence attempts
  -> template selection
  -> configure products/hours/payments/storefront/contacts
  -> Blueprint/Genome reconciliation
  -> DNA/integrity/stage/readiness
  -> Three-Pillar Minimum
  -> markOnboardingComplete()
  -> onboardingComplete=true
  -> onboardingCompletedAt
  -> demo seed / milestone / legal side effects
  -> /app/command-center
```

## F. Recovered state machine

```text
S0  PROSPECT
S1  AUTH_PROVISIONED
S2  AUTHENTICATED
S3  LOCAL_IDENTITY_READY
S4  TENANT_READY
S5  ONBOARDING_WELCOME
S6  ONBOARDING_INTAKE
S7  BUSINESS_CONCEPT_CAPTURED
S8  BLUEPRINT_POPULATING
S9  TEMPLATE_SELECTED
S10 BUSINESS_CONFIGURING
S11 GENOME_MINIMUM_PENDING
S12 THREE_PILLAR_MINIMUM_MET
S13 ONBOARDING_COMPLETE
S14 OPERATING
```

This is a working semantic state machine reconstructed from the prior analysis, not yet a claim that current code enforces one single formal state machine.

## G. Onboarding-step semantics

Recovered current/recent implementation semantics:

```text
welcome -> intake -> template -> configure -> complete
```

Legacy aliases:

- `genesis -> intake`
- `genome -> configure`

`saveStep('complete')` is intentionally rejected; the dedicated completion command owns transition to complete.

Recovered Three-Pillar threshold:

- founder >= 50
- business >= 50
- market >= 50

Continuation-thread repository inspection also confirmed the slim onboarding state service normalizes legacy steps and dedicated `markOnboardingComplete()` gates completion through Genome integrity before transactionally updating completion state plus demo/milestone/legal side effects.

## H. Tenant / identity model

### Current/recovered core distinction

External authentication identity, local User, Business, Membership, ownership and active workspace are distinct concepts.

### Founding authority concern

Recovered analysis found multiple creation semantics:

- `bootstrapUser()` ensured/reused a default Business and upserted OWNER Membership;
- explicit `createBusiness()` historically created the Business and initialized some operational defaults, but did not necessarily create equivalent OWNER Membership;
- a tRPC creation path was also recovered as underinitialized.

Thus “Business exists” did not guarantee “founding tenant authority is coherent.”

### Active convergence with J25

Working target:

```text
Tenant Genesis
  -> Business
  -> founding OWNER Membership
  -> owner semantics preserved
  -> discoverable authorized workspace
  -> Effective Authority Resolver can explain founding authority
```

Open: long-term role of `Business.ownerId` versus Membership-first tenant relationship (`KF-Q-010`).

## I. Workspace selection

Recovered/confirmed `apps/web/src/lib/workspace.ts` behavior stores `kf_business_id` as active browser workspace selection and can bootstrap/refresh workspace state from identity bootstrap.

Invariant:

> `kf_business_id` is selection context, not authorization.

Recovered product gap: no mature first-class multi-business switcher had been identified. Workspace candidates should eventually derive from authorized relationships.

## J. Invitation lifecycle

Recovered defect class:

```text
invite email
  -> create placeholder local User
  -> create Membership
  -> later authenticated external identity may collide/reconcile poorly
```

Working target:

```text
Invitation claim
  -> authenticated identity proves claim
  -> Membership activated/created
  -> intended role/scopes/tier preserved
```

This remains active J1/J25 work. Existing placeholder invitation identities require migration planning.

## K. Business knowledge formation

Recovered architecture increasingly distinguishes:

```text
SOURCE
  -> observation / signal
  -> semantic normalization
  -> FactDefinition
  -> assertion
  -> evidence / confidence / verification / freshness / risk
  -> resolution policy
  -> resolved fact
  -> Genome interpretation/readiness
```

### Business Blueprint

Primarily founder/operator declaration/configuration.

### Business Graph

Factual business state KeyFlowOS may treat as reality; not merely database rows.

### Genome

What KEY should currently believe about the business, including interpretation, confidence, gaps, stage, readiness, risk and actionability.

### Recovered knowledge-integrity concerns

- multiple source-specific/noncanonical fact producers;
- weaker assertion replacing value while stronger verification metadata remains;
- Blueprint update/readiness ordering can produce stale projection;
- competing legacy business-knowledge projections remain active;
- scoring paths can disagree;
- tests do not automatically prove ontology compatibility.

## L. Readiness model

Business Birth historically used Three-Pillar Minimum and setup/onboarding checks, but recovered analysis rejected treating any one flag as final action safety.

Working readiness lattice:

1. Knowledge Readiness
2. Operational Readiness
3. Connectivity Readiness
4. Compliance Readiness
5. Authority Readiness
6. Action Readiness

Invariant:

`onboardingComplete != Genome healthy != module ready != action authorized != automation safe`.

Business Birth's exact readiness exit requirement remains unresolved.

## M. Operating configuration

Recovered onboarding/template paths could establish:

- products/services
- business hours
- payment recommendations/configuration state
- storefront slug/public asset
- contacts/demo state
- selected business profile fields

Recovered concern: some setup/readiness semantics were stronger in naming than the underlying configuration proof (e.g. recommended payments vs real connector/payment readiness).

## N. Activation proof / first live asset

Recovered product finding F019/C016:

KeyFlowOS already had machinery capable of generating/configuring a customer-facing storefront/public booking surface during onboarding, but the result was not prominently surfaced as the moment of first value.

Working product direction:

```text
Template/configuration
  -> live/previewable asset
  -> Preview / Copy link / Publish / Share
  -> first tangible value
```

Hypothesis: this should happen before requiring maximal Genome completeness, subject to safety/product constraints.

## O. Onboarding completion transition

Dedicated completion command is semantically stronger than generic field mutation.

Recovered completion concerns historically included:

- generic Business patch could bypass lifecycle semantics (revalidate current code);
- dedicated completion enforced Three-Pillar Minimum;
- completion also seeded demo data / milestone / legal-disclaimer side effects;
- synthetic data introduced here could contaminate later intelligence.

Working direction: one explicit idempotent lifecycle transition owns completion gates, side effects and lifecycle event(s).

## P. Synthetic data

Recovered finding F018/F027 indicates persisted demo data could influence Cortex/operational counts/ecommerce inference.

Working invariant:

> Synthetic bootstrap examples must be explicitly classified and must not silently become canonical business truth.

Need universal provenance/classification (`KF-Q-021`).

## Q. Events / lifecycle

Recovered finding F025: no reliable single semantic Business-creation lifecycle event had been established.

Earlier continuation-thread inspection also found `createBusiness()` directly seeded default triggers/settings because no `business.created` hook was available there.

Open question: should Tenant Genesis own an explicit committed lifecycle event, and what downstream initialization should be synchronous vs event-driven?

## R. Default trigger/autopilot initialization

Continuation-thread source inspection confirmed explicit business creation attempted `defaultTriggers.seedForBusiness(business.id)` after creating the Business, with failure tolerated so the Business could still be created.

This demonstrates a degraded state:

```text
Business exists
  + default operational/autopilot initialization may have failed
```

Whether this seed belongs in canonical Tenant Genesis or a repairable post-commit subscriber remains unresolved.

## S. Business self-model authority

Recovered J1/J25 finding: ordinary members could reach multiple Blueprint/onboarding/Genesis/Genome mutation surfaces.

Required distinction:

- contribution / signal
- proposal to change canonical business knowledge
- authoritative canonical business-truth mutation

This authority model must reuse J25/J2 capability/principal semantics rather than inventing isolated onboarding permissions.

## T. Legacy / duplicate knowledge models

Recovered active/legacy concerns:

- modern GenomeFact/evidence architecture
- mutable legacy BusinessGenome consumed by Cortex
- live BusinessGuidanceProfile used by AI/documents
- Business/Blueprint fields and mirrors

Rule: classify active consumers before migration/deletion.

## U. Recovered J1 findings

Historical IDs preserved in `08-FINDING-REGISTER.md`:

F003–F028.

Especially relevant to current convergence:

- F003 ownerId and OWNER Membership dual authority
- F004 explicit createBusiness lacks OWNER Membership
- F005 creation paths initialize differently
- F006 discovery owner-based vs Membership access
- F018 synthetic contamination
- F020 business self-model mutation under-scoped
- F021 missing semantic fact normalization
- F022 weak module readiness
- F024 underinitialized alternate tenant creation
- F025 no reliable business lifecycle event
- F026 weak assertion can replace stronger-verified value state
- F028 modern Genome vs legacy BusinessGenome divergence

## V. Recovered contradictions

See `09-CONTRADICTION-REGISTER.md`, especially:

- C005 founding Membership discovery vs ownerId
- C006 Business + OWNER Membership invariant vs partial creation paths
- C007 completion transition vs generic patch
- C008/C014 modern vs legacy Genome
- C009 Blueprint vs BusinessGuidanceProfile
- C010 ontology vs source-specific producers
- C012 self-model mutation authority
- C013 readiness naming vs trust semantics
- C015 synthetic data treated as live
- C016 first live asset exists but activation proof discarded

## W. Current open questions

Primary J1 questions now include:

- `KF-Q-002` Business Birth exit condition
- `KF-Q-003` Business Birth semantic entry
- `KF-Q-004` onboarding vs Genesis partition
- `KF-Q-005` canonical knowledge/evidence write semantics
- `KF-Q-008` lifecycle creation event
- `KF-Q-009` authoritative initialization graph
- `KF-Q-010` ownerId + Membership migration
- `KF-Q-011` invitation placeholder migration
- `KF-Q-012` effective authority algebra
- `KF-Q-021` synthetic data classification
- `KF-Q-022` business-knowledge write authority

## X. Cross-journey dependencies

J1 cannot be frozen independently.

```text
J1 Business Birth
  <-> J25 Human Authority Lifecycle
  <-> J2 KEY Request -> Governed Action
```

### J1 needs from J25

- Membership-first tenant relationship
- founding OWNER authority envelope
- invitation claim lifecycle
- effective authority semantics
- business-self-model mutation authority

### J1 needs from J2

- distinction between readiness and final action clearance
- capability identity
- human authority vs KEY autonomy
- what “safe operating context” must exist at birth for KEY to act

## Y. Provisional recommendations

Recovered J1 recommendations remain provisional in `10-RECOMMENDATION-REGISTER.md`, including Tenant Genesis, Membership-first workspace resolution, invitation claim lifecycle, canonical fact normalization, precedence, Genome reconciliation, trust-aware readiness, synthetic-data exclusion, activation proof and explicit lifecycle events.

Do not implement them directly until convergence is accepted.

## Z. Immediate next pass

Do not restart broad Boundary & Reality Reconstruction.

Current J1 work is a targeted convergence pass:

1. revalidate all current Business creation/bootstrap paths and founding Membership behavior;
2. trace ownerId/Membership/business discovery/BusinessGuard/scoped auth semantics;
3. trace invitation and JobRole authority behavior;
4. construct Membership-first Tenant Genesis invariants and migration options;
5. feed J25 authority algebra into founding authority/self-model mutation;
6. feed J2 action-readiness/clearance requirements back into Business Birth exit semantics;
7. update findings/contradictions/recommendations;
8. only after convergence decide whether J1's semantic entry/exit can be frozen.
