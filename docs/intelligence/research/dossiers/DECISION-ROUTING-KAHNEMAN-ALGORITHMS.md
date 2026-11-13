# Research Dossier — Decision Routing: Thinking, Fast and Slow × Algorithms to Live By

Sources:
- Daniel Kahneman, *Thinking, Fast and Slow*
- Brian Christian and Tom Griffiths, *Algorithms to Live By*

Status: TARGETED TRANSLATION PASS 1 / REPLICATION-AWARE  
Authority: RESEARCH_ONLY

## Evidence caution

The behavioral-science literature has substantial reproducibility limitations. Large multi-lab replication projects have found that many published social-science effects do not replicate or reproduce at smaller effect sizes.

Therefore:
- use broad decision-process ideas as hypotheses;
- do not encode fragile named psychological effects directly into policy;
- prefer deterministic/measurable task features;
- calibrate against KEY-specific evaluation data.

## KEYFLOWOS translation

### 1. Fast and deliberate are computational modes

Do not anthropomorphize KEY as having human System 1/System 2.

Use:
- FAST: cheap, low-risk, familiar, reversible, well-specified;
- DELIBERATIVE: complex, uncertain, conflicting, strategic, high materiality;
- ESCALATE: unresolved authority/evidence or unacceptable uncertainty.

The existing `CognitiveTriageService` already has `reflex | standard | deliberate`; this is the canonical owner to strengthen.

### 2. Risk floors override linguistic simplicity

A short/simple utterance can still be semantically dangerous:
- "yes" confirming a payment;
- "delete it";
- "send it";
- "cancel that";
- "approve it".

The system already learned this on the reflex path. Generalize the law:

> linguistic simplicity must never override effect materiality, pending authority, or unresolved evidence.

### 3. Explore/exploit belongs in governed optimization

Explore/exploit ideas can inform:
- model routing experiments;
- retrieval strategy comparison;
- prompt strategy experiments;
- provider/cost optimization;
- recommendation experimentation.

They must not directly govern:
- payment authority;
- permissions;
- destructive actions;
- canonical business truth.

Exploration occurs inside declared safe experimental scope.

### 4. Optimal stopping is a bounded-resource policy

Useful analogues:
- when to stop tool/retrieval search;
- when enough evidence exists for a low-risk recommendation;
- when additional model calls have diminishing expected value;
- when to escalate to human/operator.

The stopping rule must include risk/materiality. A low expected informational gain is not permission to stop before a mandatory safety/authority check.

### 5. Scheduling and cache ideas remain mechanism-level

Scheduling/search/caching concepts can optimize:
- background work;
- context retrieval;
- test ordering;
- proof funnels;
- agent queues.

They do not become authority.

## GenAI cross-reference

- Layer 1: model-selection and effort routing.
- Layer 2: cost/latency aware inference.
- Layer 3: task routing and decomposition.
- Layer 6: safe explore/exploit for adaptation candidates.
- Layer 9: evaluation of routing/stopping policies.
- Layer 10: risk floors and mandatory checks.

## Candidate routing inputs

Deterministic/measurable where possible:
- action/effect class;
- reversibility;
- approval requirement;
- unresolved authority;
- evidence completeness;
- contradictory context;
- task complexity;
- time horizon;
- novelty/unknown capability;
- predicted cost/latency;
- tool count/dependency depth.

## Proof obligations

- protected effects cannot use reflex/cheap mode as a safety bypass;
- routing failure cannot grant authority;
- escalation reason is inspectable;
- low-risk tasks avoid unnecessary expensive deliberation;
- routing-policy revision is versioned/evaluated;
- model confidence alone cannot suppress mandatory checks;
- exploration is restricted to declared safe domains;
- mutation of a risk floor causes a protected-case test to fail.

## Disposition

ADOPT:
- computational effort tiers;
- bounded exploration;
- stopping/scheduling heuristics;
- evaluation-driven routing.

DEFER:
- specific cognitive-bias mechanisms until independently supported and useful.

REJECT:
- anthropomorphic policy labels as architecture;
- psychological effect names as authority;
- confidence as proof.

No production change is authorized by this dossier.
