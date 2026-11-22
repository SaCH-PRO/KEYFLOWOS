# AI memory systems survey (KF-MEMORY-RND-001, deliverable 3)

Status: research record, 2026-11-22. Track 2 of owner ruling D-253. No authority.

What is known to work in LLM and agent memory, written from the author's knowledge (training data to mid-2026).
**No source was re-read for this document and no benchmark was run.** Each entry says what the technique does, what
is reasonably established, what needs verification against the primary source (marked **verify**), and how it bears
on KEYFLOWOS. No benchmark numbers are quoted unless the claim is qualitative; where a paper reports numbers, read
the paper.

The owner's standing rule on external systems applies to every entry: "External research is architectural reference
only. Do not onboard Graphiti, Temporal, DBOS, Restate, Cedar, OPA or other third-party orchestration/memory/policy
runtimes ... Implement the useful patterns natively inside KEYFLOWOS unless later explicitly authorized" (#106 body,
"No third-party runtime dependency"). The GenAI R&D ledger (issue #153) is summarised in `PRIOR-RESEARCH-RECOVERED.md`.

---

## 1. Context-window management and compaction

**What it is.** Keeping the live context within budget as a session grows.

- **Truncation / sliding window**: drop the oldest turns. Cheap; loses early instructions and decisions.
- **Rolling summary**: replace old turns with a running summary, updated each time the window fills. Common in
  chat products and agent harnesses (Claude Code's auto-compaction is of this kind).
- **Hierarchical summary**: summaries of summaries at several granularities (session, day, project).
- **Recursive summarisation**: summarise chunks, then summarise the summaries (e.g. Wu et al. 2021, OpenAI,
  "Recursively Summarizing Books with Human Feedback"; Wang et al. 2023, "Recursively summarizing enables long-term
  dialogue memory in large language models", arXiv 2308.15022); RAPTOR (Sarthi et al. 2024, ICLR) builds a tree of
  recursive cluster summaries and retrieves across levels.

**Established.** Compaction is necessary for long agent runs and works well enough for continuity of the current
task. **Known failure: summary drift.** Each pass loses detail and can introduce errors that later passes treat as
fact; repeated summarisation of summaries compounds them. Decisions, figures, identifiers and negative results (what
was tried and failed) are the first casualties.

**KEYFLOWOS bearing.** Track 1 avoids drift by design: the state file is "rewritten, never appended to" from
authoritative sources, and "Nothing on #80, no commit and no pkt/* branch is ever deleted or rewritten to make memory
smaller" (`docs/development/agent-memory/README.md` on `wave/v1-wave-3d`, section 5). The design keeps that rule:
regenerate summaries from source episodes, never summarise a summary repeatedly (science file D1).

## 2. Prompt caching and cost

**What it is.** Providers cache the processed prefix of a prompt; later calls that share the exact prefix are billed
at a reduced rate and served faster. Anthropic's prompt caching uses explicit cache breakpoints with a time-to-live
(minutes by default, a longer option exists) and charges a premium to write the cache and a large discount to read
it; OpenAI caches long prefixes automatically. **Verify current prices, TTLs and minimum cacheable lengths in the
provider documentation before computing costs**: they change.

**Established.** Caching only helps when the prefix is byte-identical. Consequences for memory design:
1. Put stable content first (system instructions, tool definitions, constitution, stable procedures), then slower-
   changing content (tenant profile, schemas), then per-turn content (retrieved memories, the user turn).
2. Retrieved memories vary per turn, so they belong *after* the cache breakpoint; inserting them early destroys
   cache hits.
3. Deterministic ordering and serialisation of anything in the prefix (sorted keys, stable formatting, no timestamps)
   is a cost requirement, not a style preference.

**Formula** (proposal; variables named, no values assumed). Assumptions: a miss is billed at the cache-write price only
when a cache breakpoint is set (otherwise at `r_in`); providers without a write premium have `r_write = r_in`; partial
longer-prefix hits and incremental breakpoints in multi-turn use mean part of the suffix may also be written to cache: for one turn with a cached prefix of `P` tokens and a
variable suffix of `S` tokens, input cost is
`C = h * P * r_read + (1 - h) * P * r_write + S * r_in`, where `h` is the cache hit rate, `r_read` the cached-read
price per token, `r_write` the cache-write price per token and `r_in` the ordinary input price. Memory design
controls `P` (what is stable), `S` (what is retrieved per turn) and `h` (whether the prefix stays byte-stable).

## 3. Retrieval-augmented generation (RAG)

- **Dense retrieval**: embed query and documents, nearest-neighbour search (DPR, Karpukhin et al. 2020; RAG, Lewis
  et al. 2020). Good for paraphrase; weak on exact identifiers, numbers, rare names.
- **Sparse retrieval**: BM25 (Robertson and Zaragoza 2009) and learned sparse (SPLADE, Formal et al. 2021). Strong on
  exact terms and ids.
- **Hybrid**: combine dense and sparse, commonly with reciprocal rank fusion (Cormack, Clarke and Buettcher 2009).
  Hybrid is widely reported to beat either alone on heterogeneous corpora (verify per corpus; it is not universal).
- **Reranking**: a cross-encoder scores (query, candidate) pairs on a shortlist (e.g. monoBERT, Nogueira and Cho
  2019; commercial rerankers). Practitioners often report it as a large quality gain after hybrid retrieval
  (practitioner observation; unmeasured here), at the cost of latency per candidate.
- **Late interaction**: ColBERT (Khattab and Zaharia 2020) keeps token-level embeddings and scores with MaxSim:
  better than single-vector on many tasks, larger index.
- **Structured filtering first**: filter by tenant, member scope, validity time and kind *before* vector search.
  In pgvector this interacts with approximate indexes (HNSW/IVFFlat): a post-filter can return fewer than k rows;
  pgvector 0.8.0 added iterative index scans (`hnsw.iterative_scan`, `ivfflat.iterative_scan`) to address this.
- **Query-side and iterative variants**: HyDE (Gao et al. 2022) embeds a hypothetical answer; Self-RAG (Asai et al. 2023)
  trains the model to decide when to retrieve and to critique; IRCoT (Trivedi et al. 2023) interleaves retrieval with
  chain-of-thought for multi-hop questions. Each adds model calls per query.
- **Contextual retrieval**: prefixing each chunk with document-level context before embedding (Anthropic, 2024
  engineering post "Contextual Retrieval"; verify claims there).

**KEYFLOWOS bearing.** The product already has pgvector-backed semantic memory (`modules/ai/semantic-memory.service.ts`;
see `PRIOR-RESEARCH-RECOVERED.md` part 4). The owner's rule: "Semantic/vector retrieval is an access layer, not
truth" (#106, "Architecture update") and "retrieval that filters by validity, authority and scope before relevance/
recency ranking". The design adopts hybrid retrieval with scope filters first. For figures, ids and names, sparse/
exact retrieval from source records, not embeddings.

## 4. Tiered memory with self-editing: MemGPT / Letta

**What it is.** Packer et al. (2023, "MemGPT: Towards LLMs as Operating Systems") treat the context window as main
memory and external storage as disk: a core memory block always in context (persona, user facts), editable by the
agent through tool calls; recall storage (conversation history, searchable); archival storage (vector store). The
agent pages information in and out by calling functions. Letta is the project's continuation as a framework.

**Established.** The OS-paging metaphor and agent-editable core memory blocks are widely copied. **Risks**: the model
decides what to write, so memory quality depends on the model's judgement each turn; self-editing is a direct
poisoning path (whatever reaches the context can instruct the agent to write it to core memory).

**KEYFLOWOS bearing.** Adopt the tier idea and the small always-in-context core; do **not** let the model write to
authoritative tiers directly. Model writes are proposals (owner: "ContextProposal", #106 "Architecture update";
"untrusted/external memory cannot silently gain authority", comment 5981828884).

## 5. Mem0

**What it is.** An open-source memory layer (Mem0; paper by Chhikara et al. 2025, arXiv 2504.19413) that extracts candidate
memories from conversations with an LLM, compares them with existing memories and chooses an operation (add, update,
delete, no-op); a graph variant stores entities and relations. Reports gains on the LOCOMO long-conversation
benchmark over several baselines and lower token use than full-context (verify numbers and baselines in the paper).

**Established.** The extract-then-reconcile pattern (ADD/UPDATE/DELETE/NOOP against existing memories) is a clean
write path. **Risk**: UPDATE and DELETE are destructive in the basic design; for KEYFLOWOS they become SUPERSEDE
(new version, old kept, link) and RETRACT (derived copy removed, evidence kept).

## 6. Zep / Graphiti: temporal knowledge graphs

**What it is.** Zep (Rasmussen et al. 2025, "Zep: A Temporal Knowledge Graph Architecture for Agent Memory", arXiv 2501.13956)
built on Graphiti: an episodic subgraph (raw messages), a semantic entity subgraph (entities and facts extracted
from episodes) and a community subgraph (clusters). Edges are **bi-temporal**: when a fact was valid in the world
(`valid_at`, `invalid_at`) and when the system learned or expired it. Contradicted facts are invalidated, not
deleted. Retrieval combines semantic, BM25 and graph traversal.

**Established.** Bi-temporality and invalidation-not-deletion are standard database practice (Snodgrass, temporal
databases; SQL:2011 system-versioned and application-time tables) applied to agent memory. **This is the closest
external design to the owner's Context Genome**, which already requires "temporal validity (validFrom/validTo)
distinct from knowledge time (recordedAt)" and "supersedes / supersededBy lineage rather than destructive overwrite"
(#106 "Architecture update", 2026-09-30). The owner explicitly declined Graphiti as a dependency (#106 body); the
pattern is adopted natively.

## 7. Generative agents: reflection with recency, importance and relevance

**What it is.** Park et al. (2023, "Generative Agents: Interactive Simulacra of Human Behavior", UIST) store a memory
stream of observations; retrieval scores each memory by a weighted sum of **recency** (exponential decay over time
since last access), **importance** (an LLM-assigned score at write time) and **relevance** (embedding similarity to the
query), each normalised. **Reflection**: periodically, when summed importance of recent events crosses a threshold,
the agent asks itself high-level questions and writes the answers as new memories citing the source memories.
**Planning** memories are also stored.

**Established.** Influential and simple. Ablations in the paper reported that removing reflection, planning or
observation degraded believability as judged by human raters (verify the specific findings). Weaknesses: importance
scored by the model is uncalibrated; reflections are model-generated and can be wrong yet are stored as memories.

**KEYFLOWOS bearing.** The scoring shape is adopted with changes: recency becomes ACT-R activation (science file
C1), importance becomes the salience gate with named, mostly deterministic inputs, and reflections are stored as
DERIVED/HYPOTHESIS kind with links to their sources (owner: "hypothesis != fact"). See
`key-cortex-salience.service.ts` and `unified-memory-retrieval.service.ts` in `PRIOR-RESEARCH-RECOVERED.md` part 4
for what the product already scores.

## 8. A-MEM and linked notes (Zettelkasten)

**What it is.** A-MEM (Xu et al. 2025, "A-MEM: Agentic Memory for LLM Agents", NeurIPS 2025) writes each memory as a note
with keywords, tags and a context description, links it to related existing notes, and can update existing notes'
attributes when new ones arrive ("memory evolution"). Inspired by the Zettelkasten method (Luhmann).

**Established.** Linked, atomic notes with explicit links are a good human-readable structure. **Risk**: "evolution"
rewrites older notes from newer ones, which is exactly the reconsolidation hazard (science file B3). Adopt atomic
notes and explicit links; changes to existing notes are versioned.

## 9. Episodic buffers and scratchpads

- **Scratchpads and chain-of-thought** within a turn (scratchpads: Nye et al. 2021 "Show your work"; chain-of-thought:
  Wei et al. 2022).
- **Structured state files**: a single file the agent rewrites to hold task state (progress, decisions, next
  action), outside the conversation. Widely used in coding agents (e.g. `CLAUDE.md`, `AGENTS.md`, `progress.md`,
  todo lists). Anthropic's guidance on long-running agents describes progress files and git history as the memory
  between sessions (verify the specific post).
- **Episodic buffer** in Baddeley's sense: the integrating store that binds the current context.

**KEYFLOWOS bearing.** Track 1's `ORCHESTRATOR-STATE.md` (checkpoint), generated `V1-STATUS.*` (derived) and issue #80
(episodic, append-only) are this pattern. It is the most robust technique in this survey for coding agents because
it is inspectable, versioned in git, and survives any model change.

## 9b. Cognitive-architecture framing and prior forgetting models

- **CoALA** (Sumers, Yao, Narasimhan and Griffiths 2023, "Cognitive Architectures for Language Agents", TMLR 2024): the
  standard mapping of working, episodic, semantic and procedural memory onto LLM agents, with internal and external
  actions; the bridge between the science file's A3 and this survey.
- **MemoryBank** (Zhong et al. 2023; AAAI 2024): LLM long-term memory with an Ebbinghaus-style forgetting curve that
  strengthens on recall; prior art for the design's activation ranking (and an example of recall-strengthening, which the
  design rejects for confidence).
- **Reflexion** (Shinn et al. 2023, NeurIPS): verbal lessons from failures stored and reused in later attempts; prior art
  for the LESSON kind and the cerebellum corrections.

## 10. Key-value and vector stores; knowledge graphs

- **KV**: exact lookup by key (session id, entity id). Fast, no semantic recall. (Not the model-side KV cache: its
  compression, e.g. StreamingLLM attention sinks, Xiao et al. 2023, and H2O, Zhang et al. 2023, is not under KEYFLOWOS's
  control with API models, apart from prompt caching.)
- **Vector stores**: pgvector, dedicated vector DBs (Pinecone, Weaviate, Qdrant, Milvus). For KEYFLOWOS, pgvector in
  the same Postgres keeps transactions, tenancy filters and backups together; the owner's convergence note prefers
  "Postgres/pgvector/Redis/raw source systems/background cognition" (#106 comment 5981828884).
- **Knowledge graphs**: entities and typed relations; GraphRAG (Edge et al. 2024, Microsoft) builds community
  summaries over an extracted graph for global ("what are the themes") questions; HippoRAG (Gutiérrez et al. 2024)
  uses personalised PageRank over an extracted graph, explicitly inspired by hippocampal indexing (NeurIPS 2024). Graph
  extraction by LLM is costly and error-prone; benefits are largest for multi-hop and global questions.

**KEYFLOWOS bearing.** The product already *has* a graph: its relational schema (customers, invoices, bookings,
messages) with foreign keys. Entity-graph completion over existing tables is cheaper and more correct than an
LLM-extracted graph. LLM-extracted relations are a later, benchmark-gated addition (the owner's lane M5).

## 11. Skill libraries: Voyager

**What it is.** Voyager (Wang et al. 2023, Minecraft agent) stores successful programs as named, described skills in
a library, retrieved by embedding of the description and composed into new skills; skills are added only after
self-verification of success. Related: tool-making (LATM, Cai et al. 2023), Agent Workflow Memory (Z. Z. Wang et al.
2024).

**Established.** Storing *verified code* as procedural memory works well in environments with a clear success check.
**KEYFLOWOS bearing.** The owner's promotion ladder ("Episode -> candidate pattern -> named protocol -> typed skill
spec -> executable procedure -> shadow run -> evaluator proof -> scoped autonomy grant -> versioned improvement",
#106 comment 5994706532) is a governed Voyager; the addition is "learned procedure is not permission". The repo's
`.agents/skills` pattern and Track 1's briefs are the current procedural memory.

## 12. Tool-result offloading

**What it is.** Large tool outputs (logs, file contents, search results) are written to a file or store and replaced
in context by a short reference and summary; the agent re-reads only what it needs. Context editing that clears old
tool results is offered by some providers and harnesses (verify current Anthropic "context editing" and memory tool
features in the docs).

**Practitioner observation; unmeasured here.** Widely reported as one of the largest practical savings in agent
sessions, because tool output tends to dominate context in coding work. Track 1: "Never paste logs. A suite result is one line".

## 13. Sub-agent isolation as a context firewall

**What it is.** A sub-agent does a wide read in its own context and returns only a conclusion. The orchestrator's
context grows by the size of the answer, not of the reading. Anthropic's multi-agent research system write-up (2025)
describes this pattern and its token cost (multi-agent runs used many times the tokens of single-agent chat; verify
the multiple).

**Established.** Effective for context *quality* of the orchestrator; **raises total tokens** (each sub-agent re-reads
shared material). It is a trade of total cost for orchestrator focus, not a saving. Second benefit: isolation limits
the blast radius of injected content read by the sub-agent, but only if its tools are read-only or restricted (then it
can only influence what the sub-agent returns); a sub-agent with write or execute tools can act directly.

**KEYFLOWOS bearing.** Track 1's first rule: "Delegate wide reads, take back conclusions."

## 14. Failure modes

| Failure | What happens | Known mitigations | Status of evidence |
|---|---|---|---|
| Context rot / lost in the middle | Accuracy on information in long contexts falls, and position matters: Liu et al. (2023, "Lost in the Middle", TACL 2024) found U-shaped accuracy with worse use of mid-context information in the models tested; Chroma's 2025 "Context Rot" report found degradation with input length across models (verify both for current models). | Keep context small; put the most important items at the start and end; retrieve less but better; restate the task after long inserts. | Established for the models tested; magnitude varies by model and changes with each generation. |
| Summary drift | Compounding loss and error through repeated summarisation. | Regenerate from source; keep verbatim for figures and decisions; diff new summary against sources. | Widely observed; little rigorous measurement. |
| Stale memories | A memory that was true is served after it stopped being true. | Bi-temporal validity; supersession; re-verification against source; staleness flags in context. | Established engineering practice. |
| Memory poisoning / indirect prompt injection | Untrusted content (an email, a web page, a document, a tool result) is stored and later retrieved into context where it acts as instructions, or corrupts facts. Greshake et al. (2023, "Not what you've signed up for") on indirect prompt injection; PoisonedRAG (Zou et al. 2024) and AgentPoison (Chen et al. 2024) on poisoning retrieval stores (verify). | Provenance and trust class on every item; never store untrusted text as instructions; render retrieved content as quoted data; quarantine; write gates; separation of model-proposed writes from authoritative ones; output-side checks on actions. | Established that attacks work; no complete defence is known. |
| Privacy and tenancy leaks | Memory retrieved across tenants or across roles within a tenant; embedding stores missing the tenant filter; shared caches keyed without the reader. | Filter before rank; per-reader cache keys; the same permission check on the memory path as on the source record; tests per path. | The product has had real instances: SEC-W11MC-1/2/3, W1F-MEMORY-COPIES, FU-KEY-MEMORY-MONEY-SIGHT (`V1-PLAN-RECUT.json`). |
| Embedding-model drift | Changing or upgrading the embedding model makes stored vectors incompatible ("same dimensions != same vector space", #153 Layer 4); mixed generations silently degrade search. | Record the representation (model, revision) per vector; re-embed fully on change; shadow index then cut over (#153 lifecycle). | Established engineering concern. |
| Unbounded growth | Stores grow without limit; retrieval quality falls (more distractors); cost rises. | Consolidation, dedup, retention classes, pruning of derived items, archival tiers. | Established engineering concern. |
| Self-reinforcement | Frequently retrieved items are ranked higher and retrieved more ("rich get richer"); model-written reflections cite each other. | Access counts never raise confidence; independent corroboration; diversity in retrieval. | Owner's rule: "repetition != verification"; general IR knowledge. |
| Confabulation over missing memory | The model fills gaps plausibly. | Retrieval returns explicit "nothing found" markers; prompts require "not recorded"; evaluation with unanswerable questions. | Well documented for LLMs (hallucination literature). |

## 15. Evaluations and benchmarks to know (do not quote numbers without reading them)

LongMemEval (Wu et al. 2024, verify), LOCOMO (Maharana et al. 2024), MemoryBench-style suites, needle-in-a-haystack
tests (simple, saturating), RULER (Hsieh et al. 2024), BEIR for retrieval (Thakur et al. 2021), MTEB for embeddings
(Muennighoff et al. 2023). The owner noted that lifelog research found "over-designed memory structures and lossy
compression can underperform simple retrieval baselines" (#106 comment 5982024549); the specific study was not named
there and is not identified here (verify). That warning is adopted as a design rule: every structured mechanism is
compared against plain hybrid retrieval over raw episodes.

## 16. What this survey implies for the design

1. The robust core is boring: append-only episodes, bi-temporal facts with supersession, hybrid retrieval with
   scope filters first, small always-in-context core, structured state files, sub-agent isolation, tool-result
   offloading.
2. Model-written memory is a proposal, not a fact.
3. Every advanced mechanism (graph extraction, reflection, self-editing, higher-order structure) must beat the simple
   baseline in an ablation before it is turned on (owner: "every candidate must prove marginal value by
   benchmark/ablation before production adoption", #106 comment 5981955643).
4. Cost is governed by three levers: what is stable in the prefix (cache), how much is retrieved per turn, and how
   often the expensive model is called for memory maintenance.
