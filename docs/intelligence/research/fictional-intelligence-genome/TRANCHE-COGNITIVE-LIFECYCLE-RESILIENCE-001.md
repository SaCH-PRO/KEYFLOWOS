# KIGP Tranche — Curiosity, Abstraction, Resource Economics, Forgetting, Graceful Degradation

Status: RESEARCH_ONLY
Programme: KIGP-001
Recorded: 2026-10-06

## Purpose
Close major remaining genome gaps before KIGP v0.1 convergence: curiosity, abstraction formation, creative invention, self-directed learning, attention/resource economics, forgetting/consolidation, graceful degradation, partial cognitive failure and recovery.

## Track A — Candidate genes

### G148 — Curiosity Trigger
KEY should initiate bounded investigation when it detects high-value uncertainty, contradiction, anomaly or unexplained variance. Curiosity is not free exploration; it is gated by expected information value, cost, risk and relevance.

### G149 — Question Generation
A mature cognitive system should generate useful questions from gaps in its model rather than only answer supplied questions. Candidate classes: missing cause, missing dependency, contradictory state, stale assumption, unexplained outcome, unverified authority.

### G150 — Abstraction Formation
When repeated concrete cases share stable structure, KEY may form a candidate abstraction. Promotion requires cross-case evidence and anti-duplication review so abstraction does not become premature architecture.

### G151 — Abstraction Compression Test
A new abstraction is justified only if it reduces complexity while preserving important distinctions and improving prediction, reuse or control. If it hides critical truth, it is rejected.

### G152 — Creative Recombination
Novel solutions may emerge by recombining validated primitives across domains. Creativity should preserve parentage, constraints and testability.

### G153 — Novelty / Usefulness Separation
A solution can be novel but useless, or useful but not novel. KEY should evaluate both dimensions separately rather than reward novelty for its own sake.

### G154 — Prototype Before Canonicalization
Newly invented capabilities or models should enter sandbox/prototype state first. Canonical architecture follows only after evidence, pressure testing and convergence.

### G155 — Self-Directed Learning Agenda
KEY may maintain a bounded backlog of unresolved questions whose answers could materially improve future performance. Agenda items require owner/relevance, expected value, cost ceiling, expiry and permission class.

### G156 — Information-Gain / Cost Tradeoff
Choose learning actions by expected reduction in decision-relevant uncertainty per unit of cost/time/risk, not by curiosity alone.

### G157 — Attention Budget
Attention is a scarce resource. KEY should allocate cognition across urgent, important, uncertain and strategically valuable work rather than process all signals equally.

### G158 — Compute Budget Routing
Reasoning depth/model cost should scale with complexity, impact, uncertainty and reversibility. Low-risk questions should not invoke expensive deep cognition by default.

### G159 — Interruption Threshold
Background cognition should surface to the user only when expected value exceeds interruption cost or a configured threshold.

### G160 — Memory Consolidation
Frequently reused, highly connected, high-value or strongly evidenced information may be promoted from episodic traces into durable semantic/procedural memory while retaining provenance.

### G161 — Forgetting as Governance
Not all information should persist indefinitely. Forgetting/archival can be driven by expiry, legal policy, privacy, low value, supersession, irrelevance or storage cost; deletion must preserve required audit/lineage semantics where applicable.

### G162 — Retrieval Decay / Freshness Weighting
Old information should not disappear merely because it is old, but retrieval relevance should account for freshness, domain volatility and supersession.

### G163 — Memory Compression With Loss Accounting
Summaries/compressions must record source coverage and known information loss. Compression is a projection, not a replacement for authoritative underlying evidence when that evidence must remain available.

### G164 — Graceful Degradation
When one cognitive dependency fails, KEY should reduce capability explicitly rather than silently fabricate normal operation.

Examples:
- memory unavailable -> answer with reduced context and disclose;
- evaluator unavailable -> block high-risk action;
- provider unavailable -> fall back to approved alternative;
- world-model stale -> restrict autonomous decisions.

### G165 — Capability Health State
Every major cognitive capability can expose health: READY / DEGRADED / UNAVAILABLE / UNVERIFIED / STALE. Planning should route around degraded capabilities and tighten authority where needed.

### G166 — Partial Cognitive Failure Isolation
Failure in one subsystem should not corrupt unrelated cognitive state. Use bounded failure domains and typed error propagation.

### G167 — Checkpoint / Recovery
Durable identity, commitments, active goals, authority, critical memory lineage and in-flight effect state should survive process/model/worker loss through recoverable checkpoints.

### G168 — Recovery Before Resumption
After crash or partition, KEY must reconstruct authoritative state, reconcile in-flight effects, restore commitments and revalidate authority before resuming autonomous execution.

### G169 — Model / Provider Failover
Fallback to another model/provider is permitted only when task requirements, privacy, authority and capability equivalence are satisfied. Failover must preserve identity and provenance.

### G170 — Cognitive Circuit Breaker
Repeated failures, contradictions, timeouts or low-confidence outputs can trip a capability-level circuit breaker, forcing fallback, human review or safe mode.

### G171 — Safe Mode
KEY should possess a minimal, deterministic safety-preserving operating mode that retains identity, authority checks, critical commitments and observability while advanced cognition is impaired.

### G172 — Recovery Evidence
Recovery is not complete because a process restarted. It requires evidence that critical invariants, state lineage, effect certainty and dependencies are restored.

## Anti-genome additions
- AG59 Curiosity consumes unbounded resources.
- AG60 Question generation turns into irrelevant exploration.
- AG61 Repeated examples are prematurely turned into universal abstractions.
- AG62 Novelty is rewarded without usefulness/proof.
- AG63 Prototype silently becomes canonical.
- AG64 Every signal receives equal cognitive attention.
- AG65 Expensive reasoning is used indiscriminately.
- AG66 Background agent constantly interrupts the user.
- AG67 Memory grows forever without retention policy.
- AG68 Compression silently replaces evidence.
- AG69 Degraded cognition pretends to be healthy.
- AG70 One failed subsystem corrupts the whole cognitive state.
- AG71 Restart is mistaken for recovery.
- AG72 Provider failover changes privacy/authority semantics silently.
- AG73 Repeated failure never trips a circuit breaker.
- AG74 Safe mode is absent, so degraded operation remains fully autonomous.

## Track B — Convergence candidates

### Cognitive Fabric
Add question generation, abstraction formation, resource-aware reasoning, compute routing and capability health.

### R&D Loop
Curiosity becomes a bounded research queue:
ANOMALY/GAP -> QUESTION -> VALUE/COST/RISK SCORE -> RESEARCH/EXPERIMENT -> EVIDENCE -> MODEL UPDATE -> CLOSE/DEFER.

### Context Genome
Pressure-test memory lifecycle semantics: episodic -> consolidated -> superseded/archived/expired, with provenance and compression-loss accounting.

### Mission Control / Atlas
Potential projection only: cognitive subsystem health, degraded dependencies, circuit-breaker state, safe mode, unresolved questions and recovery status.

### Authority / Action
Degraded state should reduce—not expand—autonomy. High-risk execution can require healthy evaluator, fresh authority and known world state.

### Agent Runtime
Workers need compute/attention budgets, interruption policy, failure isolation, checkpointing and recovery-before-resumption.

## Candidate resource loop
SIGNALS -> SALIENCE -> PRIORITY -> BUDGET -> REASON/RESEARCH -> OUTCOME -> VALUE/COST EVALUATION -> FUTURE BUDGET UPDATE

## Candidate recovery loop
FAILURE -> ISOLATE -> ENTER DEGRADED/SAFE MODE -> LOAD CHECKPOINT -> RECONCILE EFFECTS/STATE -> REVALIDATE AUTHORITY -> VERIFY INVARIANTS -> RESUME / REMAIN DEGRADED

## Status
EXTRACTED -> CROSS-CONVERGENCE IN PROGRESS.
No implementation authority.
