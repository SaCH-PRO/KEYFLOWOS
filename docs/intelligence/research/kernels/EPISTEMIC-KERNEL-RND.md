# Research Kernel — Epistemics

Status: ACTIVE R&D
Canonical architecture status: NOT ADOPTED

## Question
How does KEY know what is true?

## Existing knowledge-bearing structures surfaced
Business Genome facts/VerificationStatus; Evidence; BusinessEvent; CognitiveEvent; GenomeMemoryEvent; CognitionMemory; TemporalFlowMemory; AiExecutionLog; CortexActionLog; ToolOutcomeScore; architecture findings/contradictions/recommendations.

Genome VerificationStatus already distinguishes INFERRED, USER_VERIFIED, UNVERIFIED_IMPORTED, STALE and DISPUTED. Cortex evidence paths already carry source/confidence/module concepts. Genesis -> Genome preserves evidence back to originating answers. Learning/action/outcome structures already exist.

The research problem is therefore not automatically "create another store." It is whether one coherent semantic law explains how these forms relate.

## Distinctions that must not collapse
- Observation: something was perceived.
- Claim: an actor/system asserts a proposition.
- Inference: a proposition is derived from other evidence.
- Fact: a domain authority accepts a proposition as true at a declared boundary.
- Decision: an authorized actor selects a course of action.

These may relate but are not interchangeable and should not all become generic memory.

## Candidate conceptual frame
SUBJECT -> CLAIM -> {EVIDENCE, PROVENANCE, AUTHORITY} -> BELIEF -> CONFIDENCE -> STATUS.

Lifecycle candidate:
OBSERVATION -> CLAIM -> EVIDENCE -> INTERPRETATION -> DECISION; new evidence may CHALLENGE -> confirm/revise/reject -> supersession.

This is conceptual only. Do not create a universal database table from it without convergence.

## Cross-lens questions
Weinberg: can agents disagree without author identity becoming authority?
Hermans: distinguish knowledge absence, retrieval failure, context overload, representation failure and reasoning failure.
Kahneman: how should confidence/heuristics/bias be handled, after empirical re-verification?
Norman: can users understand what KEY observed, believes, intends, did and can undo?
Brooks: does the model preserve conceptual integrity?
Peopleware: does the reasoning environment support good evidence handling?
SICP: are the abstraction boundaries correct?
Clean Code: are distinctions legible without aliases/overloaded statuses?
Kernighan/Pike: can it be simpler and more debuggable?
DDIA: what happens under duplicates, ordering, retries, concurrency, partial persistence, disagreement, replay and reconciliation?
Algorithms to Live By: how should evidence update belief and when is evidence sufficient to act?
Software Design X-Rays: does change history contradict intended epistemic ownership?

## Next microscopic traces
1. Evidence model/service writers/readers end to end.
2. Genome fact creation, verification, dispute, staleness and replacement.
3. BusinessEvent/CognitiveEvent -> memory -> reasoning consumption.
4. Action outcome -> ToolOutcomeScore/learning -> changed future routing/policy.
5. Authority semantics across domain facts, financial truth and AI inference.
6. Duplicated provenance/confidence vocabularies.
7. Authoritative vs derived/audit-only structures.

## Safety
Do not implement from this file directly. Surviving results must enter normal finding/contradiction/recommendation and convergence machinery.
