# KEYFLOWOS — Book × GenAI Implementation Readiness Derivation

Status: PACKET-DERIVATION COMPLETE / NOT RELEASED  
Authority: RESEARCH_ONLY  
Parent synthesis: `BOOK-GENAI-KEY-GLOBAL-CONVERGENCE.md`

## 1. Readiness rule

A research result is "implementation-ready" only when all of the following exist:

- canonical owner;
- bounded semantic objective;
- exact or tightly bounded write set;
- explicit non-goals;
- stop conditions;
- proof obligations;
- negative-control / falsification strategy where applicable;
- sequencing relationship to active programme work;
- no duplicate runtime, registry, memory, authority or truth owner.

This file reaches that point for four packets and explicitly routes two findings into already-owned programmes instead of allocating duplicates.

---

# PACKET BG-1 — Deterministic ContextBundle Promotion

Candidate id: `KF-META-CONTEXT-COMPILER-LIVE-001`  
Priority: P0 development-organism leverage  
State: IMPLEMENTATION_READY / HELD  
Owner: existing agent-control / context continuity substrate  
Does not own: business memory, Context Genome runtime, GitHub authority, packet authority

## Objective

Promote the already-prototyped deterministic ContextBundle compiler from isolated research proof into the development-agent workflow as a read-only context projection.

The compiler must reduce repeated context reconstruction without becoming a new truth source.

## Existing implementation evidence

Research prototype already exists:
- `scripts/agent-control/research/compile-context.mjs`
- `docs/intelligence/research/contracts/CONTEXT-BUNDLE-SCHEMA.yaml`
- `docs/intelligence/research/contracts/PROOF-PROFILES.yaml`
- control, tenant and external-effect fixtures/tests.

This packet should evolve/promote that mechanism rather than create another context engine.

## Required semantics

1. Compile only from explicit canonical/declared sources.
2. Preserve source revision, authority class and freshness.
3. Never resolve a canonical conflict by model inference.
4. Missing required authority => DEGRADED/INVALID, never VALID.
5. Research-only evidence cannot be promoted to execution/canonical authority.
6. Emit explicit exclusions and missing-source diagnostics.
7. Add a bounded failure classification:
   - KNOWLEDGE_ABSENT
   - RETRIEVAL_FAILURE
   - CONTEXT_OVERLOAD
   - REPRESENTATION_FAILURE
   - REASONING_FAILURE
   These are diagnostics/projections, not authority.
8. The worker may consume the bundle as context but must continue to obey the underlying authority artifacts directly.

## Proposed bounded write set

Likely:
- `scripts/agent-control/research/compile-context.mjs` -> promote or wrap into existing agent-control live namespace after proof;
- existing compiler tests;
- `scripts/agent-control/claude-worker.ps1` only for bounded read-only context injection;
- existing active-packet/worker tests needed to prove fail-closed behavior;
- context schema/proof-profile docs.

Do not add a service/database/runtime.

## Proof obligations

CTX-P01 deterministic: same snapshot + generator version => byte-identical bundle.  
CTX-P02 stale authority: stale required source => DEGRADED/INVALID.  
CTX-P03 missing authority: missing authority never produces VALID.  
CTX-P04 conflict preservation: conflicting canonical claims remain visible.  
CTX-P05 authority monotonicity: RESEARCH_ONLY cannot appear as canonical/execution authority.  
CTX-P06 exclusion audit: excluded sources are explicit with reason/revision.  
CTX-P07 worker independence: removing ContextBundle generation does not change underlying packet authority semantics.  
CTX-P08 no hallucinated source: every bundle claim binds to an explicit source/revision.  
CTX-P09 token/context budget: bounded bundle omits lower-priority material rather than truncating caveats or silently dropping authority.  
CTX-P10 mutation controls: weaken authority/freshness checks and named tests fail.

## Stop conditions

- promotion requires changes to issue #80 authority semantics;
- compiler must infer canonical owner from LLM output;
- implementation creates a parallel memory store;
- worker cannot consume context read-only;
- active control-plane packet touches same worker files without safe sequencing.

## Sequencing

May be developed as a separate bounded control-plane packet only after active writer conflict is checked. It is independent from the current GenAI runtime packet but must not collide with worker/control files.

---

# PACKET BG-2 — Cognitive Routing Honesty and Risk Escalation

Candidate id: `KF-COG-ROUTING-HONESTY-001`  
Priority: P1  
State: IMPLEMENTATION_READY / HELD  
Owner: `CognitiveTriageService` + existing ModelGateway/CognitiveFunction routing  
Does not create: second cognition runtime, psychological "System 1/System 2" module

## Repository reality

`CognitiveTriageService` already implements `reflex | standard | deliberate`, with:
- pure message classification;
- bounded token parameters;
- explicit whitelist for reflex greetings;
- tool-calling preserved across tiers;
- fall back to standard on triage failure.

This is a strong existing owner. Do not replace it.

## Research-derived gap

Current triage is driven primarily by textual complexity/data/time-horizon plus local physiological-style framing.

For consequential actions, routing should also be explicitly sensitive to semantic risk/authority/evidence conditions where available.

## Required semantics

A request must not be eligible for the cheapest cognitive route solely because its language is simple when it:
- can authorize or cancel an effect;
- references a pending action/confirmation;
- proposes money/destructive/permission-sensitive effects;
- has unresolved authority;
- has missing critical evidence;
- has contradictory context;
- requires multi-step planning with irreversible consequences.

The goal is not "think longer for everything." It is to prevent cheap-routing from being a semantic safety bypass.

## Bounded approach

Extend the existing verdict inputs with small deterministic risk/evidence flags sourced from already-owned action/capability/context metadata where available.

Do not:
- add a second router;
- call another LLM to decide effort;
- let cognitive tier grant authority;
- let a high confidence score bypass AutonomyOrchestrator/Flow.

## Candidate write set

Likely:
- `apps/server/src/modules/key-cortex/cognitive-triage.service.ts`
- its focused specs;
- narrowly required caller wiring for existing metadata only.

If action/capability metadata requires a new broad cross-module dependency, stop and derive a smaller contract first.

## Proof obligations

COG-P01 simple destructive command never reflexes.  
COG-P02 bare confirmation/cancellation with pending-effect meaning never reflexes.  
COG-P03 low-risk greeting remains reflex.  
COG-P04 triage failure cannot widen action authority.  
COG-P05 deliberate-routing failure still preserves safe action semantics; model fallback cannot claim an unexecuted effect.  
COG-P06 risk metadata changes tier only, never authorization.  
COG-P07 no new model call is introduced merely to choose the model call.  
COG-P08 mutation control: removing the risk floor makes a named protected-case test fail.

## Stop conditions

- requires redesign of AutonomyOrchestrator;
- requires new durable state merely for routing;
- changes provider/tool capability semantics;
- overlaps an active cognition packet touching same files.

---

# PACKET BG-3 — Behavioral Architecture / Hotspot Analyzer

Candidate id: `KF-META-BEHAVIORAL-ARCH-001`  
Priority: P1 development leverage  
State: IMPLEMENTATION_READY / SAFE OFFLINE FIRST  
Owner: architecture-forensics tooling  
Does not own: architecture truth

## Objective

Add an offline deterministic scanner that uses Git history to produce evidence about:
- change frequency;
- temporal coupling;
- co-change pairs;
- ownership concentration;
- churn;
- high-change / weak-proof candidates.

This operationalizes Software Design X-Rays without turning historical correlation into architecture authority.

## Output

Machine-readable projection, for example:

`docs/intelligence/generated/behavioral-architecture.json`

Each result must bind to:
- commit range;
- file/path;
- metric definition;
- generated-at commit;
- exclusions.

## Ranking rule

Hotspot score may prioritize investigation, but must never declare:
- duplicate ownership;
- bad architecture;
- canonical owner;
- required refactor

without the normal forensic/convergence process.

## Candidate implementation

One dependency-light script under existing architecture/intelligence tooling, using Git CLI.

No database, no service, no SaaS.

## Proof obligations

HOT-P01 same commit range => deterministic output.  
HOT-P02 rename handling is explicit.  
HOT-P03 generated/vendor/lock files are explicitly excluded.  
HOT-P04 temporal coupling uses a documented window/unit.  
HOT-P05 hotspot score changes when controlled fixture history changes.  
HOT-P06 an intentionally high-churn but semantically isolated fixture is not automatically labelled architectural defect.  
HOT-P07 output is tagged DERIVED_PROJECTION.  
HOT-P08 mutation control: disabling an exclusion or coupling calculation breaks a named fixture assertion.

## Immediate use

Feed the projection into:
- architecture reassessment prioritization;
- proof-profile selection;
- context compilation hotspots;
- candidate refactor ordering.

Do not feed directly into autonomous code mutation.

---

# PACKET BG-4 — Action Understanding Projection

Candidate id: `KF-KEY-ACTION-UNDERSTANDING-001`  
Priority: P1/P2 product trust  
State: IMPLEMENTATION_READY / HELD  
Owner: existing `KeyActionProposal` + action boundary + trust/explanation/user projection  
Does not own: authority, execution, outcome truth

## Objective

Provide one user/operator-facing projection that clearly separates:

- OBSERVED
- INFERRED
- PROPOSED
- AUTHORITY_REQUIRED
- AUTHORIZED/DENIED
- EXECUTED
- VERIFIED/UNKNOWN/FAILED

This is Don Norman's discoverability/feedback principle applied to the already-existing KEY action/evidence architecture.

## Repository basis

KEY already has:
- `KeyActionProposal`;
- `AutonomyVerdict`;
- action fingerprint/envelope;
- control requirement;
- principal chain;
- outcome evidence;
- execution result/failure reason.

The missing piece is a coherent projection, not another persistence model.

## Contract candidate

`ActionUnderstandingProjection`:
- actionId
- capability + version
- human summary
- source/proposer/requester
- material effect summary
- authority requirement
- current disposition
- evidence/approval basis
- execution state
- outcome certainty
- entity/result references
- reversibility/compensation state when known
- reason/explanation
- timestamps/revisions

Projection only. Existing source rows remain canonical.

## Proof obligations

ACTU-P01 proposal cannot appear executed.  
ACTU-P02 authorization cannot appear verified outcome.  
ACTU-P03 unknown external outcome remains UNKNOWN.  
ACTU-P04 failure reason is not overwritten by conversational optimism.  
ACTU-P05 tenant scoping follows the source action.  
ACTU-P06 projection can be rebuilt from canonical source records.  
ACTU-P07 missing optional explanation cannot change authority/disposition.  
ACTU-P08 UI/signifier tests distinguish confirmation-required vs approval-required vs denied vs executed.

## Stop condition

Microscopic consumer/write-set trace is complete in `traces/ACTION-UNDERSTANDING-TRACE-001.md`. Revalidate it against exact release-base main before authority is granted.

---

# ROUTED FINDING — Context Genome temporal semantics

Disposition: DO NOT ALLOCATE NEW PACKET.

Book research from SICP + DDIA strongly reinforces the already-derived GenAI Context Genome M1 direction:
- valid time vs recorded time;
- provenance;
- supersession;
- stale/disputed state;
- retrieval status;
- derived representation vs truth.

Route into existing #106/#122 ownership and candidate D rather than creating another memory/time architecture.

---

# ROUTED FINDING — Evaluation / proof admission

Disposition: DO NOT ALLOCATE NEW PACKET.

TDD, Refactoring, The Practice of Programming and behavioral-coupling research strengthen #130/#151 and Layer-9 Assurance:
- fast local falsification;
- characterization before behavior-preserving refactor;
- mutation sensitivity;
- integration/database proof where mocks are insufficient;
- exact-head final admission.

Do not create a parallel evaluation harness.

---

## 2. Recommended implementation order

1. Current `KF-EXEC-AUTH-FAIL-CLOSED-001` completes admission first.
2. GenAI time-bounded OTel/Langfuse packet remains next in its existing sequence.
3. `KF-META-CONTEXT-COMPILER-LIVE-001` can proceed in parallel only if its worker/control write set is conflict-free; otherwise hold.
4. `KF-META-BEHAVIORAL-ARCH-001` is the safest independent offline implementation candidate and can be built without runtime authority.
5. `KF-COG-ROUTING-HONESTY-001` after exact write-set/owner collision check with cognition work.
6. `KF-KEY-ACTION-UNDERSTANDING-001` is now implementation-ready after the consumer trace; sequence by exact write-set collision and product priority.
7. Context Genome / Assurance findings remain under their existing owners.

## 3. Readiness conclusion

The research has crossed the line from idea collection to implementable engineering for BG-1, BG-2 and BG-3.

BG-4 is contract-ready but still requires a consumer/write-set trace.

No packet is released from this document. Release must occur through the existing control-plane authority process with exact current-main rebinding.


---

# PACKET BG-5 — Proof-Class Honesty

Candidate id: `KF-ASSURANCE-PROOF-CLASS-001`  
Priority: P1 assurance leverage  
State: IMPLEMENTATION_READY / ROUTE TO EXISTING ASSURANCE OWNER  
Owner: existing #130/#151 Assurance + proof-admission  
Does not create: theorem-prover runtime, second eval harness

## Objective

Make packet/evaluation design explicitly distinguish:

- EXACT_FORMAL_OR_DETERMINISTIC
- INTEGRATION_STATE
- EXTERNAL_EFFECT
- SEMANTIC_EVALUATION

The system should use the strongest applicable proof form and prevent a weaker semantic evaluator from overriding deterministic failure.

## Bounded approach

Extend the existing research `PROOF-PROFILES.yaml` vocabulary and later, if admitted, packet proof metadata.

Examples:
- parser shape / fingerprint / state reducer -> exact deterministic;
- tenant persistence / transaction / concurrency -> integration state;
- provider side effect / timeout ambiguity -> external-effect simulator + reconciliation;
- natural-language quality / usefulness -> semantic evaluation with calibration.

## Proof obligations

PROOF-P01 every required proof declares its class.  
PROOF-P02 deterministic failure cannot be superseded by LLM-judge pass.  
PROOF-P03 external-effect claims require effect evidence or explicit UNKNOWN.  
PROOF-P04 semantic evaluator revision/calibration is explicit.  
PROOF-P05 missing required proof class cannot yield green admission.  
PROOF-P06 mutation of an exact invariant makes deterministic proof fail.  
PROOF-P07 proof classification is metadata over existing Assurance, not a new authority.

## Sequencing

Route into #130/#151 when their write sets allow it. Do not release a parallel assurance packet from this research branch.
