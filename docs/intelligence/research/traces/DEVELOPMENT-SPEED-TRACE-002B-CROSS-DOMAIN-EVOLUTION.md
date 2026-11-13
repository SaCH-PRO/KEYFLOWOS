# Development-Speed Trace 002B — Cross-Domain Evolution Sample

Status: ACTIVE R&D / REPO PRESSURE TEST
Authority: RESEARCH ONLY
Parent: DEVELOPMENT-SPEED-TRACE-002-BEHAVIORAL-HOTSPOTS.md
Purpose: broaden the first hotspot sample beyond PR #120 and test whether development-history signals generalize across KEYFLOWOS.

## Context integrity check

Result: PARTIAL FAIL / RECOVERABLE.

The canonical intelligence handoff on `docs/keyflow-intelligence-foundation` still names `main@83b5f98d...` and ACTION-001 as the active frontier, while current repository history includes later merged control-plane work through PR #120 at `6fdffc26...`.

The older `docs/intelligence/07-CURRENT-STATE.md` is older still and describes EXTFX PR #76 as typecheck-red, while the canonical handoff records EXTFX, TENANT and AUTH as checkpointed.

Interpretation: the repository contains multiple continuity surfaces with different freshness. This is itself evidence for the deterministic-context-assembly research: context selection must include freshness and precedence, not just retrieval.

No canonical programme state is changed by this research trace.

## Sample method

This pass sampled recent commits from four distinct areas:
- control plane / state reducer;
- TENANT / identity;
- EXTFX / communications;
- KEY cortex / system-map work.

The sample is intentionally bounded and non-statistical. It establishes failure-pattern diversity and candidate reusable signals. A deterministic analyzer is still required before claiming repository-wide rankings.

## Cross-domain observations

### 1. Control plane — semantic correction density

PR #120 remains the strongest correction-density example.

Repeatedly touched semantic surfaces include:
- state/checkpoint shape;
- event normalization;
- authority effects;
- admission binding;
- YAML codec behavior;
- recovery/re-anchor;
- exact-head artifacts;
- negative-control liveness.

Dominant historical failure classes:
SHAPE, IDENTITY, PARSER/CODEC, RECOVERY, PROOF, OPERATOR-RENDERING.

This is a state/authority hotspot, not merely a set of frequently edited files.

### 2. TENANT / identity — boundary and data-shape hotspot

The TENANT merge sample touches:
- founding-membership.service.ts;
- identity.service.ts;
- identity router;
- founding-membership integration tests;
- no-raw-records proof;
- backfill tooling.

Historical commit evidence around this packet records two especially important correction classes:
- pagination/truncation could hide a conflicting OWNER and cause a second owner to be written;
- select-less Business reads could disclose decrypted OAuth token columns across a router boundary.

The packet also had to model the membership-first predicate correctly in its test mock after broader CI exposed the mismatch.

Dominant failure classes:
PAGINATION/COMPLETENESS, AUTHORITY/IDENTITY, DATA DISCLOSURE, MOCK FIDELITY, MIGRATION/BACKFILL.

Reusable proof-profile implication:
tenant/identity changes should automatically pressure-test exhaustive reads, ambiguity, explicit projections/allowlists, membership-vs-owner compatibility, concurrent genesis, and mock-vs-real query semantics.

### 3. EXTFX / communications — effect-certainty hotspot

The EXTFX sample concentrates in:
- delivery-queue.service.ts;
- resend-effect.ts;
- resend adapter;
- effect-certainty tests;
- system-email.service.ts;
- Prisma schema/migration.

The sequence includes:
- effect-certainty primitives;
- crash-certain delivery;
- idempotency safety;
- runtime type-boundary fixes;
- deterministic provider simulator;
- effect-identity proof;
- lint-neutral proof cleanup.

Dominant failure classes:
EXTERNAL AMBIGUITY, IDEMPOTENCY, CRASH/RETRY, EFFECT IDENTITY, RUNTIME TYPE BOUNDARY, PROVIDER SIMULATION.

Reusable proof-profile implication:
external-effect changes should inherit duplicate, timeout, crash-before/after-persist, retry, provider-acceptance ambiguity, reconciliation and effect-identity cases.

This is a direct DDIA-aligned research seam.

### 4. AUTH — authority convergence hotspot

The AUTH foundation sample spans:
- module-scope guard;
- approval tiers;
- authority inventory;
- effective-authority resolver/types;
- module vocabulary;
- AI oversight/settings;
- identity;
- integration proof;
- architecture registries.

This is evidence that authority changes cross several semantic layers even when the desired rule sounds local.

Dominant failure classes inferred from the admitted packet shape:
VOCABULARY DRIFT, PROVENANCE, FRESHNESS, GRANTOR AUTHORITY, PAGINATION COMPLETENESS, LEGACY/CANONICAL DIVERGENCE.

This reinforces the earlier rule:
DO NOT DEBUG AN AUTHORITY MIGRATION AS IF IT WERE A LOCAL REFACTOR.

### 5. KEY cortex — reachability is a first-class hotspot dimension

The codebase map states that KEYFLOWOS's dominant failure mode has been code that exists and is registered but is not connected to a live path.

The sampled KEY-related history includes:
- environment variables used by code but undocumented;
- a self-re-deriving system map;
- deletion of a 616-line web feed that rendered nowhere and called routes that never existed.

The codebase map also distinguishes live, inert and partially connected cognition paths.

Dominant failure classes:
REACHABILITY, CONFIGURATION DISCOVERY, DEAD/INERT CODE, STATIC-MAP DRIFT, LIVE-PATH DIVERGENCE.

Reusable proof-profile implication:
KEY feature work should prove existence -> registration -> injection -> caller/driver -> user/runtime reachability before refinement.

## Cross-domain failure taxonomy

The sample now supports a broader historical failure vocabulary:

1. REACHABILITY
2. SHAPE / TYPE
3. IDENTITY
4. AUTHORITY / PROVENANCE
5. PARSER / CODEC
6. PAGINATION / COMPLETENESS
7. DATA DISCLOSURE
8. MOCK FIDELITY
9. EXTERNAL EFFECT AMBIGUITY
10. IDEMPOTENCY / RETRY
11. CRASH / RECOVERY
12. EFFECT IDENTITY
13. MIGRATION / BACKFILL
14. CONFIGURATION DISCOVERY
15. PROOF VACUITY
16. ARTIFACT / HEAD BINDING
17. OPERATOR REPRESENTATION
18. LEGACY / CANONICAL DIVERGENCE

This taxonomy is a research artifact, not yet a canonical architecture vocabulary.

## Cross-book triangulation

### Software Design X-Rays / Tornhill
Supports using evolutionary history and co-change as architectural evidence.

### The Pragmatic Programmer
Orthogonality and tracer-style validation suggest reducing broad speculative edits and proving live seams early.

### Ousterhout
Repeatedly co-changing shallow boundaries are candidates for complexity review, but churn alone does not justify consolidation.

### Fowler
The history demonstrates why change classification matters: many corrections are migrations of authority/state/effect semantics, not behavior-preserving refactors.

### Beck / TDD
Tests are useful only when they are sensitive to the defect. The repository's own history contains examples of mocks/controls that were green while missing the target failure.

### DDIA
EXTFX and authority/state work strongly reinforce explicit identity, retry, ordering, persistence and recovery semantics.

### Weinberg + Hermans
Repeated correction patterns are evidence about comprehension and representation failures, not merely code defects. They can improve future context packets.

## Candidate: semantic hotspot profile

A hotspot record should not be:

`file -> churn score`

It should be closer to:

```yaml
hotspot_id: EXT_EFFECT_CERTAINTY
surfaces:
  - communications
  - notifications
  - persistence
failure_history:
  - EXTERNAL_EFFECT_AMBIGUITY
  - IDEMPOTENCY_RETRY
  - CRASH_RECOVERY
  - EFFECT_IDENTITY
required_cognitive_operations:
  - TRACE
  - STATE_MACHINE_REASON
  - FAILURE_INJECTION
  - RECONCILIATION_REASON
proof_profile:
  - duplicate
  - timeout
  - crash_before_persist
  - crash_after_provider_accept
  - retry
  - reconciliation
```

This converts historical repository experience into reusable development intelligence.

## Candidate passive asset stack

### Level 1 — deterministic extractor
Repository Evolution Analyzer:
- commit/path churn;
- PR correction depth;
- co-change;
- review finding participation;
- CI recurrence.

### Level 2 — semantic enrichment
Map changed files onto:
- architecture module;
- journey;
- kernel;
- semantic owner;
- runtime path;
- risk class.

### Level 3 — learned failure profiles
Aggregate historical failures by semantic hotspot.

### Level 4 — task packet compiler
Inject:
- relevant hotspot history;
- likely failure modes;
- required proof;
- relevant architecture laws;
- minimum context.

### Level 5 — routing/evaluation
Use outcomes to measure which agent/model/tool combinations perform well on each cognitive operation.

### Level 6 — KEY capability
Expose the same machinery as software-system intelligence for KEY where product scope permits.

## New candidate laws

### HISTORY IS EVIDENCE, NOT AUTHORITY
High churn suggests investigation. It does not prove bad design.

### CO-CHANGE IS A QUESTION, NOT A MERGE COMMAND
Files changing together may reveal one concept, a legitimate transaction boundary, generated artifacts, or accidental coupling. Classify before consolidating.

### CORRECTION DEPTH SHOULD CHANGE THE NEXT TASK PACKET
Repeated failure classes must become pre-edit context/proof obligations.

### REACHABILITY PRECEDES REFINEMENT
A disconnected subsystem should not receive polishing priority merely because its code exists.

### PROOF PROFILES SHOULD FOLLOW SEMANTICS, NOT FILE EXTENSIONS
A TypeScript file handling external effects needs effect/recovery proof, not merely TypeScript/unit-test proof.

## R&D yield assessment

This trace has produced more than a documentation insight.

Potential stacked yield:
research principle
-> failure taxonomy
-> deterministic history analyzer
-> semantic hotspot profiles
-> generated proof profiles
-> context compiler
-> agent router/evaluator
-> KEY software-analysis capability.

That satisfies the programme's compounding R&D objective if implementation later proves the machinery reduces time-to-correct-completion.

## Next trace

DEVELOPMENT-SPEED-TRACE-003 — PROOF FUNNEL AND CI LATENCY.

Questions:
1. Which checks can falsify a bad change earliest?
2. Which expensive checks are repeatedly run before cheaper decisive checks?
3. Which local/targeted suites diverge from full CI?
4. Which tests are capable of going green while the target defect survives?
5. Can proof obligations be selected by semantic change type/hotspot profile?
6. What evidence must still run broadly at the final admission boundary?

Target outcome:
a candidate proof funnel that is faster without weakening final evidence.

