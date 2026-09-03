# KF-JOURNEY-001 — Business Birth

Status: SCOPING / BOUNDARY & REALITY RECONSTRUCTION

## Purpose

Reconstruct the complete current-state transition from a person/founder without an operational KeyFlowOS business context to a newly established business state that the platform can safely understand and begin operating upon.

This file is evidence-first. It must distinguish current implementation, intended architecture, accepted decisions, working hypotheses, and unresolved questions.

## 1. Semantic definition

**Current working definition:** Business Birth is broader than inserting a `Business` row. It is the transition that establishes the minimum coherent business identity, foundational machine-readable understanding, and safe operating context required for downstream KeyFlowOS capabilities.

**Boundary status:** NOT YET FINAL.

See `KF-Q-002` and `KF-Q-003`.

## 2. Candidate entry boundaries

To be validated:

- anonymous founder/business idea before account creation;
- signup/authentication intent;
- local User creation/bootstrap;
- explicit Create Business action;
- Business Genesis initiation.

## 3. Candidate exit boundaries

To be validated:

- Business database record exists;
- default operational/autopilot settings initialized;
- baseline onboarding state initialized;
- BusinessBlueprint exists;
- minimum GenomeFacts/evidence exist;
- Three-Pillar Minimum reached;
- module readiness established;
- initial Constitution generated/versioned;
- KEY has minimum safe operating context.

## 4. Evidence inventory

### Confirmed so far

#### IdentityService business creation

Current `apps/server/src/modules/identity/identity.service.ts` evidence shows that `createBusiness()`:

- validates an owner ID;
- creates a Business row;
- then attempts `defaultTriggers.seedForBusiness(business.id)`;
- deliberately allows business creation to succeed even if default-trigger seeding fails;
- notes that no `business.created` event exists at this creation point;
- returns the created Business.

**Interpretation:** database creation and secondary operational initialization are already partially coupled, but initialization is explicitly best-effort rather than atomic.

**Open implication:** whether this best-effort seed belongs to the canonical semantic Business Birth contract remains unresolved (`KF-Q-008`).

#### Business profile -> Blueprint mirroring

The same service's `updateBusiness()` maps selected profile fields into onboarding-answer keys and calls Blueprint inference asynchronously/best-effort after material profile changes.

**Interpretation:** ordinary Business profile state participates in AI/Genome grounding after creation, so Business and Blueprint cannot be treated as unrelated stores.

#### Current Genome/Genesis system map

`docs/system-map/06-business-genome.md` documents a current architecture where:

- `BusinessBlueprint` is lazily seeded by Blueprint reads;
- Blueprint updates rescore/backfill Genome state and can emit Genome/Temporal effects;
- Genome facts/evidence and scoring feed readiness and autonomy;
- Constitution versions can be generated after Genome integrity changes;
- Business Genesis and Genome Chat provide structured/inferred/verified write paths;
- Business Command Center aggregates readiness, Genome, risk, approval, and cross-domain signals.

**Interpretation:** semantic Business Birth may involve more than Identity because the downstream intelligence system has its own initialization lifecycle.

## 5. Implementation execution paths

Not yet fully reconstructed.

Required traces:

1. frontend signup/bootstrap;
2. auth callback/session bootstrap;
3. User creation/synchronization;
4. Business create endpoint/controller/service;
5. onboarding-concierge state initialization;
6. Genesis entry/write paths;
7. Blueprint lazy creation and update paths;
8. GenomeFact/GenomeEvidence creation/backfill/scoring;
9. Constitution initial generation/versioning;
10. module readiness/autonomy initialization;
11. default trigger/autopilot settings initialization;
12. emitted events/Temporal Flow/business-events/audit;
13. frontend transition to normal app/Command Center.

## 6. State / mutation graph

PLACEHOLDER — to be constructed from evidence during Pass 1.

## 7. Human / UX journey

PLACEHOLDER — frontend surfaces have not yet been fully inventoried.

## 8. KEY knowledge and authority

PLACEHOLDER — to map before/after state and readiness gates.

## 9. Security / tenancy invariants

PLACEHOLDER — Identity, Membership/owner semantics, BusinessGuard/context, and data-scoping behaviour require tracing.

## 10. Events / jobs / side effects

Known preliminary side effect:

- default trigger/autopilot seeding after Business row creation.

Known preliminary absence:

- no canonical `business.created` event at the current IdentityService creation point, according to source comments.

Full event map pending.

## 11. Failure / degraded states

Known preliminary degraded state:

- Business creation may succeed while autopilot default seeding fails. The code treats the seed as idempotent/retriable but the recovery caller/path must be found.

Other failure paths pending.

## 12. Implementation vs canonical architecture

Not yet resolved.

## 13. Open questions

Primary references:

- `KF-Q-002` Business Birth exit boundary
- `KF-Q-003` Business Birth entry boundary
- `KF-Q-004` onboarding vs Genesis semantics
- `KF-Q-005` knowledge/evidence write-path consistency
- `KF-Q-007` readiness/authority coherence
- `KF-Q-008` missing `business.created` event
- `KF-Q-009` initialization relationship across Business/Blueprint/Genome/Readiness/Constitution

## 14. Next pass

Perform repository-wide Boundary & Reality Reconstruction and replace placeholders with an evidence-backed first-pass journey map before recommending architectural changes.
