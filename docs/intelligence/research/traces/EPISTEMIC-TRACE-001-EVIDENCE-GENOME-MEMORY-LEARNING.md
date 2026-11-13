# Epistemic Trace 001 — Evidence, Genome Facts, Memory and Learning

Status: REPO PRESSURE TEST — PASS 1
Authority: RESEARCH ONLY
Target question: How does KEY know what is true?

## Trace scope

This pass inspected the live repository paths for:
- KeyCortex Evidence;
- Business Genome facts and Genome evidence;
- normalized cross-store memory;
- tool/action audit;
- KEY learning/feedback.

No production code was modified.

## 1. KeyCortex Evidence is proof-oriented, not general truth-oriented

KeyCortexEvidenceService creates Evidence records with:
- claim;
- claimType;
- proof payload;
- SHA-256 proof hash;
- confidence;
- source/sourceEventId;
- related module/entity;
- optional Genome/DNA contribution;
- explicit verification fields.

It supports later verification and proof-integrity checks.

Important semantic finding:

The service comment says that once evidence is verified, the evidence's claim is considered "proven." That is appropriate only at the evidence service's declared boundary. Cryptographic integrity proves that a stored proof payload has not changed; it does not independently prove that the payload corresponds to external reality.

Candidate law:
INTEGRITY != TRUTH.

Hash validity, source authority, claim correctness and domain truth must remain separate dimensions.

## 2. Genome Facts are a stronger domain-knowledge primitive

GenomeFactService stores:
- section/domain/field/value;
- source module/type/entity;
- confidence;
- freshness;
- quality/completeness/operational readiness;
- verification status;
- risk if wrong;
- verification/expiry timestamps.

Current verification vocabulary includes:
INFERRED, USER_VERIFIED, UNVERIFIED_IMPORTED, STALE, DISPUTED.

This is materially richer than generic memory and already models epistemic status.

GenomeFactService.listTopFacts currently selects working knowledge primarily by confidence and recency. Research question: should STALE/DISPUTED/high-risk facts be filtered or explicitly represented in prompt context rather than merely ranked?

## 3. Genome Evidence is distinct from KeyCortex Evidence

GenomeEvidenceService attaches evidence to a Genome fact with:
- source module;
- source entity type/id;
- summary;
- evidence strength;
- occurredAt.

It deduplicates an evidence relationship using fact + source identity and aggregates evidence count/average strength/latest timestamp.

Important finding:
KEYFLOWOS currently has at least two legitimate evidence concepts:
1. KeyCortex Evidence — generic proof-of-work / claim proof records with integrity hashing and verification.
2. Genome Evidence — supporting evidence for business-knowledge facts.

This is not automatically duplication. Their semantic owners differ. The convergence task is to define the relationship between them rather than collapse them blindly.

## 4. Memory normalization intentionally hides storage differences

MemoryFragment normalizes ten source types into one retrieval shape:
- ai_memory;
- ai_memory_embedding;
- genome_memory_event;
- temporal_flow_memory;
- cognition_memory;
- cognitive_event;
- conversation;
- business_event;
- ai_execution_log;
- cortex_action_log.

Common fields include:
sourceType, title, content, timestamp, confidence, relevance, recency, rank, optional entity identity and metadata.

Critical epistemic concern:

A normalized retrieval interface is useful for reasoning, but normalization can erase important distinctions between:
- observation;
- audit record;
- AI inference;
- business fact;
- execution outcome;
- conversation statement.

Candidate law:
UNIFIED RETRIEVAL != UNIFIED AUTHORITY.

MemoryFragment should remain a retrieval projection. It must not silently imply that fragments from different sources have equal epistemic authority.

## 5. Action audit captures execution attempts and outcomes

The tool registry writes CortexActionLog entries with:
- action/tool identity;
- success/error status;
- description;
- result/error;
- business/user identity;
- input, duration and autonomy metadata.

It also emits canonical BusinessEvent records for tool attempts.

This provides strong execution evidence, but execution success still must not be assumed to equal business-effect truth. Provider acceptance, external settlement, downstream reconciliation and later reversal may be separate.

Candidate law:
EXECUTION SUCCESS != BUSINESS OUTCOME.

## 6. KEY already has a persistent learning loop

KeyCortexLearningService:
- records recommendations/observations into CognitionMemory;
- records tool execution outcomes;
- records explicit user feedback;
- extracts lessons;
- stores confidence deltas;
- persists GenomeRecommendationOutcome and KeyEvolutionLog;
- retrieves prior lessons;
- calibrates confidence against historical acceptance rate;
- records prompt-variant wins/losses.

This is substantially more complete than the earlier high-level R&D hypothesis implied.

However, several epistemic risks remain.

### 6.1 User acceptance is not correctness

Confidence calibration currently uses historical acceptance rate as a significant signal.

A user accepting a recommendation may mean:
- correct;
- preferred;
- convenient;
- persuasive;
- low friction;
- not independently verified.

Candidate law:
ACCEPTANCE != TRUTH.

Acceptance is valid preference/interaction evidence, but it should not become a generic proxy for factual accuracy or outcome correctness.

### 6.2 Tool success/failure is simplified

recordOutcome maps tool success to accepted and tool failure to rejected, with fixed confidence values.

This is useful operational telemetry but semantically conflates:
- execution status;
- user response;
- factual confidence.

These should remain separate dimensions.

### 6.3 Lesson extraction can create secondary AI inference

Lessons may be generated by an LLM from query/recommendation/feedback/outcome.

Therefore a learned lesson is itself an INFERENCE unless independently verified. It should preserve provenance and should not silently become authoritative policy.

Candidate law:
LEARNED LESSON != VERIFIED RULE.

## 7. Emerging epistemic separation

The repository evidence supports at least these dimensions:

- CONTENT: what proposition/value is being represented?
- SOURCE: where did it come from?
- PROVENANCE: what chain produced it?
- INTEGRITY: has the stored evidence changed?
- CONFIDENCE: how strongly does a source/model support it?
- VERIFICATION: has an authorized verification procedure confirmed it?
- AUTHORITY: which domain boundary is allowed to declare truth?
- FRESHNESS: is the knowledge still timely?
- RISK_IF_WRONG: what is the consequence of relying on it?
- EXECUTION_STATUS: did an attempted action run?
- BUSINESS_OUTCOME: did the intended real-world effect occur?
- USER_RESPONSE: did the user accept/reject/modify it?
- MEMORY_RELEVANCE: is it useful to retrieve now?
- CANONICAL_STATUS: is it currently accepted, disputed, stale or superseded?

These dimensions should not be compressed into one confidence score.

## 8. Strong current hypotheses

H1. KEYFLOWOS does not primarily need a new "truth database." It needs an epistemic contract that preserves distinctions across existing semantic owners.

H2. Genome Fact is currently the strongest domain-fact precedent because it models source, confidence, verification, freshness and risk-if-wrong.

H3. KeyCortex Evidence is strongest for tamper-evident proof records, but proof-integrity and domain truth must remain distinct.

H4. UnifiedMemoryRetrievalService should remain a retrieval projection and should carry/source enough epistemic metadata for reasoning to distinguish authority classes.

H5. Learning needs provenance for learned lessons and must distinguish preference feedback, execution outcomes and independently verified business outcomes.

## 9. Candidate cross-cutting laws for pressure testing

1. INTEGRITY != TRUTH.
2. CONFIDENCE != AUTHORITY.
3. RETRIEVAL RELEVANCE != EPISTEMIC STRENGTH.
4. USER ACCEPTANCE != CORRECTNESS.
5. EXECUTION SUCCESS != BUSINESS OUTCOME.
6. MEMORY != FACT.
7. AI INFERENCE != CANONICAL STATE.
8. LEARNED LESSON != VERIFIED RULE.
9. DERIVED PROJECTION != SOURCE OF TRUTH.
10. A FACT IS TRUE ONLY AT A DECLARED AUTHORITY BOUNDARY AND TIME.

These are research candidates, not accepted architecture laws.

## 10. Next trace

EPISTEMIC-TRACE-002 should inspect:
- Prisma schemas for Evidence, GenomeFact, GenomeEvidence, BusinessEvent, CognitionMemory, ToolOutcomeScore and relevant recommendation/outcome tables;
- all significant writers of GenomeFact verificationStatus;
- stale/disputed/supersession semantics;
- whether memory prompt assembly preserves source type and epistemic status;
- whether ToolOutcomeScore changes future tool/model routing;
- whether actual business outcomes are reconciled after external provider ambiguity.

