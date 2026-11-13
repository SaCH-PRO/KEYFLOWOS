# INFORMATION VELOCITY TRACE 001 — Determinization, Signal Admission, and Minimum-Sufficient Cognition

Status: CROSS_LENS_TESTED / REPO_PRESSURE_TESTED / RESEARCH_ONLY
Date: 2026-10-06
Programme: KEYFLOWOS_MULTI_LENS_RND
Branch: docs/rnd-book-genai-convergence-001

## 1. Research question

What survives when neuroscience/reflex-pathway and optical/quantum information-transfer analogies are pressure-tested against the KEYFLOWOS R&D method and the live repository?

Primary candidate law:

> Convert uncertainty into deterministic computation wherever possible, while preserving uncertainty explicitly where it cannot honestly be eliminated.

This is not a claim that KEY should literally emulate neurons, quantum fields, photosynthetic complexes, or optical hardware.

## 2. Required transformation

SOURCE CLAIM
-> EVIDENCE CLASS
-> DURABLE PRINCIPLE
-> MODERN EVIDENCE / COUNTEREVIDENCE
-> KEY EQUIVALENT
-> LIVE REPO REALITY
-> GAP
-> ANTI-DUPLICATION
-> CANDIDATE CHANGE
-> PRESSURE TEST
-> ADOPT / REJECT / DEFER

## 3. Source-claim triage

### Neuroscience claims

#### N1 — fast synaptic release is triggered by Ca2+
Evidence class: ESTABLISHED MECHANISM, but original explanation overspecified CaMKII as the release trigger.

Modern evidence:
- synchronous neurotransmitter release is triggered by presynaptic Ca2+ acting through synaptotagmin-family Ca2+ sensors and SNARE/complexin fusion machinery;
- CaMKII is important in plasticity and other signaling but is not the general fast exocytosis trigger.

R&D disposition:
ADOPT corrected mechanism only as evidence for the abstract principle:
pre-positioned machinery + local trigger + minimal transformation yields low latency.

#### N2 — reflex pathways are fast because they minimize processing stages
Evidence class: ESTABLISHED GENERAL PRINCIPLE, with pathway-specific caveats.

R&D disposition:
ADOPT abstraction:
known, low-ambiguity, safety-bounded cases should terminate at the lowest sufficient processing tier.

Do not literalize specific neurotransmitter claims as architecture.

#### N3 — gap junctions remove chemical-synapse overhead
Evidence class: ESTABLISHED GENERAL MECHANISM.

R&D disposition:
ADOPT abstraction:
when two components are semantically tightly coupled and share a safe ownership boundary, avoid unnecessary translation/handoff layers.

Do not generalize this into unrestricted shared mutable state.

#### N4 — caffeine is an engineering model for maximum throughput
Evidence class: POOR ARCHITECTURAL ANALOGY.

Caffeine's principal ordinary-dose CNS action is adenosine-receptor antagonism; PDE inhibition is not the primary mechanism at typical human exposure.

R&D disposition:
REJECT as speed architecture.
Retain only the warning:
continuous overactivation is not equivalent to efficient information processing.

### Electromagnetic / optical claims

#### P1 — electromagnetic information propagation has a physical upper bound c
Evidence class: ESTABLISHED PHYSICS.

R&D disposition:
ADOPT abstraction only:
separate transport latency from semantic/computational latency.

#### P2 — modulation increases information carried per symbol
Evidence class: ESTABLISHED COMMUNICATIONS ENGINEERING.

R&D disposition:
ADOPT:
typed multi-dimensional envelopes can carry meaning, time, provenance, authority and evidence without repeated downstream reconstruction.

Caution:
more fields do not automatically mean more useful information. Optimize decision-relevant information density, not payload size.

#### P3 — coherent detection uses a reference signal to recover encoded state
Evidence class: ESTABLISHED OPTICAL COMMUNICATION MECHANISM.

R&D disposition:
ADOPT abstraction:
interpret deltas relative to an authoritative local reference state instead of reconstructing the entire world for every event.

#### P4 — zero rest mass means zero inertia and explains c
Evidence class: OVERSIMPLIFIED / MISLEADING.

R&D disposition:
REJECT as engineering premise.
No KEY architecture should be derived from this statement.

#### P5 — virtual photons are literal light-speed messages that continuously bind matter
Evidence class: MISLEADING POPULARIZATION.

R&D disposition:
REJECT literal mechanism and any architecture derived from it.
Retain only the generic systems question: can participants react to a shared state substrate rather than point-to-point conversational handoffs?

#### P6 — photosynthetic coherence samples every path simultaneously and instantly finds the fastest
Evidence class: OVERSTATED / CONTESTED INTERPRETATION.

Modern evidence supports ultrafast quantum effects, delocalization/coherence and highly efficient energy transfer in photosynthetic complexes, while the functional importance and simplistic "all paths / fastest path" story is not a sufficient technical description.

R&D disposition:
REJECT the literal search analogy.
Retain a weaker principle:
multiple candidate pathways and environment-aware transfer can produce robust efficient routing without a single serial search.

## 4. Cross-lens convergence

### Law IV-1 — Minimum sufficient cognition
Correspondence:
- Programmer's Brain: working-memory/context limits;
- Ousterhout: hide mechanism behind deep interfaces;
- DDIA: avoid unnecessary distributed coordination;
- GenAI Layer 3: bounded orchestration;
- current CognitiveTriageService: reflex / standard / deliberate.

Verdict: STRONGLY SUPPORTED.

### Law IV-2 — Determinize what can be exact
Correspondence:
- SICP / formal computation: explicit interpreters and state transitions;
- TDD / Little Prover / Assurance: deterministic predicates deserve exact proof;
- DDIA: identifiers, retries, idempotency and state transitions must not be guessed;
- GenAI convergence: model intelligence is not authority.

Verdict: STRONGLY SUPPORTED.

Important qualification:
determinization must never manufacture certainty. If the input state is unknown, conflicting or stale, the deterministic result may need to be UNKNOWN / DEGRADED / ESCALATE.

### Law IV-3 — Delta cognition
Interpret incoming information relative to a pinned authoritative reference and process the smallest meaningful change.

Correspondence:
- Context Genome temporal/provenance semantics;
- state reducer fold;
- ContextBundle source revisions;
- event-driven domain architecture.

Verdict: IMPLEMENTATION-BEARING, PARTIALLY PRESENT.

### Law IV-4 — Semantic preservation
Avoid repeatedly translating a signal across services/agents when one typed canonical envelope can survive transport boundaries.

Correspondence:
- Capability Contract;
- ActionEnvelope;
- typed authority envelope;
- ContextBundle;
- Evidence/Outcome lineage.

Verdict: IMPLEMENTATION-BEARING, PARTIALLY PRESENT.

### Law IV-5 — Inhibitory propagation
Not every event should wake every subsystem.

Possible dispositions:
DROP / STORE_ONLY / UPDATE_STATE / REFLEX / COGNITIVE / ESCALATE.

Correspondence:
- CognitiveTriage;
- event routing;
- rate limits;
- capability/authority gates.

Verdict: CANDIDATE. No single canonical generalized signal-admission contract is proven live.

### Law IV-6 — Verified-path compilation
Repeated verified outcomes may justify a cheaper deterministic/procedural route.

Correspondence:
- Procedural Morphogenesis;
- Assurance;
- governed learning/promotion;
- Flow.

Hard boundary:
Episode != Procedure != Permission.

Verdict: IMPLEMENTATION-BEARING, but later-stage.

## 5. Live repository pressure test

### Already present deterministic islands

1. Agent-control typed authority reducer
   - deterministic fold of valid typed authority over a reviewed checkpoint;
   - malformed/contradictory authority stops the fold;
   - negative controls prove fail-closed behavior.

2. Context Compiler prototype
   - deterministic ContextBundle generation;
   - same source snapshot + generator revision is intended to yield the same projection;
   - research-only and not yet integrated into the live worker.

3. CognitiveTriageService
   - zero-model-call classifier on the real Flow path;
   - reflex / standard / deliberate tiers;
   - already demonstrates cheap deterministic routing before model cognition.

4. CapabilityContractService / FLOW_TOOLS projection
   - deterministic capability identity/metadata projection.

5. KF-EXEC-ACTION-001 action boundary
   - deterministic envelope fingerprint;
   - capability/control/clearance semantics;
   - atomic execution claim and evidence for the adopted capability.

6. Proof-admission / negative controls
   - deterministic invariants are tested with defect-restoring mutations.

7. Domain computations
   - many finance/date/state/validation operations are already deterministic and should remain outside LLM reasoning.

### Partial system

KEYFLOWOS therefore already follows the law in multiple bounded owners.

However, there is no single cross-cutting mechanism that systematically asks, for every cognitive task:

- which claims can be computed exactly?
- which values can be derived from canonical state?
- which uncertainty can be reduced by retrieval?
- which uncertainty is irreducible and must remain explicit?
- which residual problem actually requires a model?
- what deterministic checks must validate the model output?

This gap is real.

## 6. Anti-duplication ruling

DO NOT create a new universal DeterminismService, rules engine, workflow runtime or second cognition router.

The missing capability should be expressed as a protocol/contract across existing owners:

Context Compiler / Context Genome
-> Cognitive Function contract
-> deterministic pre-computation / predicates
-> residual uncertainty
-> model strategy only when required
-> deterministic post-validation
-> Capability / Authority
-> Effect / Evidence
-> Assurance.

A potential research name is Determinization Protocol, but this is vocabulary only until canonical architecture promotion.

## 7. Candidate Determinization Protocol

For a cognitive operation C:

1. PIN
   Resolve exact tenant, source revisions, valid-time context and authority-relevant state.

2. DECOMPOSE
   Split requested output into:
   - exact computable fields;
   - deterministic policy/state predicates;
   - retrievable factual fields;
   - uncertain/inferential fields.

3. COMPUTE
   Execute exact fields and predicates using canonical services/functions.

4. REDUCE
   Construct residual uncertainty U_residual.

5. ROUTE
   If U_residual is empty, do not call a model.
   If bounded/low-risk, standard cognition.
   If high-risk/novel/conflicted, deliberate or escalate.

6. VALIDATE
   Apply schema, deterministic invariants, authority and evidence checks to any model output.

7. PRESERVE UNCERTAINTY
   Never convert missing/conflicting evidence into a false exact value.

8. OBSERVE
   Record latency, model calls avoided, context bytes/tokens, deterministic coverage, residual uncertainty and outcome.

## 8. Candidate metrics

- deterministic_coverage = exact_or_rule_resolved_fields / total_required_fields
- model_avoidance_rate = eligible_operations_completed_without_model / eligible_operations
- residual_uncertainty_rate
- semantic_transform_count
- context_bytes_or_tokens_per_decision
- authority_lookup_count
- coordination_handoffs
- p50/p95 semantic latency
- correction/reversal rate after execution

These are optimization metrics, not correctness proof by themselves.

## 9. Pressure-test cases

### Case A — invoice arithmetic
Exact totals, due dates, tax arithmetic and payment status are deterministic.
LLM should not calculate authoritative financial truth.

Verdict: DETERMINIZE.

### Case B — "is this customer likely to churn?"
Requires evidence selection and inference.

Verdict:
deterministically compute factual features first; preserve inference as uncertain; model may reason over the residual.

### Case C — "send this approved quote"
Capability identity, authorization, idempotency and effect state are deterministic.
Natural-language interpretation may identify the requested object, but cannot authorize effect.

Verdict: MIXED; deterministic execution boundary.

### Case D — ambiguous user intent
Cannot honestly be reduced to an exact rule without sufficient evidence.

Verdict: PRESERVE UNCERTAINTY / ASK / DELIBERATE, not fake determinization.

## 10. R&D state

- source claims: TRIAGED;
- modern evidence/counterevidence: PARTIALLY VERIFIED for material neuroscience/photosynthesis claims;
- cross-lens test: COMPLETE PASS 1;
- repo pressure test: COMPLETE PASS 1;
- anti-duplication: COMPLETE PASS 1;
- candidate protocol: DEFINED;
- architecture promotion: NOT YET;
- implementation authority: NONE.

## 11. Recommendation

Promote the law, not a new runtime:

> Every KEY cognitive operation should resolve the maximum safe subset of its work through deterministic state, computation and policy before invoking probabilistic cognition; the unresolved remainder must stay explicitly uncertain and any model result must re-enter deterministic validation/authority/evidence boundaries.

Next architecture action:
pressure-test this protocol against CognitiveFunction/ModelGateway, Context Compiler, CognitiveTriage and the current Flow/action path before allocating an implementation packet.
