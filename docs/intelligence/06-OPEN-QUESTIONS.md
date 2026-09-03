# KeyFlowOS Open Questions

Status: ACTIVE REGISTER

Open questions remain explicit until resolved by evidence and/or an accepted decision. When resolved, record the resulting decision ID rather than deleting the question.

---

## KF-Q-001 — Recover or re-establish the full journey catalogue

**Status:** RESOLVED BY RECOVERY

The exhausted-thread recovery packet recovered the previously established canonical programme through `KF-JOURNEY-025` with high confidence.

**Resolution:** see `03-ANALYSIS-MAP.md`, `KF-DEC-011`, and `sessions/2026-09-03-exhausted-thread-recovery.md`.

No journey identifier beyond J25 should be inferred from the packet.

---

## KF-Q-002 — What exactly constitutes completion of Business Birth?

**Status:** OPEN — CENTRAL TO J1/J25/J2 CONVERGENCE

Recovered J1 work substantially narrowed Business Birth into interlocking human, tenant, knowledge and operating initialization, but the canonical product-semantic exit remains unfrozen.

Candidate requirements include:

- authenticated/local human identity exists;
- coherent Business + founding Membership/authority envelope exists;
- active workspace context exists;
- Blueprint/business concept is materially populated;
- minimum trusted Genome/readiness state exists;
- baseline operating configuration exists;
- Three-Pillar Minimum is met;
- onboarding completion transition has executed;
- first customer-visible activation proof exists;
- KEY possesses sufficient context for the post-birth capability set.

The exit must not be defined by `onboardingComplete` alone.

---

## KF-Q-003 — Where does Business Birth semantically begin?

**Status:** OPEN

Candidate semantic entry states remain prospect/idea intent, signup intent, auth provisioning, authenticated identity, or first Genesis/onboarding intent. Distinguish product-semantic journey boundary from implementation endpoints.

---

## KF-Q-004 — Is generic onboarding a subset/interface of Business Genesis?

**Status:** OPEN / PARTIALLY NARROWED

Current/recovered implementation indicates the slim onboarding funnel uses Genesis extraction and BusinessBlueprint mutation while retaining onboarding-concierge responsibilities for configuration and lifecycle state.

Need final semantic partition among Genesis, onboarding, template/configure and business operating activation.

---

## KF-Q-005 — Do all business-knowledge write paths preserve equivalent evidence semantics?

**Status:** OPEN — HIGH PRIORITY KNOWLEDGE KERNEL

Recovered findings indicate they do not currently appear equivalent. Producers include profile mirroring, Genesis, Genome chat, device visual intake, Temporal Flow, Key Inbox and conversation extraction, with varying ontology/verification semantics.

Need a canonical observation/assertion/evidence/resolved-fact boundary and precedence policy.

---

## KF-Q-006 — What current systems are canonical versus legacy/duplicate?

**Status:** OPEN

Known/recovered candidates requiring consumer/reachability proof include legacy `BusinessGenome`, `BusinessGuidanceProfile`, old/new governance paths and overlapping execution regimes.

---

## KF-Q-007 — Is KEY's readiness/capability model coherent from birth through execution?

**Status:** OPEN / CROSS-JOURNEY

Recovered work shows `onboardingComplete`, Genome health, module readiness, human authority, KEY autonomy, policy, clearance and safe execution are not equivalent. Need one end-to-end action-readiness model.

---

## KF-Q-008 — Should business creation emit a canonical lifecycle event?

**Status:** OPEN

Recovered finding F025 states no reliable Business lifecycle creation event was identified. Need decide whether canonical Tenant Genesis should own explicit committed lifecycle events and what payload identity/provenance they carry.

---

## KF-Q-009 — What is the authoritative initialization relationship among Business, Blueprint, facts/evidence, Genome/readiness and Constitution?

**Status:** OPEN / PARTIALLY MODELLED IN J1

The J1 state/mutation graph should make this explicit, including transaction boundaries, async reconciliation and stale-cache risk.

---

## KF-Q-010 — How should `Business.ownerId` coexist with Membership in a Membership-first tenancy model?

**Status:** OPEN — ACTIVE CONVERGENCE A

Need migration semantics that preserve existing ownership meaning/data while making Membership the reliable tenant relationship/discovery foundation.

Questions:

- Is ownerId canonical ownership metadata, compatibility projection, or both?
- Does every owner require OWNER Membership?
- Which path repairs historical missing Memberships?
- How do BusinessGuard, list/discovery and active workspace selection converge?

---

## KF-Q-011 — How should existing placeholder invitation Users be migrated?

**Status:** OPEN

Target direction is Invitation claim -> authenticated identity proves claim -> Membership, rather than fake User creation.

Need migration for existing placeholder Users and email collisions without breaking real users, scopes, roles or approval tiers.

---

## KF-Q-012 — What is the effective human-authority algebra?

**Status:** OPEN — ACTIVE CONVERGENCE B

Need one explainable resolver over:

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

Need explicit precedence rules: which sources may expand, which only narrow, and how denials/delegations compose.

---

## KF-Q-013 — Which Membership fields are source-of-truth versus derived authority projection?

**Status:** OPEN

Recovered implementation copied JobRole-derived permission scopes and approval tier into Membership. Determine whether these remain canonical overrides, caches or derived materializations.

---

## KF-Q-014 — What is the canonical capability permission vocabulary?

**Status:** OPEN

Current coarse module scopes and fine-grained capability contracts need a coherent mapping. Capability identity/permission must survive proposal -> governance -> execution.

---

## KF-Q-015 — What changes invalidate approval/clearance?

**Status:** OPEN

Candidates recovered:

- capability version
- material parameters
- amount/value
- recipient/affected entity
- authority revocation/change
- policy version
- readiness change
- connector/provider state
- expiry

Need exact distinction between approval evidence, clearance validity and re-evaluation at execution time.

---

## KF-Q-016 — What is the canonical execution-claim mechanism?

**Status:** OPEN — ACTIVE CONVERGENCE C

Need one concurrency-safe model across proposal execution, plan execution, queue workers, direct Flow execution, retries, crash recovery and provider idempotency.

Target conceptual lifecycle:

`CLEARANCE_GRANTED -> CLAIMED -> RUNNING -> SUCCEEDED|FAILED`.

Need atomic claim semantics and duplicate/retry behavior.

---

## KF-Q-017 — Should ActionDispatcherService become the canonical post-clearance executor?

**Status:** OPEN / FAVORABLE WORKING DIRECTION

Recovered strengths include retries, circuit breaker, idempotency, logging, undo and feedback. It is not currently a complete clearance boundary. Revalidate current implementation before deciding whether to strengthen it into the canonical dispatcher.

---

## KF-Q-018 — Should direct synchronous Flow plan execution survive queue convergence?

**Status:** OPEN

Recovered analysis found potential direct-executor vs PlanExecutor/queue concurrency. Need decide whether both remain with one shared execution claim, or one becomes compatibility/preview-only.

---

## KF-Q-019 — What is the canonical principal-lineage model?

**Status:** OPEN

Need durable distinction among requestedBy, proposedBy, approvedBy, executedBy, executedFor and delegatedBy across proposals/plans/approvals/execution/outcomes.

---

## KF-Q-020 — How should hierarchical plan clearance work?

**Status:** OPEN

Need exact rule for when an approved parent plan authorizes children, how child fingerprints/bounds are represented, what mutations trigger reapproval and how nested/formal approvals interact.

---

## KF-Q-021 — How should synthetic/demo data be universally classified and excluded?

**Status:** OPEN

Recovered finding F018/F027 indicates synthetic onboarding/demo data can enter intelligence/operational contexts. Need universal data classification/provenance and default exclusion from truth-dependent analytics/Genome/finance.

---

## KF-Q-022 — What is the canonical business-knowledge write boundary by authority level?

**Status:** OPEN

Need distinguish:

- contribution/signal;
- proposed assertion/fact change;
- authoritative canonical business-truth mutation.

This must integrate J25 authority and the Knowledge Kernel.

---

## KF-Q-023 — What authority is required to mutate KEY autonomy/control-plane policy?

**Status:** OPEN

Recovered concern: broad business membership may reach policy surfaces that materially expand/restrict future KEY behavior.

Working invariant: control-plane mutation authority must be at least as strong as the behavior it can enable.

---

## KF-Q-024 — When may J15 formally open?

**Status:** BLOCKED BY KF-DEC-014

Admission review occurs only after J1/J25/J2 convergence demonstrates sufficiently stable:

- tenant relationship semantics;
- effective human authority;
- capability identity;
- clearance model;
- execution claim/dispatcher semantics.
