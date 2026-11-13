# Research Dossier — The Mythical Man-Month × Peopleware

Sources:
- Frederick P. Brooks Jr., *The Mythical Man-Month*
- Tom DeMarco and Timothy Lister, *Peopleware: Productive Projects and Teams*

Status: TARGETED TRANSLATION PASS 1  
Authority: RESEARCH_ONLY

## Source basis

Brooks centers software-project problems around division of labor, communication/coordination cost, conceptual integrity, project dynamics and the absence of a universal "silver bullet."

Peopleware emphasizes that software-project failure is often human/organizational rather than purely technical, including environment, interruption, team formation, management pathologies and productive work conditions.

## KEYFLOWOS translation

### 1. More agents do not imply linear throughput

Agent parallelism has coordination cost:
- context handoff;
- write-set collisions;
- duplicate investigation;
- conflicting architectural assumptions;
- review/reconciliation;
- stale branch authority;
- repeated proof.

Therefore:

NET VERIFIED THROUGHPUT =
accepted useful change
- rework
- coordination cost
- context reconstruction
- regression cost
- architecture drift.

### 2. Conceptual integrity requires canonical semantic ownership

In KEYFLOWOS, conceptual integrity means:
- one execution substrate;
- one canonical tool/capability registry;
- one autonomy verdict seam;
- one memory retrieval layer;
- one source of truth per concern;
- explicit compatibility projections where legacy forms remain.

Parallel agents may implement components, but they may not independently invent competing meanings for the same concept.

### 3. Agent "teams" need bounded roles

The useful analogue of team specialization is:
- research;
- implementation;
- proof;
- semantic review;
- control/admission;
- release/merge authority.

Roles should be defined by evidence and authority, not by model personality.

A coding agent cannot independently become its own final reviewer and admission authority for a high-risk packet.

### 4. Handoffs should be minimized and made lossless

Every handoff should carry:
- exact objective;
- source revision;
- authority;
- write set;
- invariants;
- proof state;
- unresolved findings;
- next legal action.

This directly supports ContextBundle and durable repository intelligence.

### 5. Interruption has an agent analogue

AI agents do not literally experience human flow. But operationally, frequent task switching creates:
- context reload;
- rediscovery;
- stale assumptions;
- duplicated scans;
- higher error probability.

The development organism should preserve task continuity until a coherent checkpoint or genuine blocking condition.

### 6. No silver bullet applies to GenAI adoption

No foundation model, agent framework, vector database, evaluator suite or guardrail product removes the essential difficulty of:
- business semantics;
- authority;
- external effects;
- distributed truth;
- recovery;
- evidence;
- product design.

This strongly confirms the GenAI global convergence decision not to become a framework aggregator.

## GenAI cross-reference

- Layer 1: better model != solved system.
- Layer 3: multi-agent/orchestration must preserve conceptual integrity.
- Layer 8: capability ownership limits coordination ambiguity.
- Layer 9: independent proof/review prevents social/model confidence from becoming green.
- Layer 10: safety ownership cannot be delegated to vendor confidence.

## Candidate metrics for Development Organism

Per packet:
- agent handoff count;
- repeated context fetch count;
- write-set collision count;
- stale-authority correction count;
- review cycles;
- semantic heads produced;
- proof reruns caused by non-semantic churn;
- duplicate findings;
- time to first falsifiable proof;
- time to admitted merge.

Use metrics to improve routing; do not turn them into simplistic agent-performance scores.

## Candidate implementation

Do not add an "agent team service."

Instead:
- extend ContextBundle/packet metadata with handoff lineage where already available;
- derive offline development-organism metrics from issue/PR/control artifacts;
- feed findings into orchestration policy and packet sizing.

## Proof obligations

- multiple agents cannot hold conflicting write locks on same bounded write set;
- handoff preserves exact head and unresolved findings;
- stale handoff is detectable;
- packet cannot become green merely because another agent says it passed;
- parallel packets with disjoint write sets do not block each other unnecessarily.

## Disposition

ADOPT:
- conceptual integrity;
- coordination-cost accounting;
- bounded roles;
- durable handoffs;
- anti-silver-bullet discipline.

REJECT:
- "more agents = proportionally more speed";
- agent reputation as evidence;
- unbounded multi-agent democracy over canonical architecture.

No production change is authorized by this dossier.
