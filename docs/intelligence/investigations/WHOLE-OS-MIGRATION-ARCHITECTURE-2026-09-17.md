# KEYFLOWOS Whole-OS Migration Architecture

Checkpoint: WOC-2026-09-17-01
Status: ACCEPTED MIGRATION SEQUENCING CANDIDATE / NO PRODUCTION AUTHORIZATION

## Principles

1. Strengthen existing seams before replacement.
2. Compatibility before cutover.
3. Read adapters before write enforcement where legacy data is ambiguous.
4. Backfill is explicit and measurable.
5. Old/new coexist only under declared ownership.
6. New path must be disableable without reviving revoked authority or corrupting history.
7. External effects are compensated/reconciled, not “rolled back” by code revert.
8. Remove legacy writers only after consumer/writer coverage proof.
9. A migration wave is complete only when proof and rollback floors are satisfied.

## Phase M0 — Control plane and baseline

Purpose: make later claims trustworthy.

- deliberate current-main compare against the forensic baseline before implementation;
- inventory deployed schema/constraints and required legacy data distributions;
- isolate nonproduction DB/queue/storage/provider resources;
- bind designed cases to native runner reports;
- independent proof consumer;
- source/build/run/cleanup receipts;
- protected accepted-policy boundary;
- no production canary yet.

Exit: K12 proof admission can distinguish fresh complete scoped proof from missing/cached/wrong-environment evidence.

## Phase M1 — Tenant and effective authority

Primary: K1/K2 with J1/J25/J15.

- establish founding Membership invariant;
- inventory ownerId/Membership discovery and alternate business creation;
- invitation claim migration away from placeholder identity;
- define source-vs-derived Membership authority fields;
- implement EffectiveAuthorityResult using current assignment/grant/deny/delegation inputs;
- bind grantor provenance and non-escalation;
- authority revision / invalidation signal;
- compatibility adapter for existing role/scope checks;
- shadow compare old/new decisions before cutover.

Do not yet migrate every action into a new executor.

## Phase M2 — Capability, control, Clearance and execution ownership

Primary: K3/K5/K6/K11 with J2/J6/J15.

- make CapabilityContract load-bearing for selected action families;
- immutable material action fingerprint;
- separate ControlRequirement, ControlEvidence and Clearance;
- invalidate on action/authority/policy/source revisions;
- strengthen ActionDispatcher or existing domain effect seam rather than invent Dispatcher2;
- atomic execution/attempt identity in bounded slices;
- direct Flow/plan/proactive/voice paths migrate by family;
- retain specialized multi-step approval workflows as workflows, not parallel authority engines.

## Phase M3 — Occurrence, time, ingress and connector lifecycle

Primary: K7/K9/K11 with J13/J14/J18/J23/J5.

- canonical occurrence identity adapters over existing event/message/work rows;
- claim/lease/retry semantics per fabric;
- durable wait/control states;
- current connector-grant generation;
- callback origin and tenant/account binding;
- remote cleanup dependency barriers;
- conversation occurrence/consumer claims;
- cancellation/supersession/retry laws;
- operator recovery projection.

Do not force all work into one workflow runtime.

## Phase M4 — Financial/commercial/entitlement/public/voice

Primary: K10 plus J3/J4/J7/J8/J9/J10/J11/J20/J21/J22.

- preserve ledger spine;
- remove competing cash/valuation projections;
- commercial lineage and value stages;
- deposit/final obligation allocation;
- completion/billing source conservation;
- subscription EntitlementPeriod and frozen billable basis;
- AI effect/usage/provider-cost correlation;
- public semantic order/booking/form occurrences;
- atomic booking-slot ownership;
- portal tenant/subject grant repair;
- voice stream bootstrap/session binding;
- voice tool governance and realtime metering.

## Phase M5 — Knowledge, Command Center, privacy and UX convergence

Primary: K4/K8 with J16/J17/J19/J1/J6.

- KnowledgeRevision / evidence provenance;
- Blueprint/Genome materialization relationship;
- correction/withdrawal propagation;
- derived recommendation/readiness invalidation;
- Command Center source health/completeness and explainable priority dimensions;
- public/operator/KEY UI consumes canonical projections;
- privacy retention/deletion across derived copies;
- learning eligibility and non-self-grant law.

## Phase M6 — Legacy withdrawal

For every replaced path:
- enumerate remaining writers/readers;
- compare old/new results where safe;
- stop new writes;
- preserve historical reads/adapters as needed;
- repair/backfill;
- remove old writer;
- observe;
- remove old reader/compatibility only after proof;
- retain migrations/receipts/audit history.

Withdrawal is a first-class migration state, not cleanup after the fact.

## Reversibility modes

Optional changes may use:
DISABLED_SAFE
SAFE_REFERENCE
SHADOW_COMPARE
CANDIDATE_SANDBOX
CONTROLLED_CANARY after authorization and proof.

Mandatory safety invariants are not toggleable.

A flag may select behavior but cannot become authority, revocation, effect identity or proof truth.

## Rollback floor

Rollback must preserve:
- authority revocations;
- effect/provider receipts;
- financial history;
- KnowledgeRevision lineage;
- public/voice session/effect identities;
- migration markers;
- privacy deletion obligations.

Where old code cannot safely interpret new state, rollback stops at the compatible version or requires forward repair. “Deploy old binary” is not by itself a rollback plan.
