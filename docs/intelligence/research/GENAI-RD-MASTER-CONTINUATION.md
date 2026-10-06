# KEYFLOWOS — Massive GenAI R&D Programme Continuation Map

Status: PROGRAMME CONTINUITY CORRECTION / RESEARCH FIRST  
Date: 2026-10-05  
Origin anchor: user-supplied "THE GEN AI TECH STACK - 2026" 10-layer reference image.

## Critical continuity correction

The massive GenAI R&D programme originated from the user's 10-layer **GEN AI TECH STACK - 2026** reference image.

The programme method was to take that stack seriously as a research map: research each layer and its named systems individually, retain transferable discoveries, compare them with KEYFLOWOS and KEY, then cross-analyze/converge after the research set is sufficiently complete.

R&D-03 is only **Layer 3 — Orchestration Frameworks**. Its completion must never be interpreted as completion of the wider GenAI programme.

Prepared implementation packet `KF-EXEC-COGNITION-001` remains PARKED until the wider research programme reaches an appropriate convergence point.

# Source 10-layer stack

## Layer 1 — Foundation Models
Image examples:
- GPT-5.x
- Claude Opus 5
- Gemini 3.x
- Llama 4
- DeepSeek V4
- Qwen 3.x

Research domain:
model families, reasoning behavior, multimodality, tool use, context, model routing, cost/latency, open vs closed weights, deployment constraints, capability/evaluation evidence.

## Layer 2 — Model Serving & Inference
Image examples:
- vLLM
- Ollama
- llama.cpp
- Groq
- AWS Bedrock
- Vertex AI

Research domain:
serving architecture, local/cloud inference, batching, KV cache, quantization, throughput/latency, routing, failover, portability, provider abstraction, observability and economics.

## Layer 3 — Orchestration Frameworks
Image examples:
- LangChain
- LangGraph
- LlamaIndex
- CrewAI
- AutoGen
- Pydantic AI

KEYFLOWOS research additionally included Microsoft Agent Framework because AutoGen's evolution/successor path made it relevant.

Status: **INDIVIDUAL RESEARCH + LAYER CONVERGENCE COMPLETE**.

Durable conclusions include:
- do not add a second agent/workflow runtime;
- absorb useful architecture natively;
- preserve existing KEYFLOWOS truth/durability owners;
- five AI-layer constructs survived backward pressure testing;
- implementation work is prepared but parked.

## Layer 4 — Embeddings & Rerankers
Image examples:
- OpenAI Embeddings
- Cohere Rerank
- Voyage AI
- Jina
- BGE
- Nomic Embed

Research domain:
dense/sparse/hybrid representations, embedding selection, reranking, retrieval quality, multilingual/domain behavior, dimensionality/storage economics, freshness/versioning, evaluation and failure modes.

## Layer 5 — Vector Databases
Image examples:
- Pinecone
- Qdrant
- Weaviate
- Milvus
- Chroma
- pgvector

Research domain:
ANN indexes, filtering, hybrid retrieval, multitenancy, consistency, versioning/deletion, operational complexity, Postgres-native vs specialized stores, and the boundary between retrieval indexes and canonical memory/truth.

## Layer 6 — Fine-tuning & Adaptation
Image examples:
- Hugging Face
- PEFT / LoRA
- Unsloth
- Axolotl
- TRL
- LLaMA-Factory

Research domain:
SFT, PEFT/LoRA/QLoRA, preference optimization/RL methods, distillation, continual adaptation, data curation, catastrophic forgetting, eval gates, model ownership and when adaptation is superior/inferior to retrieval/context/tooling.

## Layer 7 — Prompt & Output Control
Image examples:
- DSPy
- Instructor
- Outlines
- Guidance
- BAML
- Structured Outputs

Research domain:
prompt programming/optimization, typed outputs, constrained decoding, grammars, schema generation, correction loops, prompt/version provenance, prompt injection boundaries and deterministic contract enforcement.

Note: R&D-03/Pydantic AI produced relevant provisional findings here, but that does **not** substitute for a dedicated Layer-7 study.

## Layer 8 — Tool & Context Protocols
Image examples:
- MCP
- Function calling
- A2A
- Computer use
- Composio
- Arcade

Research domain:
tool protocols, capability discovery, context exchange, agent-to-agent protocols, computer/browser/mobile interaction, authentication/authorization, external effect identity, connector lifecycle and interoperability.

This layer strongly intersects KEYFLOWOS Capability Fabric, integrations, phone/computer control and KEY's action surface.

## Layer 9 — Evaluation & Observability
Image examples:
- LangSmith
- Langfuse
- Ragas
- DeepEval
- Arize Phoenix
- Weights & Biases Weave

Research domain:
offline/online evals, traces, retrieval eval, agent trajectory eval, LLM-as-judge limits, human evaluation, regression suites, red-team datasets, cost/latency telemetry and proof admission.

## Layer 10 — Guardrails & Safety
Image examples:
- NeMo Guardrails
- Guardrails AI
- Llama Guard
- Lakera
- Presidio
- Rebuff

Research domain:
input/output/tool guardrails, policy enforcement, prompt-injection defense, PII/privacy, content classifiers, action safety, authority, least privilege, sandboxing, exfiltration controls, audit and failure containment.

# KEYFLOWOS expansion beyond the source image

The image is the programme's origin map, not the ceiling of the research.

KEY/KEYFLOWOS requires cross-cutting tracks that the 10-layer graphic does not adequately represent:

## Memory / World Model
M0 Memory Truth Audit
-> M1 semantic contract
-> M2 portable Vault protocol
-> M3 content-addressed sources
-> M4 claims
-> M5 entity graph
-> M6 Wiki/INDEX
-> M7 Context Compiler
-> M8 consolidation/procedural memory
-> M9 sync
-> M10 Mission Control

## Context Genome
Context compilation, source selection, relevance, compression, provenance, temporal state, authority-sensitive projections, context budgets and world-model views.

## Learning / Ingestion
LEARN-MAP-001
-> CONTRACT
-> FEED
-> HTTP
-> RESEARCH
-> SCHOLARLY
-> EPISTEMIC
-> SHADOW
-> ACTIVATE
-> PROMOTION
-> HORIZON

## Cognition / Reasoning
Reasoning, planning, decomposition, deliberation, uncertainty, reflection, decision quality, structured cognition and model-strategy selection.

## Autonomy / Self-Correction
Long-horizon agency, replanning, feedback, recovery, bounded self-improvement, outcome learning, delegated agents, budgets and authority inheritance.

## Development Organism
The autonomous system used to build KEYFLOWOS:
context/reconcile -> plan/decompose -> authority -> execute -> verify -> correct -> update durable state -> repeat.

The development organism is also an experimental proving ground for capabilities that may later become part of KEY.

## Supplemental cross-cutting tracks added from follow-up GenAI roadmap references

These supplements came from later user-supplied GenAI roadmap/mind-map images. They **extend** the canonical 10-layer source stack and do not replace it, renumber it, or restart completed Layers 1-7.

### Context Engineering
Dedicated research on how authoritative context is compiled for one cognitive operation:
available state -> candidate context -> relevance -> authority -> temporal validity -> ordering -> compression -> token budget -> cacheability -> model-specific formatting -> execution -> measured outcome.

Priority topics:
- context as a budget;
- ordering and salience;
- prompt/context caching;
- compression and summarization;
- model-specific context layouts;
- contradiction handling;
- context poisoning;
- context failure modes;
- context-window economics.

This track must strengthen Context Genome rather than create another memory owner.

### Production RAG / Graph Retrieval
Layer-4/5 work already covers embeddings, hybrid retrieval, reranking and vector stores. The follow-up roadmaps add explicit gaps:
- ingestion-to-retrieval pipeline evaluation;
- query rewriting/expansion;
- grounding;
- GraphRAG / entity-and-relationship-aware retrieval;
- fusion of exact, lexical, vector, temporal, graph and metadata channels.

For KEY, GraphRAG is especially relevant because Context Genome/business graph/world-model work already creates structured relationships that generic chunk-only RAG lacks.

### Perception / Multimodal KEY
Elevate multimodal perception into an explicit cross-cutting R&D track:
- vision/images/screenshots;
- document AI / layout / tables;
- speech-to-text;
- text-to-speech;
- realtime voice;
- calls/audio;
- screen/computer perception;
- video/temporal perception where justified.

Perception outputs feed Context Genome/evidence/cognition. They do not become independent canonical truth owners.

### LLMOps / Deployment / Sovereignty
Dedicated cross-cutting evaluation of:
- KV-cache engineering;
- prompt caching;
- inference caching;
- monitoring;
- deployment/CI-CD;
- managed cloud vs KEY-controlled cloud;
- on-prem/self-hosted;
- edge/local/mobile;
- provider blackout survival;
- data residency/privacy;
- cost/latency/availability tradeoffs.

This extends Layer 2 and #137 Cognitive Independence without reopening completed Layer-2 convergence.

### Evals/security additions routed into Layers 9-10
The later roadmaps reinforce:
- red teaming;
- evals in CI;
- LLM-as-judge limits;
- prompt injection;
- agent/tool security;
- human-in-the-loop;
- benchmark discipline.

These should be absorbed into canonical Layers 9 and 10 rather than becoming another competing safety/eval stack.

### Explicit non-additions
Educational prerequisites such as Python, linear algebra, probability, RNN/LSTM, Word2Vec and generic career/job-roadmap material are **not** new KEYFLOWOS R&D tracks unless a later concrete architecture need justifies them.

# Research method

For each source layer and each necessary KEYFLOWOS expansion:

1. recover what has already been studied;
2. isolate individual technologies/concepts;
3. research primary/strong sources;
4. extract properties and failure modes;
5. compare with current KEYFLOWOS repository reality;
6. classify discoveries against existing kernels/contracts;
7. retain useful findings without premature adoption;
8. perform layer-level convergence only after individual studies;
9. perform cross-layer convergence after enough layers mature;
10. only then authorize bounded implementation.

# Current verified programme status

Continuity checkpoint updated after completion of the Layer-8 convergence pass.

| Layer | Status |
|---|---|
| 1 Foundation Models | individual research + convergence recovered/complete |
| 2 Model Serving & Inference | individual research + convergence recovered/complete |
| 3 Orchestration Frameworks | individual research + convergence complete; Microsoft Agent Framework retained as adjacent research, not a replacement for the source-image taxonomy |
| 4 Embeddings & Rerankers | 04A–04F complete + Layer-4 convergence complete |
| 5 Vector Databases | 05A–05F complete + Layer-5 convergence complete |
| 6 Fine-tuning & Adaptation | 06A–06F complete + Layer-6 convergence complete |
| 7 Prompt & Output Control | 07A–07F complete + Layer-7 convergence complete |
| 8 Tool & Context Protocols | 08A–08F complete + Layer-8 convergence complete |
| 9 Evaluation & Observability | **ACTIVE NEXT LAYER**; exact frontier is R&D-09A LangSmith |
| 10 Guardrails & Safety | not yet entered as the canonical source layer; substantial governance/security spillover already exists and must be preserved |

The master inventory/gap reconstruction was completed first and is durably recorded in GitHub issue #153. The source image remains the canonical origin taxonomy; adjacent research extends it without changing the six-item canonical checklist inside each source layer unless explicitly documented.

## Completed source-layer sequence after the inventory recovery

### Layer 4 — Embeddings & Rerankers
- R&D-04A OpenAI Embeddings
- R&D-04B Cohere Rerank / adjacent Embed findings
- R&D-04C Voyage AI
- R&D-04D Jina
- R&D-04E BGE / FlagEmbedding
- R&D-04F Nomic Embed
- Layer-4 convergence complete

Converged concept: **Governed Representation & Retrieval Fabric** as a logical cross-cutting contract, not a new truth owner or mandatory new kernel.

### Layer 5 — Vector Databases
- R&D-05A Pinecone
- R&D-05B Qdrant
- R&D-05C Weaviate
- R&D-05D Milvus
- R&D-05E Chroma
- R&D-05F pgvector
- Layer-5 convergence complete

Converged decision pressure: retain PostgreSQL + pgvector as the baseline until a properly tuned benchmark proves that a specialized vector store solves a measured KEYFLOWOS requirement. Vector stores remain rebuildable projections, not canonical truth.

### Layer 6 — Fine-tuning & Adaptation
- R&D-06A Hugging Face ecosystem
- R&D-06B PEFT / LoRA
- R&D-06C Unsloth
- R&D-06D Axolotl
- R&D-06E TRL
- R&D-06F LLaMA-Factory
- Layer-6 convergence complete

Converged concept: **Governed Adaptation & Model Artifact Lifecycle**. Model weights are replaceable competence artifacts, not KEY identity, memory, authority, policy or canonical truth.

### Layer 7 — Prompt & Output Control
- R&D-07A DSPy
- R&D-07B Instructor
- R&D-07C Outlines
- R&D-07D Guidance
- R&D-07E BAML
- R&D-07F Structured Outputs
- Layer-7 convergence complete

Converged concept: **Cognitive Function Contract & Execution Fabric**.

Logical package:

```
CognitiveFunctionRevision
  ├─ CognitiveContract
  ├─ PromptProgramArtifact
  ├─ OutputContract
  ├─ StructuredOutputStrategy
  ├─ ProviderExecutionProfile
  ├─ ValidationPolicy
  ├─ RetryRepairPolicy
  ├─ TestSuiteRef
  └─ EvaluationSuiteRef
```

Key Layer-7 repository finding: `GatewayRequest.responseFormat` exists, but current recovered provider dispatch paths do not consume it, so the declared response-format surface is not currently backed by recovered native provider enforcement. This is recorded as a no-fake-green gap, not as implemented structured-output support.

Layer-7 hard boundaries:
- provider-native structured output is an execution strategy, not semantic authority;
- schema validity is not factual correctness, business validity, permission or action authority;
- prompt programs cannot become a second durable workflow runtime;
- `FLOW_TOOLS` remains the governed action/capability surface;
- ModelGateway remains the provider-routing owner;
- third-party prompt-control frameworks are mechanism references, not adopted canonical runtimes.


### Layer 8 — Tool & Context Protocols
- R&D-08A MCP
- R&D-08B Function Calling
- R&D-08C A2A
- R&D-08D Computer Use
- R&D-08E Composio
- R&D-08F Arcade
- Layer-8 convergence complete

Converged concept: **Governed Capability, Connector & Delegation Fabric**.

Core conclusion:
- native FLOW_TOOLS/capability semantics, connector/account truth, credentials, authority and evidence remain KEY-owned;
- MCP is an external protocol adapter;
- Function Calling is a bounded model proposal surface;
- A2A is an external independent-agent delegation adapter;
- Computer Use is a last-mile fallback actuator;
- Composio and Arcade are reference architectures whose useful mechanisms are absorbed natively rather than onboarded as new canonical runtimes.

Key live repository gaps carried forward:
- MCP tenancy/business propagation is not yet faithful to its comments;
- ConnectorRegistry and the newer KeyConnector stack overlap and need convergence;
- connected-account truth/credentials remain fragmented across multiple surfaces;
- FLOW_TOOLS needs richer effect/idempotency/dependency metadata before safe parallel write execution;
- provider-level tool semantics are not fully normalized;
- product computer-use has no canonical environment/action/evidence contract;
- trigger/webhook/poll event ingress is not yet one normalized account-aware observation pipeline.

## Durable ledger

Detailed research tranches and convergence passes are durably appended to GitHub issue **#153**. Important recent continuity anchors include:
- GENAI-RD-MAP-001 recovery pass
- R&D-04A through 04F + Layer-4 convergence
- R&D-05A through 05F + Layer-5 convergence
- R&D-06A through 06F + Layer-6 convergence
- R&D-07A through 07F + Layer-7 convergence
- Layer-7 convergence comment id: **6008603830**
- R&D-08A MCP — comment id **6008878520**
- R&D-08B Function Calling — comment id **6008938834**
- R&D-08C A2A — comment id **6008959914**
- R&D-08D Computer Use — comment id **6009055442**
- R&D-08E Composio — comment id **6009194323**
- R&D-08F Arcade — comment id **6009207249**
- Layer-8 convergence — comment id **6009218421**

The issue ledger is supporting detail. This file remains the **master chat-rollover / active-frontier continuity map** and must be updated as the programme moves.

# Immediate next frontier

**R&D-09D — DeepEval**

Layer-9 progress:
1. LangSmith — COMPLETE first-pass; durable ledger comment id **6009291467**
2. Langfuse — COMPLETE first-pass; durable ledger comment id **6009369621**
3. Ragas — COMPLETE first-pass; durable ledger comment id **6009425710**
4. DeepEval — **ACTIVE NEXT**
5. Arize Phoenix — pending
6. W&B Weave — pending
7. Layer-9 convergence — pending

Key R&D-09C Ragas conclusions:
- retrieval quality must be decomposed into context precision, context recall, faithfulness/groundedness, response relevance, factual correctness and noise sensitivity rather than collapsed into one RAG score.
- KEY needs extra blocking dimensions absent from generic RAG metrics: source correctness, tenant isolation, authority eligibility, temporal validity, contradiction handling, citation resolvability and index freshness.
- current EvalHarnessService suite named memory-retrieval-precision does **not actually measure precision**; it only checks that results are arrays with numeric rankScore values.
- recall requires immutable reference source/fact sets tied to a dataset revision, tenant fixture, temporal cutoff and index generation.
- faithfulness is not truth: an answer can be perfectly supported by stale/wrong context and still be business-invalid.
- SemanticMemoryService/UnifiedMemoryRetrievalService can degrade failures to empty results, so eval must distinguish NO_MATCH from retrieval infrastructure failure.
- partial retrieval-channel/store failures must be visible in eval inputs/results.
- hard-coded retrieval weights in UnifiedMemoryRetrievalService need benchmark-driven validation, not assumption.
- synthetic testset/knowledge-graph generation is useful for multi-hop coverage but cannot be sole admission truth.
- cross-tenant retrieval, forbidden-source use and other hard safety violations must be zero-tolerance gates, not averaged metrics.
- current repo has no recovered GraphRAG implementation; graph-aware retrieval remains a supplemental R&D frontier.

R&D-09D required scope:
- unit-test-style LLM evaluation;
- G-Eval and custom criteria;
- RAG metrics and hallucination/faithfulness;
- agent/tool/trajectory evals;
- red teaming/adversarial evaluation if currently supported;
- synthetic/adversarial datasets;
- test-case/metric thresholds;
- CI integration;
- evaluator/model dependencies;
- compare DeepEval's pytest-style workflow with KEY's proof-admission and mutation/negative-control harness;
- determine what execution ergonomics are worth absorbing without making DeepEval a second admission authority.

Do not skip ahead to Arize Phoenix or implementation before R&D-09D is complete.
