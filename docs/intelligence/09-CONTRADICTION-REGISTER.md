# KeyFlowOS Contradiction Register

Status: ACTIVE ARCHITECTURAL CONTRADICTION REGISTER

Contradictions are not automatically bugs. They identify places where two apparently valid models, code paths, semantics or architectural claims cannot both be treated as canonical without reconciliation.

Recovered historical IDs are preserved. Commit-sensitive implementation claims must be revalidated before execution work.

---

## C005 — Founding Membership discovery vs ownerId

**Status:** ACTIVE

Business ownership/discovery semantics historically leaned on `Business.ownerId`, while authorization/scoped access leaned on Membership.

Need one coherent tenant-relationship model.

## C006 — Business + OWNER Membership invariant vs partial creation paths

**Status:** ACTIVE

The semantic expectation that a founding owner has OWNER Membership conflicted with alternate Business creation paths that did not always create equivalent Membership state.

## C007 — Completion transition command vs generic Business patch

**Status:** ACTIVE / REVALIDATE CURRENT CODE

Dedicated onboarding completion enforced gates/side effects, while a generic Business mutation path historically could alter completion state directly.

## C008 — Modern Genome truth vs legacy BusinessGenome

**Status:** ACTIVE / LEGACY CONSUMER PROOF REQUIRED

Modern GenomeFact/evidence architecture and legacy mutable BusinessGenome could disagree for the same business.

## C009 — Blueprint vs BusinessGuidanceProfile

**Status:** ACTIVE / LEGACY CONSUMER PROOF REQUIRED

Multiple live business-knowledge projections could compete as AI/document grounding sources.

## C010 — Canonical ontology vs source-specific fact producers

**Status:** ACTIVE

Genome/business-knowledge producers used inconsistent section/name/verification semantics rather than one ontology-normalized resolution boundary.

## C011 — Stale Genome roadmap vs implemented Genome kernel

**Status:** HISTORICAL ARCHITECTURE-DOC CONTRADICTION

Narrative/roadmap understanding could lag materially behind implemented GenomeFact/evidence/scoring infrastructure.

Rule response: implementation reality and intended architecture must remain separately classified.

## C012 — Membership grants business-definition mutation despite differentiated roles

**Status:** ACTIVE J1/J25

Broad membership access historically enabled mutation of canonical business self-model surfaces even though role/authority distinctions existed elsewhere.

## C013 — module `automationAllowed` naming vs weak implementation

**Status:** ACTIVE / REFINED INTO READINESS LATTICE

A field that sounded like final action authorization could be computed from weak knowledge/address readiness heuristics.

Invariant response: module readiness != final action clearance.

## C014 — BusinessGenome/Cortex vs modern Genome divergence

**Status:** ACTIVE / LEGACY COMPATIBILITY

Cortex consumers of legacy BusinessGenome could observe a different business understanding than modern GenomeFact-based systems.

## C015 — synthetic data treated as live by some intelligence

**Status:** ACTIVE / HIGH PRIORITY

Demo/synthetic bootstrap data could influence live business context/analytics/intelligence.

## C016 — first live asset exists but activation proof discarded

**Status:** PRODUCT/UX CONTRADICTION

Business Birth had machinery capable of producing a public/customer-facing asset, while the onboarding UX did not prominently surface it as the moment of value.

## C017 — canonical approval claim vs multiple authority regimes

**Status:** ACTIVE J2/J25

The product concept of governed approval conflicted with multiple runtime paths using different authority/policy semantics.

## C018 — real capability risk vs generic proposal-wrapper risk

**Status:** ACTIVE J2

Underlying capability impact could be obscured by a generic action wrapper such as EXECUTE_TOOL.

Invariant response: THE THING APPROVED = THE THING EXECUTED.

## C019 — Capability Contract claims platform contract but execution does not consume it

**Status:** ACTIVE / FAVORABLE EXISTING-SEAM OPPORTUNITY

A strong capability-definition seam existed but was not load-bearing across execution/governance.

## C020 — approval state != portable clearance

**Status:** ACTIVE / REFINED CANONICAL DISTINCTION

A record being “approved” did not necessarily bind the exact action, material parameters, authority context, policy version, expiry or execution-time conditions.

Working response: explicit exact-action clearance.

## C021 — Membership has approval primitives but many approval surfaces do not consistently consume them

**Status:** ACTIVE J25/J2

Membership contained role/scope/approval-tier concepts, yet approval controllers/plans/Flow paths did not uniformly use them.

---

## Unnumbered recovered contradictions requiring revalidation

Do not assign historical C-numbers without source evidence.

### Invitation claim vs placeholder User

Invited person/email is not yet an authenticated identity, but historical implementation created a User before identity proof.

### JobRole-derived authority vs Membership materialization

Organizational role/position authority was copied into Membership, creating ambiguity over which state is canonical when assignments change.

### Direct plan execution vs queue PlanExecutor

Two execution regimes could observe the same approved plan without a single atomic execution claim.

### Parent plan approval vs child exact-action authority

Plan approval provided broad authorization benefits without a fully immutable parent/child clearance binding.

### Client confirmation vs immutable pending action

Flow confirmation re-evaluated governance but did not prove the client-supplied tool call exactly matched a server-stored immutable pending action.

### Control-plane policy mutation vs behavior it can enable

Broad business membership could potentially mutate autonomy policy that enables stronger future KEY behavior than the mutator should be allowed to authorize.

---

## Current contradiction-resolution priorities

1. C005 + C006 -> Membership-first tenancy and founding authority invariant.
2. C012 + C021 -> Effective Human Authority Resolver/algebra.
3. C017 + C018 + C019 + C020 -> stable capability identity and clearance.
4. Execution-race contradictions -> atomic execution claim and canonical dispatcher.
5. C010 + C013 + C015 -> trusted knowledge/readiness semantics.
