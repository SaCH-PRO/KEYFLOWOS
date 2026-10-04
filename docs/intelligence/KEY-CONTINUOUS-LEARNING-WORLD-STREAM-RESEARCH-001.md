# KEY Continuous Learning Stream & World Knowledge Ingestion — Research Pass 001

Status: **RESEARCH / ARCHITECTURE CONVERGENCE — NO PRODUCTION CUTOVER AUTHORIZED**  
Live implementation reference: main@110532883411007787f62de35e0a951aa1c16cfa

Companions:
- KEY-CONCURRENCY-CONNECTIVITY-ADAPTIVE-RECEPTOR-RESEARCH-001.md
- KEYFLOWOS-CONTINUOUS-ASSURANCE-SECURITY-SURVEILLANCE-QUALITY-RESEARCH-001.md
- KEY-COGNITIVE-IMPLEMENTATION-CROSSWALK-001.md
- Memory / Context Genome programme (#122-#126)
- Connector Fabric PR #105
- Assurance Fabric #130
- Mission Control #129

## 1. User requirement

Establish a **continuous learning stream** for KEY that can connect to the web and every other legitimately accessible information resource, ingest many streams concurrently, preserve provenance, detect change, actively seek missing information, and turn useful evidence into durable knowledge without confusing "seen on the web" with "true".

This is not a crawler bolted onto KEY. It is the learning-side convergence of:
- Adaptive Receptor Fabric;
- Connector Fabric;
- Context Genome;
- K2 Reality / Epistemic Integrity;
- K3 Memory / World Model / Time;
- K5 Executive / Active Sensing;
- K7 Adaptation / Learning;
- Assurance / TEVV.

## 2. Existing repository reality

Current main already contains `KnowledgeIngestionService`, but it is explicitly dormant:
- it has zero injection/caller sites;
- `ingestText()` stores a `KnowledgeSource`, chunks content and writes to SemanticMemory;
- `ingestUrl()` records a URL but does not fetch it;
- it is listed in the unreachable-provider debt ledger.

Therefore:
- **SAME PROBLEM:** historical Knowledge Ingestion vision;
- **IMPLEMENTATION PRECURSOR:** current dormant service;
- **TARGET:** do not add a second `WebLearningService`; evolve/re-home the existing concept behind canonical receptor, epistemic and memory contracts.

## 3. Core learning law

```text
ACCESSIBLE INFORMATION
      !=
OBSERVATION
      !=
EVIDENCE
      !=
ASSERTION
      !=
ACCEPTED KNOWLEDGE
      !=
ACTION AUTHORITY
      !=
POLICY
      !=
MODEL WEIGHT
```

The learning stream must preserve these distinctions.

Web ingestion should update non-parametric, evidence-backed memory first.

Permanence must require progressively stronger proof:

```text
RAW OBSERVATION
 -> SOURCE RECORD
 -> CANDIDATE ASSERTION
 -> EVIDENCE-LINKED BELIEF
 -> CONSUMER-ELIGIBLE KNOWLEDGE
 -> CONSOLIDATED KNOWLEDGE
 -> PROCEDURE / SKILL
 -> POLICY PROPOSAL
 -> ADAPTER / MODEL CHANGE
```

No web page may directly rewrite KEY's constitution, authority, or foundation-model behavior.

## 4. Target architecture — World Learning Stream

```text
                          WORLD
                            |
      +---------------------+----------------------+
      |                     |                      |
      v                     v                      v
  OPEN WEB            CONNECTED SOURCES       INTERNAL REALITY
  APIs/feeds          Drive/Gmail/etc         outcomes/logs/events
  papers/data         SaaS/apps/devices       users/workflows
      |                     |                      |
      +---------------------+----------------------+
                            |
                            v
                   SOURCE DISCOVERY
                            |
                            v
                ACCESS / PERMISSION POLICY
                            |
                            v
                 ACQUISITION ADAPTERS
     API | MCP | RSS/Atom | WebSub | webhook | browser
     scholarly API | sitemap | file | CDC | device | search
                            |
                            v
               MULTI-STREAM SYNCHRONIZER
        backpressure | cursors | event time | dedupe
        retries | source health | late/out-of-order
                            |
                            v
                    RAW EVIDENCE VAULT
                            |
                            v
               NORMALIZE / EXTRACT / PARSE
                            |
                            v
                 PROVENANCE + SOURCE GRAPH
                            |
                            v
                  EPISTEMIC ADMISSION
        trust | authority | freshness | independence
        contradiction | verification | applicability
                            |
             +--------------+--------------+
             |                             |
             v                             v
         QUARANTINE                  CONTEXT GENOME
       weak/unknown                       |
       disputed                           v
       unsafe                       WORLD MODEL
                                         |
                                         v
                             RETRIEVAL / COGNITION
                                         |
                                         v
                                ACTION / OUTCOME
                                         |
                                         v
                                  K7 LEARNING
                                         |
              +--------------------------+-------------------+
              |                          |                   |
              v                          v                   v
        source weighting          receptor evolution    skill/procedure
        query strategy            new connector gap     proposals
```

## 5. Learning stream modes

### L1 — Passive subscriptions
Best for sources that natively emit change.

Examples:
- webhook;
- WebSub;
- RSS/Atom;
- message queues;
- CDC;
- provider events;
- connected app notifications.

### L2 — Incremental polling
For sources without push:
- ETag / If-None-Match;
- Last-Modified / If-Modified-Since;
- cursor APIs;
- updated-since filters;
- sitemap timestamps where useful.

### L3 — Active research
K5 decides that current knowledge is insufficient and issues a bounded research task:
- search;
- inspect primary sources;
- query a scholarly database;
- compare independent sources;
- retrieve current regulation/documentation;
- request clarification.

### L4 — Horizon scanning
Scheduled topic/source watch:
- regulation;
- standards;
- scientific literature;
- provider API changes;
- security advisories;
- market/industry change.

### L5 — Triggered investigation
A business/system event creates a temporary learning objective.

Example:
`payment provider behavior changed -> inspect provider status/docs/changelog -> compare local failures -> update working knowledge`.

### L6 — Outcome learning
KEY learns from its own actions and observed consequences.

This is not external knowledge ingestion but must join the same provenance/world-model loop.

## 6. Access hierarchy

Prefer the deepest authorized semantic interface:

1. user-connected/private resource API or connector;
2. official public API;
3. event/webhook/feed/subscription;
4. MCP or structured tool/resource protocol;
5. open scholarly/data repository APIs;
6. machine-readable site metadata/sitemaps;
7. ordinary HTTP web retrieval consistent with access policy;
8. authorized browser session/extension when necessary;
9. accessibility/UI automation only as a fallback.

Hard limits:
- never bypass authentication, paywalls, access controls or robots policy;
- honor rate limits and provider terms;
- respect copyright/licensing constraints;
- retain only content that the system is entitled to retain;
- where full-text retention is not appropriate, retain metadata, identifiers, hashes, evidence pointers and derived notes instead.

## 7. Web-native discovery and change primitives

### Robots Exclusion Protocol
Use RFC 9309 as a crawler access-control input.

`robots.txt` is not authorization to access otherwise protected content; it is one policy signal for automated retrieval.

### Atom / RSS
Atom provides stable feed/entry identity and update metadata.

Use for:
- product/provider changelogs;
- standards/news feeds;
- blogs;
- publication feeds;
- monitored sources.

### WebSub
Where publishers expose hubs, subscribe rather than polling continuously.

### HTTP validators
Persist:
- ETag;
- Last-Modified;
- content hash.

Use conditional requests so unchanged resources do not consume bandwidth/compute.

### Sitemaps
Useful for discovery and recrawl hints, not epistemic authority.

### Scholarly APIs
Examples:
- Crossref metadata / DOI graph;
- NCBI E-utilities / PMC services;
- arXiv/OAI-like repository feeds;
- domain-specific registries.

The source adapter should keep canonical external identifiers such as DOI/PMID/arXiv id where available.

## 8. Source Registry

Candidate contract:

```ts
interface LearningSource {
  sourceId: string;
  canonicalUri?: string;
  sourceClass:
    | 'CONNECTED_PRIVATE'
    | 'OFFICIAL_PRIMARY'
    | 'SCHOLARLY'
    | 'REGULATORY'
    | 'STANDARDS'
    | 'PROVIDER_DOCS'
    | 'NEWS'
    | 'COMMUNITY'
    | 'OPEN_DATA'
    | 'INTERNAL'
    | 'OTHER';
  accessBinding: string;
  ownerPublisher?: string;
  scope: string[];
  license?: string;
  robotsPolicy?: SourceRobotsPolicy;
  trustProfile: SourceTrustProfile;
  updateMode: string;
  cursor?: string;
  etag?: string;
  lastModified?: string;
  lastCheckedAt?: string;
  lastChangedAt?: string;
  lastSuccessfulAt?: string;
  failureState?: string;
  retentionPolicy: string;
  sensitivity: string[];
}
```

## 9. Source trust is multidimensional

Do not use one magic trust score.

Track separately:
- identity certainty;
- primary vs secondary;
- domain authority;
- historical reliability;
- recency;
- corroboration;
- independence;
- transparency/method;
- conflict history;
- manipulation risk;
- licensing/retention rights;
- applicability to current scope.

Examples:
- an official provider doc may have high authority for its own API but none for medical science;
- a peer-reviewed paper may be strong evidence but not current operational truth about a live provider;
- five websites repeating one press release are one evidence lineage, not five independent confirmations.

## 10. Observation envelope

Every acquired item becomes a source-bound observation before any semantic promotion.

Candidate:

```text
observation_id
source_id
source_resource_id
canonical_uri
source_event_id
retrieved_at
published_at / updated_at
valid_from / valid_to
content_hash
media_type
language
title
author/publisher
license
raw_pointer
extraction_version
parser_version
query/research_objective
causation_id
correlation_id
access_scope
source_identity
source_authority
verification_state
sensitivity
retention_class
```

## 11. Content processing pipeline

```text
fetch
 -> malware/content safety boundary
 -> decode
 -> canonicalize
 -> extract structure
 -> detect language
 -> segment semantically
 -> entity/relation candidates
 -> claims/assertions
 -> citations/evidence links
 -> temporal qualifiers
 -> contradiction candidates
 -> embeddings/indexes
 -> epistemic admission
```

Keep the raw/source pointer so derived claims can be re-audited.

The parser/extractor version must be stored because reinterpretation may change when extraction logic changes.

## 12. Epistemic admission

Before information can influence different consumers, evaluate eligibility.

Possible consumer classes:
- SEARCH_ONLY;
- WORKING_CONTEXT;
- LOW_RISK_RECOMMENDATION;
- BUSINESS_GENOME;
- AUTONOMY_READINESS;
- HIGH_RISK_ACTION;
- POLICY;
- LEARNING_PROMOTION.

Eligibility may depend on:
- source authority;
- freshness;
- corroboration;
- conflict;
- verification;
- scope;
- domain;
- legal/licensing;
- sensitivity.

This extends the existing law:

> STORED KNOWLEDGE != KNOWLEDGE ELIGIBILITY FOR A CONSUMER.

## 13. Contradiction and supersession

Learning must not silently overwrite history.

```text
old claim
   |
   +-- supported by source A
   |
new claim
   |
   +-- supported by source B
   |
   v
CONTRADICTION / SUPERSESSION ANALYSIS
```

Possible outcomes:
- same claim, stronger evidence;
- related but different scope;
- newer version supersedes older;
- unresolved contradiction;
- old source retracted/corrected;
- source itself changed;
- interpretation changed due to improved extraction.

Store lineage.

## 14. Change detection

A changed page is not necessarily new knowledge.

Pipeline:

```text
resource changed
 -> structural/content diff
 -> identify meaningful changed regions
 -> extract changed assertions
 -> compare with prior assertions
 -> update only affected knowledge
```

This reduces repeated ingestion and makes change explainable.

## 15. Research Objectives and Knowledge Gaps

KEY should maintain explicit `KnowledgeGap` / `ResearchObjective` objects.

Candidate fields:

```text
objective_id
question
why_needed
consumer
required_freshness
risk
domains
known_evidence
missing_evidence
preferred_source_classes
minimum_independence
deadline
budget
status
resolution
```

K5 can compile a research plan from these.

## 16. Active research planner

```text
QUESTION
 -> decompose subquestions
 -> identify likely source classes
 -> search/discover
 -> prefer primary sources
 -> retrieve
 -> compare
 -> detect missing/contradictory evidence
 -> targeted follow-up
 -> convergence criterion
 -> research result + evidence graph
```

Stop conditions should be explicit:
- sufficient primary evidence;
- diminishing value of information;
- budget exhausted;
- deadline reached;
- irreducible uncertainty;
- human decision needed.

This prevents endless browsing.

## 17. Multi-stream learning synchronizer

Learning streams must compose with the concurrency/connectivity fabric.

Responsibilities:
- bounded queues;
- per-source rate limits;
- backpressure;
- source priority;
- cursor management;
- event-time ordering;
- dedupe;
- content-hash reuse;
- retry;
- circuit breaker;
- source health;
- quota budget;
- fan-out parsing;
- deterministic join;
- partial completion.

A slow source must not freeze unrelated learning.

## 18. Adaptive learning gain

Use the regulatory-program model to up/down-regulate learning.

Examples:

### INCIDENT
- up-regulate official status/security sources;
- increase source cross-checking;
- shorten freshness TTL;
- retain incident evidence;
- suspend low-value background crawling.

### REGULATORY CHANGE
- increase relevant regulator/standards feeds;
- compare effective dates;
- identify affected policies and product surfaces;
- never auto-change policy solely from one retrieval.

### LOW LOAD
- perform background horizon scanning/consolidation.

### HIGH LOAD
- prioritize sources tied to active decisions;
- defer general enrichment;
- aggregate feed bursts.

## 19. Source evolution / receptor growth

Repeated unsupported information needs should become `ReceptorGap` candidates.

```text
repeated knowledge gap
 -> identify source/interface
 -> discover API/feed/MCP/descriptor
 -> compile candidate receptor
 -> sandbox
 -> shadow ingest
 -> compare quality/reliability
 -> governed promotion
```

Therefore the learning stream itself helps KEY expand the interface/tool/receptor base.

## 20. Learning promotion ladder

Do not continuously change neural weights.

Recommended ladder:

```text
1 observation
2 episodic/source memory
3 semantic assertion
4 consolidated knowledge
5 reusable retrieval pattern
6 procedure/skill
7 routing/priority adjustment
8 adapter or model fine-tune proposal
9 policy/constitution proposal
10 foundation-weight change (highest proof threshold)
```

Every higher step requires stronger TEVV and rollback.

This limits catastrophic forgetting and bad-data poisoning.

## 21. Poisoning and prompt-injection defense

External content is untrusted data, even when useful.

Hard separation:
- fetched text cannot become system/developer authority;
- instructions embedded in pages/documents are content unless the source is explicitly an authority channel for that instruction class;
- tools/URLs discovered inside content do not become trusted tools;
- retrieved secrets or personal data follow existing sensitivity/retention policy;
- malicious documents are processed within constrained parsers/sandboxes;
- learning promotion requires independent assurance.

## 22. Source-of-truth and source-of-learning distinction

Some sources are authoritative for specific truths.

Examples:
- payment provider for transaction status;
- GitHub for repository state;
- regulator for its regulation;
- user's connected calendar for the user's events.

The open web is normally a **source of evidence/learning**, not a canonical authority for private operational truth.

This prevents web results from overwriting transactional reality.

## 23. Continual-learning research implication

Continuous environmental learning is useful, but direct incremental model training risks forgetting and instability.

KEY should therefore be primarily:
- continuously updated through external memory/world model;
- selectively adapted through procedures/routing/adapters;
- model-updated only through offline governed evaluation.

This aligns with the current K7 learning hierarchy.

## 24. Assurance / TEVV

The learning stream needs its own proof.

Test:
- source identity;
- robots/access compliance;
- rate limiting;
- duplicate/change handling;
- stale-source detection;
- provenance preservation;
- source independence;
- contradiction handling;
- retraction/correction;
- malicious content;
- prompt injection;
- parser failure;
- wrong-language/encoding;
- enormous resources;
- redirects;
- loops;
- broken TLS;
- source outage;
- content drift;
- model extraction hallucination;
- poisoning;
- cross-tenant leakage;
- deletion/forget requests where applicable.

## 25. Mission Control integration

Add a Learning Stream view to #129:

- active sources;
- subscriptions;
- source health;
- current research objectives;
- ingestion rate;
- queue/backpressure;
- source freshness;
- contradictions;
- quarantined observations;
- admitted knowledge;
- KnowledgeGaps;
- ReceptorGap candidates;
- source-class distribution;
- last meaningful changes;
- failed/blocked acquisition;
- budget/quota use;
- learning promotion proposals.

No fake percentage:
show explicit counts such as:
`42/50 monitored sources fresh within their declared SLA`.

## 26. Implementation sequence

### LEARN-MAP-001 — current-state inventory
Map:
- KnowledgeIngestionService;
- KnowledgeSource schema;
- SemanticMemory;
- UnifiedMemoryRetrieval;
- connector inputs;
- watchers;
- web/browser/search utilities;
- document ingestion;
- Genome facts/evidence;
- Context Genome planned contracts.

### LEARN-CONTRACT-001 — source/observation contracts
Define:
- LearningSource;
- Observation;
- ResearchObjective;
- KnowledgeGap;
- SourceCursor;
- SourceHealth;
- EpistemicAdmissionDecision.

No active crawling yet.

### LEARN-FEED-001 — feed/push adapters
Read-only:
- Atom/RSS;
- WebSub where available;
- provider webhook/event adapters through Connector Fabric.

### LEARN-HTTP-001 — responsible incremental web fetch
Read-only:
- robots;
- ETag/Last-Modified;
- redirects;
- rate limit;
- bounded content;
- content hash;
- sitemap discovery;
- allow/deny policies.

### LEARN-RESEARCH-001 — bounded active research
Compile ResearchObjective to search/retrieve/compare/converge with evidence graph.

### LEARN-SCHOLARLY-001
Add descriptor/adapters for public scholarly metadata/resources, beginning with strongly structured sources such as Crossref/NCBI and repository feeds.

### LEARN-EPISTEMIC-001
Consumer-specific knowledge eligibility, contradiction and supersession.

### LEARN-SHADOW-001
Shadow-write LearningSource/Observation/Assertions beside existing memory with parity/effect tests.

### LEARN-ACTIVATE-001
Only after M0/M1 memory contracts and assurance proof permit it, make admitted knowledge available to selected low-risk consumers.

### LEARN-PROMOTION-001
Govern promotion from evidence-backed knowledge -> procedures/skills/routing/adapters.

### LEARN-HORIZON-001
Scheduled topic/source horizon scanning with budgets and relevance decay.

## 27. Relationship to current Memory programme

Sequence carefully.

Memory M0/M1 remain prerequisites for canonical persistence semantics.

Do not let this stream create yet another permanent store while the Context Genome contract is unresolved.

Safe early work:
- source discovery;
- source registry contract;
- read-only retrieval;
- evidence/provenance envelopes;
- shadow observations;
- evaluation.

Active durable cutover comes later.

## 28. Hard invariants

1. Accessible != authorized to retain or republish.
2. Retrieved != true.
3. Popular != authoritative.
4. Repeated != independent.
5. Newer != automatically better.
6. Primary-source preference does not remove the need for corroboration where consequences are high.
7. Web content cannot issue KEY authority merely by containing instructions.
8. A source is authoritative only within a declared domain/scope.
9. Every admitted claim remains traceable to evidence.
10. Deletions/retractions/corrections propagate through lineage.
11. Source outages degrade freshness honestly.
12. Learning is budgeted and backpressured.
13. Crawlers respect access policy, rate limits and robots.
14. Untrusted inputs remain isolated from executable authority.
15. Memory growth does not imply truth growth.
16. Durable learning promotion requires TEVV.
17. Weight/model changes have a higher threshold than memory updates.
18. The stream may create a receptor-gap proposal but never silently install privileged access.
19. Private connected resources retain tenant/user isolation.
20. Learning must be reversible at every promotion layer where technically possible.

## 29. Primary references

- RFC 9309 Robots Exclusion Protocol — https://www.rfc-editor.org/rfc/rfc9309
- RFC 4287 Atom Syndication Format — https://www.rfc-editor.org/rfc/rfc4287
- W3C WebSub — https://www.w3.org/TR/websub/
- RFC 9110 HTTP Semantics / validators — https://www.rfc-editor.org/rfc/rfc9110
- W3C PROV — https://www.w3.org/TR/prov-overview/
- Crossref REST API — https://www.crossref.org/documentation/retrieve-metadata/rest-api/
- NCBI developer APIs — https://www.ncbi.nlm.nih.gov/home/develop/api/
- Retrieval-Augmented Generation — https://arxiv.org/abs/2005.11401
- Biological underpinnings for lifelong learning machines — https://www.nature.com/articles/s42256-022-00452-0
- Three types of incremental learning — https://www.nature.com/articles/s42256-022-00568-3
