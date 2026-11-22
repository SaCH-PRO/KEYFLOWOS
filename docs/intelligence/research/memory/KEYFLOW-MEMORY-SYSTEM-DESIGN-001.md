# KEYFLOW memory system design 001 (KF-MEMORY-RND-001, deliverable 4)

Status: **PROPOSED DESIGN, awaiting owner approval** (D-253: "No product code before the owner approves the design";
D-254: KEY's memory packets join v1 once it is approved). Research only; no authority.

Inputs: `PRIOR-RESEARCH-RECOVERED.md` (the owner's research; cited below as **R** with a section number),
`MEMORY-SCIENCE-PARALLELS.md` (**S**), `AI-MEMORY-SYSTEMS-SURVEY.md` (**AI**). Labels: **[OWNER]** a decision the owner
already made, quoted or cited; **[RC]** a research candidate from the owner's programme that is not an owner decision
(files marked RESEARCH_ONLY, e.g. the G157-G165 genes of the cognitive-lifecycle tranche and the epistemic-trace laws); **[SCI]**/**[AI]** support from the science or AI survey; **[PROP]** this design's own
proposal, which the owner may reject.

This design does not add a memory architecture. It is the owner's architecture (one memory architecture, Context Genome
as the epistemic substrate, many projections; R 1.9, 1.10) made concrete enough to build the first packets and to test.
Everything the owner marked provisional (RMCC algebra, hyperdimensional projections, tensor networks, receptor
expansion, structural atlas; R 1.10) stays provisional here and is listed in section 13 with its disposition.

---

## 0. The design in ten lines

1. One memory architecture, many projections: BUSINESS (KEY), PROJECT/PROGRAMME (coding agents), later AGENT/WORKFLOW
   and USER/LIFELONG. One governed substrate (R 1.9: "consumer of that same memory substrate"); this design reads it as the same laws,
   contracts and code paths where practical, with separate physical stores where the consumers differ [PROP reading of
   OWNER R 1.9 and R 2.1 l.660; owner question Q1]
2. **Canonical** = authoritative records and the append-only episodic log. **Derived** = everything else (summaries,
   embeddings, schemas, caches, bundles, prompts). Derived items are rebuildable, never authoritative, and carry the
   most restrictive access class of everything they were derived from. [OWNER; PROP for the last clause]
3. The episodic tier is an **index, not a copy**: an episode stores pointers to authoritative records plus retrieval
   keys, so the record's own permission check runs at read time. [SCI S B4; PROP]
4. Writes carry a mandatory envelope (tenant, member scope, data class including revenue class, source, authority class,
   kind, valid time, recorded time). Model-written memory is a proposal. [OWNER R 1.1; PROP for data class]
5. Retrieval filters before it ranks: scope, permission, data class, validity, supersession; then hybrid candidates;
   then ranking; then a budget. A filtered-out item cannot influence anything returned, including counts. [OWNER R 3.2,
   R 3.4; the general money rule is this design's reading of D-100, D-233 and D-234, of which D-238 is the proposal case]
6. Consolidation regenerates derived memory from source episodes on schedules and on salience, never summarises a
   summary repeatedly, records what it lost, and keeps a durable checkpoint. [OWNER R 2.1; RC G163; SCI S B2, D1]
7. Forgetting removes derived copies and access paths under governance; it never deletes authoritative evidence. Erasure
   on legal or user request is a separate, recorded deletion. [OWNER R 1.2; RC G161]
8. Procedures are earned by repeated verified success, carry a revaluation check, and never grant permission. [OWNER R 1.11; SCI S D2]
9. Metamemory is structural: coverage and freshness indexes, honest failure states, and "not recorded" when nothing is
   recorded. [OWNER R 3.8; SCI S D4]
10. Every mechanism beyond the baseline earns its place by ablation against plain hybrid retrieval over raw episodes.
    [OWNER R 1.5, R 1.10]

---

## 1. Principles carried over (the owner's invariants this design must satisfy)

From `PRIOR-RESEARCH-RECOVERED.md`, not restated in full: the non-negotiable integrity rules (R 1.2), the fourteen stable
foundations (R 1.10), the design laws of Canon Event Dissection 001 (R 1.12), the plan's ten hard invariants (R 2.2), the
Genome doc's security laws (R 2.1), #123/#124/#125/#126 hard invariants (R 3.2-3.4), #153's canonical laws (R 3.8), and
the revenue-scope rulings D-100, D-128, D-226, D-227, D-233, D-234, D-238 (R 2.11). Section 14 checks each against this
design.

---

## 2. Tiers and what each stores

| Tier | Name | Stores | Authoritative? | Lifetime | Analogue |
|---|---|---|---|---|---|
| T0 | Intake buffer | Raw payloads in flight (webhook bodies, tool output, uploaded file before parsing) | No (the source system holds the record) | Seconds to the end of the request | Sensory memory [S A1] |
| T1 | Working set | The model's context for one turn or task, assembled by the context compiler | No | One turn or task | Working memory [S A2] |
| T2 | Episodic log | Append-only events: who, what, when, tenant, member, source, pointers to authoritative records, retrieval keys | **Yes** (as a record of what happened) | Retention class of its tenant and data class | Hippocampal index [S B4] |
| T3 | Semantic store | Facts, decisions, preferences, constraints, policies, hypotheses and lessons as versioned claims with valid and recorded time, authority class, verification status and supersession links; intentions (prospective memory) | Facts and decisions **yes at their authority boundary**; hypotheses and lessons no | Until superseded or retracted; history kept | Semantic memory, cortex [S A3, B2] |
| T4 | Procedural store | Versioned procedures (runbooks, skills, briefs) with initiation, policy, termination, evaluator, run evidence | Know-how only; never permission | Until retired; versions kept | Basal ganglia, cerebellum [S D2] |
| T5 | Metamemory | Per scope and topic: coverage, last verified, open contradictions, stale counts, health state | Derived | Recomputed | Metamemory [S D4] |
| D | Derived indexes | Embeddings, summaries, schemas, bundles, caches, prompt prefixes, salience feeds | **Never** | Rebuildable; expire with their source | Myelinated paths, gist [S E3, C3] |

Rules:
- **T2 points, it does not copy** [PROP]. An episode for "invoice 123 paid" stores the event, the invoice id and keys
  (customer id, amount band if allowed by data class), not the invoice. Reading the episode's detail goes through the
  invoice's own read path and permission. This is the cheapest way to make memory honour every existing permission rule.
- **T3 claims follow the owner's contracts**: kinds FACT, PREFERENCE, OBSERVATION, EPISODE, DECISION, POLICY, PROCEDURE,
  HYPOTHESIS, DERIVED_STATE, LESSON, CONSTRAINT (R 1.1); authority classes from PR #112 (USER_DECLARED, USER_VERIFIED,
  DOCUMENT_VERIFIED, SYSTEM_OBSERVED, AGENT_INFERRED, DERIVED, EXTERNAL_UNVERIFIED; R 3.6); verification VERIFIED,
  INFERRED, UNVERIFIED, STALE, DISPUTED; epistemic state OBSERVED, SUPPORTED, ACCEPTED, DISPUTED, SUPERSEDED, RETRACTED,
  UNKNOWN (R 2.1 §7). `validFrom/validTo` (world time) are never set from verification or recording time (the PRS-M37
  defect, R 3.6).
- **Intentions** [PROP; SCI S D3]: a T3 record of kind CONSTRAINT or a new kind INTENTION (owner question Q3) with a
  trigger (time or event pattern), an owner, an expiry and a status. Prospective memory is checked by the system, never
  left to the model's recall.
- **The domain database is not a tier.** Invoices, bookings, contacts and accepted Genome facts are domain authority; T3
  links to them and must not copy them into "a competing truth table" (R 2.1 l.317).

### 2.1 Status vocabularies mapped (closes R 6 C12) [PROP]

| Concept | Genome §7 state | GenomeFact | Bundle freshness | G165 health |
|---|---|---|---|---|
| Current and supported | ACCEPTED / SUPPORTED | USER_VERIFIED | CURRENT | READY |
| Recorded, not verified | OBSERVED | INFERRED, UNVERIFIED_IMPORTED | CURRENT | UNVERIFIED |
| Conflicting | DISPUTED | DISPUTED | CURRENT (conflict listed) | DEGRADED |
| Old version | SUPERSEDED | (history) | SUPERSEDED | n/a |
| Withdrawn | RETRACTED | n/a | (excluded) | n/a |
| Past re-verification date | (unchanged) | STALE | STALE | STALE |
| Unknown | UNKNOWN | n/a | UNVERIFIABLE | UNAVAILABLE |

Each existing vocabulary stays where it is; the mapping should live in one table in code so retrieval can compare them
(not yet assigned to a proposed packet; it belongs with the Context Genome contract work, plan phase 1).

---

## 3. Write path (encoding)

### 3.1 The envelope (required on every write to T2, T3, T4 and every derived item) [OWNER R 1.1; PROP for data class]

`tenantId` (or `PLATFORM` for tenant-free procedural knowledge); `memberScope` (a member id, or `BUSINESS`);
`dataClass` (see 8.2: at least `GENERAL`, `REVENUE`, `PERSONAL`, `SECRET_BEARING`, `UNCLASSIFIED`); `moduleScope` (the
modules whose read permission is needed); `kind`; `authorityClass`; `source` (type, id, revision, content hash, actor,
correlation id); `validFrom`, `validTo`; `recordedAt`; `derivedFrom` (ids, for derived items); `retentionClass`.

A write without a complete envelope fails. `UNCLASSIFIED` is allowed on write and **fails closed on read** for any reader
without every permission (D-227, D-234).

### 3.2 Salience and prediction-error gate [SCI S C5; OWNER R 1.7 lane M6; RC G157; PROP formula]

Salience decides consolidation priority and review priority, **never confidence**. For an episode `e`:

`salience(e) = clamp01( w_c * consequence(e) + w_p * predErr(e) + w_n * novelty(e) + w_u * userMarked(e) + w_t * tagCapture(e) )`

- `consequence` in [0,1]: deterministic by event type and data class (money moved, customer affected, deadline,
  authority change). Configured per event type, reviewable.
- `predErr` in [0,1]: the normalised difference between what the system predicted (a recorded prediction, a scheduled
  expectation, a baseline rate) and what happened. Zero when no prediction was recorded. The existing salience service's
  `ratio = recent / baseline` is a signal of this kind but is unbounded and asymmetric (drops fall in (0,1), rises above
  1); it is mapped symmetrically, for example `predErr = min(1, |ln(ratio)| / L)` with a fitted scale `L` (R 4.2).
- `novelty` in [0,1]: no similar episode for this entity in the window (the existing service uses 0.35 when the
  baseline is zero).
- `userMarked` in {0,1}: the user asked to remember, or corrected KEY.
- `tagCapture` in [0,1]: a high-salience episode for the same entity within the window `Δt_tag` raises related
  low-salience episodes (behavioural tagging: Moncada and Viola 2007; Ballarini et al. 2009; in humans, retroactive
  strengthening of related items, Dunsmoor et al. 2015; synaptic basis, Frey and Morris 1997; S C5).
- Weights `w_*` are **not given values here**: they start from the existing service's constants where those exist and are
  fitted in the evaluation's ablation (E-ABL-2). No percentages are invented.

The gate does not decide whether an episode is **stored** (authoritative events are always logged); it decides what is
consolidated first and what the compiler may surface proactively (G159 interruption threshold).

### 3.3 Model-written memory is a proposal [OWNER R 1.1 ContextProposal, R 2.1 l.437; AI §4-5]

A model (KEY, a coding agent) can propose: a preference, a lesson, a fact extracted from conversation, a reflection. The
proposal is stored as kind HYPOTHESIS or OBSERVATION with authority class AGENT_INFERRED, and becomes a FACT only through
an explicit promotion path: user confirmation, document verification, or a domain rule (the
`ConversationGenomeExtractorService` pattern "infer -> propose -> verify/merge, not infer -> truth", R 2.1). Operations
follow Mem0's ADD / UPDATE / DELETE / NOOP with two changes: UPDATE is SUPERSEDE (new version, old kept, linked) and
DELETE is RETRACT (state change, evidence kept) [AI §5].

### 3.4 Deduplication and pattern separation [SCI S C4; OWNER R 2.1 §9, §11]

- Three identities: delivery id, source object (content hash), semantic identity (R 2.1 §9). Retried deliveries are
  idempotent; identical bytes are one source.
- Dedup of memories happens only **within** (tenant, memberScope, entity, kind), only on exact or normalised-exact
  match, and writes a merge record. Embedding similarity never merges (R 2.1 l.547 "Never auto-merge ambiguous entities
  merely because vector similarity is high").
- A false merge across members or tenants is treated as a leak, not a quality defect (evaluation E-SEP).

### 3.5 Untrusted content [OWNER R 1.2 family 6, R 3.3 #125; AI §14]

Content from outside the tenant's members (emails, web pages, uploaded documents, tool results from third parties) is
written with authority class EXTERNAL_UNVERIFIED and a `quarantined` flag when the innate screen (8.3) fires. Untrusted
text is stored and later rendered **as quoted data with its source**, never as instructions. It cannot become a FACT,
POLICY or PROCEDURE without promotion by a member with the relevant authority.

---

## 4. Canonical versus derived, and forgetting

[OWNER R 1.2 "forgetting should not erase authoritative evidence/audit history"; R 2.1 l.109; RC G161, G162, G163]

- **Canonical** (T2 episodes, T3 claims with their history, T4 procedure versions with run evidence, and the domain
  records they point to) is append-only or versioned. Never rewritten to save space.
- **Derived** (D, T5, T1) is rebuildable. Deleting every derived item must not destroy any canonical memory (R 2.1
  l.109); the evaluation tests this directly (E-REBUILD).
- **Forgetting** = one of: (a) lower retrieval priority (activation decay, section 6.2); (b) remove an access path (drop an
  index entry, an association, a cached bundle); (c) delete a derived copy (an embedding, a summary) whose source changed,
  was retracted or expired; (d) archive canonical items to a colder tier, still retrievable on drill-down. Each is logged.
- **Erasure** (privacy request, legal retention end) is not forgetting: it is a governed deletion of canonical content
  with a tombstone that records that something was erased, when and under what authority, without its content. Derived
  copies are erased in the same transaction (the W1F-MEMORY-COPIES pattern, R 4.4).
- **Different classes, different plasticity** [OWNER R 1.10 item 11]: episodes never change; facts change only by
  supersession; preferences change freely but keep history; lessons decay in priority unless re-confirmed; procedures
  change only by new version after evaluation; derived items are regenerated at will.

---

## 5. Consolidation

[OWNER R 1.7 lane M6, R 2.1 §13, R 2.2 phase 8; SCI S B2, B5, B6, C1, D1, E4, E5]

### 5.1 Triggers
1. **Scheduled window** per tenant in local resting hours (the existing circadian gate, R 4.2), with a **durable
   checkpoint** row per (tenant, job, window) instead of the in-process map (R 2.1 §3.9; plan phase 8 exit proof
   "restart/multi-replica execution does not duplicate effects").
2. **Salience threshold**: when summed salience of unconsolidated episodes for a scope exceeds `θ_s` (the generative-agents
   reflection trigger, AI §7), consolidate that scope early.
3. **Event**: supersession or retraction of a claim triggers regeneration of everything derived from it (via `derivedFrom`).
4. **Pre-compaction** (agents): before a session compacts or hands over, write the state file (Track 1 already does).

### 5.2 Replay order
Episodes are replayed in priority `salience × (1 + outcomeKnown)`, where `outcomeKnown` is 1 when the episode has a
recorded outcome to learn from (prioritised replay, S B5). Each run has a token and time budget `B_cons(tenant)`;
unprocessed episodes stay queued (no silent drop). Backlog size is a health metric (section 9).

### 5.3 Re-summarisation without drift
- A summary is regenerated from its **source episodes**, not from the previous summary, at least every `k_regen` updates
  [PROP; SCI S D1; AI §1]. Between regenerations an incremental update may append to the summary.
- Every summary records **source coverage** (episode ids and count) and **known loss** (what was omitted: figures, names,
  dates, exceptions) [RC G163].
- Figures, commitments, names, dates and identifiers are not answered from a summary: the compiler fetches them from
  source (verbatim/gist split, S C3).
- A new summary is diffed against the previous; a fact present before and absent now is flagged for review rather than
  dropped silently.

### 5.4 Schema extraction, promotion and demotion
- Recurring patterns across episodes become candidate **schemas** or **lessons** (kind LESSON, authority DERIVED) with
  links to supporting and counter episodes (R 1.2 "every abstraction must remain traceable to supporting/counterevidence").
- **Promotion** to semantic memory requires independent corroboration: `n_indep >= n_min` episodes from distinct sources
  (not copies of one claim; R 1.2, R 1.8 track 11). Repetition by the same source does not count.
- **Demotion**: a lesson whose counterevidence count exceeds its support, or that has not been confirmed in `T_confirm`,
  falls in priority; a contradicted fact becomes DISPUTED with both versions visible.
- **Read-triggered re-verification, never read-triggered rewrite** [SCI S B3]: when a retrieved T3 item is past its
  re-verification date, the compiler marks it STALE in the context and queues a re-verification job; it never edits it in
  the read path.
- **Member scope is preserved**: a member's lesson is never promoted business-wide (D-130, W11-MEMORY-PROMOTE-SCOPE).

### 5.5 Decay and renormalisation
- **Activation** (a derived ranking signal) decays with time since each access and grows with frequency of use, using
  ACT-R base-level activation `A(i) = β_kind + ln( Σ_j max(t_now - t_j, Δt_min)^(-d) )` over presentations `t_j`, where
  `t_0` is the item's creation (so an item never read still has one presentation), `Δt_min` is a small minimum lag (no
  division by zero), the time unit is fixed (changing it shifts every `A` by `-d * ln(c)`, which keeps the order but moves
  items along the squashing function, so its offset is fitted with the unit fixed), and `β_kind` is a per-kind base level
  (ACT-R's `β_i`) that keeps authoritative kinds (DECISION, POLICY, CONSTRAINT, accepted FACT) from being buried merely
  because they are rarely read (S C1; ACT-R models commonly use d = 0.5; all constants fitted here, E-ABL-1).
- **Confidence, authority and verification never decay with time** [PROP; in the spirit of RC G162 "Old information should not disappear
  merely because it is old"]. Staleness is a separate field set by the re-verification schedule and by domain volatility.
- Periodic **renormalisation** rescales association weights (which use reinforces) per scope so they do not saturate
  (synaptic homeostasis analogue, S B6). Activation needs none: it is log-scale and already decays.
- **Pruning** removes associations and derived items never used in `T_prune` and never cited by a successful outcome,
  bounded per run, with a log of what was pruned (S E4).

### 5.6 Copy hygiene
A sweep removes orphaned derived copies (embeddings whose source row is gone or changed, expired cache entries, duplicate
`temporal_memory` embeddings per source id) — **dry-run by default, apply only on authority** (D-254) (S E5; R 4.2).

---

## 6. Retrieval and the context compiler

One name: **ContextPack** for what the compiler returns to KEY and to agents; Track 1's bundle and the research
`ContextBundle` are ContextPacks for the PROJECT scope [PROP; closes R 6 C11; owner question Q2].

### 6.1 Pipeline [OWNER R 3.4 #126 order; R 3.8 Layer 1 and 4; PROP for the budget step]

```
task + reader
 -> 1 resolve reader: tenant, member, roles, module levels, revenue read, memberless or not
 -> 2 HARD FILTER (before any ranking or counting):
        tenant -> memberScope -> dataClass/moduleScope vs reader -> validity (validFrom/To)
        -> supersession -> retracted/quarantined -> retention
 -> 3 candidates: EXACT ids/entities | LEXICAL (full text) | DENSE (pgvector) | ENTITY-GRAPH (domain foreign keys)
        | TEMPORAL window ; each channel reports its own failure state
 -> 4 fuse (reciprocal rank fusion) and optionally rerank
 -> 5 rank (6.2) ; mark STALE/DISPUTED items ; attach contradictions for high-risk tasks
 -> 6 budget (6.3) ; verbatim fetch for figures/ids/dates
 -> 7 order for caching (6.4) ; render untrusted items as quoted data
 -> 8 emit ContextPack + retrieval trace (6.5)
```

Step 2 is the invariant: **an item that fails the filter contributes nothing downstream**: not to text, counts, ranks,
"N more items", summaries, salience feeds or cache keys shared with other readers [OWNER #126 "inaccessible nodes cannot
influence accessible aggregates"; #123 "inaccessible source memory cannot leak through a derived aggregate"; D-238
"directly or indirectly"].

### 6.2 Ranking (after filtering) [PROP; AI §7; SCI S C1]

`rank(i | q) = α * rel(i, q) + β * σ(A(i)) + γ * taskMatch(i, task) + δ * sourcePrior(i)`

- `rel`: fused relevance from step 4, normalised to [0,1].
- `σ(A(i))`: activation (5.5) squashed to [0,1]. Replaces the current `exp(-age/30d)` recency so that frequently used old
  facts, and through `β_kind` rarely read authoritative ones, are not buried by age alone (R 4.2; #122's "hard recency cutoff hiding old authoritative facts", R 3.1).
- `taskMatch`: whether the item's kind and module fit the task type (a quote task wants pricing preferences, not
  booking history).
- `sourcePrior`: the existing per-source weights (R 4.2) as a starting prior.
- **Authority and verification are not added to the rank**: they decide filtering (step 2), labelling (STALE, DISPUTED,
  INFERRED) and tie-breaks. Adding authority to a relevance sum would let a high-authority irrelevant item outrank a
  relevant one and is the "confidence != authority" confusion in another form. [PROP] **This departs from the Genome
  doc §12**, which lists "authority; claim status; evidence coverage" among the signals the target Context Compiler should
  add to ranking (`PRIOR-RESEARCH-RECOVERED.md` C-H); owner question Q14. The ablation E-ABL-1 can test both.
- Weights `α, β, γ, δ` are fitted by E-ABL-1, starting from the current 0.45/0.35/0.20 as the baseline to beat.

### 6.3 Budget per task [RC G157, G158; Hermans "MORE CONTEXT != MORE UNDERSTANDING"; AI §14 context rot]

For task type `τ` the compiler has a token budget `B_τ` split into slots: `B_τ = b_core + b_task + b_mem + b_evid +
b_reserve`. `b_core` is the stable prefix (6.4); `b_task` the user turn and task state; `b_mem` retrieved memory;
`b_evid` verbatim evidence for figures and ids; `b_reserve` for the answer. Items are added in rank order until `b_mem`
is spent; an item that does not fit is replaced by a **pointer line** (id, kind, one-line gist) the model can request.
Budgets are configured per task type and measured (evaluation section 5), not fixed here. High-risk tasks (money,
authority, external effects) must include their required evidence even if the memory slot shrinks (R 2.1 §12).

### 6.4 Cache-friendly ordering [AI §2]

Order: (1) system and tool definitions; (2) constitution and stable policy for the tenant; (3) stable procedures for the
task type; (4) tenant profile and slow-changing schemas; **cache breakpoint**; (5) retrieved memory and evidence; (6) task
state and user turn. Serialisation of (1)-(4) is deterministic (sorted keys, no timestamps). Per-reader content never
goes before the breakpoint unless the cache is keyed by reader (a shared prefix must never contain anything a filter
would remove for some reader).

### 6.5 Honest failure and the retrieval trace [OWNER R 3.8 failure vocabulary, EMB-GAP-04; R 2.2 phase 7]

Each channel reports MATCHES, NO_MATCH, SOURCE_NOT_ELIGIBLE, INDEX_UNAVAILABLE, EMBEDDING_PROVIDER_FAILED, INDEX_STALE,
POLICY_BLOCKED and the others in R 3.8. The ContextPack carries a short status line the model sees ("memory: 6 items;
semantic search unavailable, keyword only"). When nothing is recorded the pack says so explicitly, so "not recorded" is
the easy answer (evaluation E-CONF). The trace (what was considered, filtered, selected and why; without filtered
content) is stored for audit and debugging (#106 track 12: "auditable, debuggable and ablatable"). POLICY_BLOCKED is
never shown to the model as a count of withheld items (that would be an indirect channel).

---

## 7. Procedural memory

[OWNER R 1.11 ladder and core rule; R 1.12 laws 1-14; R 2.1 §14; SCI S D2; AI §11]

- **Earned**: Episode -> candidate pattern -> named protocol -> typed spec -> executable procedure -> shadow run ->
  evaluator proof -> scoped autonomy grant -> versioned improvement (the owner's ladder, unchanged). Promotion to
  "executable" needs `n_succ` verified successes in distinct contexts and zero unresolved failures of the same signature.
- **Contract**: initiation (preconditions), policy (steps; deterministic vs model-reasoning marked), termination
  (outcome vocabulary), evaluator, escalation, required context and its freshness (R 1.11).
- **Revaluation** [SCI S D2, habit insensitivity to outcome devaluation]: before each run, the procedure re-checks its
  preconditions and that the goal it serves still holds (the ruling it restates is still current). A procedure that
  restates a ruling changes in the same commit as the ruling (Track 1 already: "A procedure changes only with the ruling
  that changes its rule").
- **Correction**: failures by signature feed corrections (the cerebellum service's mechanism, R 4.2) with a TTL; a
  correction that keeps recurring becomes a procedure change proposal, not a permanent prompt line.
- **Retired** when: superseded by a new version that beat it; its evaluator fails `n_fail` times; its governing ruling is
  superseded; or it is unused for `T_retire` (archived, still readable).
- **Never permission**: procedure knowledge, policy decision and enforcement stay separate (R 1.12, NIST zero trust).

---

## 8. Safety

### 8.1 Tenancy [OWNER R 2.1 security law 1; R 3.2-3.4]
Every read and write has a tenant predicate in the query itself (not a post-filter), including updates and deletes by
id (the `updateMemory` gap, R 4.3). Caches and prompt prefixes shared across readers contain only content every possible
reader of that key may see. Cross-tenant tests run per path.

### 8.2 Role and revenue scope (D-100, D-128, D-226, D-227, D-233, D-234, D-238) [OWNER; PROP for the mechanism]

The rulings say: a member without revenue read sees "no money signals at all" (D-100); finance and sales-derived data,
including "transaction-derived signals", needs `revenue:read`, "Authorization follows the data's provenance and meaning,
not only a section name, domain label or currency symbol" and ambiguity fails closed (D-234). Two rulings are specific
cases: D-233 (the finance DNA score must not be inferable "from a score, grade, ranking, categorical indicator or
summary") and D-238 (proposal-family events must not reveal restricted information "directly or indirectly", "alike to
event memory, prompts, API responses, streams and caches"). **Applying the indirect-disclosure rule to all memory is this
design's reading** of D-100 and D-234 informed by those two cases [PROP], not a ruling; owner question Q5 asks for
confirmation. The current code classifies at read time by words in the
text (R 4.3; FU-PROPOSAL-MONEY-TAG documents the limits of a vocabulary heuristic). The design:

1. **Classify at write, by provenance** [PROP]: the writer sets `dataClass` and `moduleScope` from what it knows
   structurally (the tool's authority, the source table, the event type), as FU-PROPOSAL-MONEY-TAG proposes for
   proposals (that packet is not yet built).
   Text heuristics remain only as a fail-closed backstop.
2. **Taint propagation** [PROP]: a derived item (summary, embedding, lesson, salience concern, count, ranking, schema)
   carries the **union** of the `moduleScope` and the most restrictive `dataClass` of everything in `derivedFrom`. A
   summary of a thread that mentions one invoice is REVENUE. This is what makes "indirectly" enforceable: a count of
   overdue invoices is derived from REVENUE rows and is REVENUE.
3. **Ambiguous financial provenance fails closed** (D-234; D-227 for unclassified KEY event types): legacy rows without a
   class are classified at read from their structure (category, source, source type, source events) until a
   classification backfill (dry-run first, on owner authority) records the class; only rows whose financial provenance is
   still ambiguous are withheld from readers without revenue read. Ordinary legacy memory (tone, goals, priorities) stays
   visible.
4. **Memberless turns** (contact-only bridge, non-member admin) see proposals as action, status and risk only (D-226),
   and not even that where status or risk would reveal financial information (D-238).
5. **Index entries point, records decide**: a T2 episode that points to an invoice resolves the invoice through the
   invoice read path, so revenue rules already enforced there apply.

Counts without amounts (for example "3 overdue invoices") are transaction-derived signals under D-234 and so need revenue
read; owner question Q5 asks the owner to confirm this reading.

### 8.3 Poisoning and prompt injection [OWNER R 1.2 family 6-7, R 1.7 lane M8, R 3.8 Rebuff; SCI S F; AI §14]
- **Innate screens** (deterministic, on every write of external content): instruction-like patterns, tool-call syntax,
  secrets, other tenants' ids, role-escalation phrases. A hit sets `quarantined` (stored, not retrievable into prompts
  until reviewed).
- **Adaptive signatures** from confirmed incidents only, tested against a corpus of known-good memories before
  enabling (tolerance; avoids "autoimmune-style blocking"); "Unvalidated attacker input cannot self-register as a globally
  trusted attack signature" (R 3.8). Threat memory is kept apart from business memory (R 3.8).
- **Structural defences**: untrusted items render as quoted data with source; untrusted content cannot become POLICY or
  PROCEDURE; model-proposed writes cannot raise authority; actions still pass the separate authority and approval path,
  so a poisoned memory can at worst mislead a proposal, not execute.
- **Sub-agent isolation** for reading untrusted bulk content (AI §13).

### 8.4 Audit
Every write, promotion, supersession, retraction, erasure, quarantine, pruning run and consolidation run is an event in
T2 with actor and reason. The retrieval trace (6.5) records what reached a prompt. "No fake green": health and coverage
claims have bounded denominators (R 2.1 §17).

### 8.5 Metamemory [OWNER R 1.2 "meta-memory"; RC G164, G165; SCI S D4]
T5 maintains, per (tenant, scope, topic or entity): number of current claims, last verification, open contradictions,
stale count, last consolidation, backlog, and channel health. The compiler uses it to say "no record of X", "the last
record of X is from date D and is unverified", or "memory partly unavailable". Model self-reported confidence is never
used as metamemory.

---

## 9. Memory health (homeostasis) [SCI S E2; OWNER R 1.2 "resilience debt"]

Per tenant, with configured set points: store growth per day; derived-to-canonical ratio; consolidation backlog;
proportion STALE; open contradictions; quarantine queue; retrieval p95 latency; ContextPack tokens per turn by task type;
cache hit rate; channel failure rate. Out-of-range values raise an operational alert and, where safe, adjust the
consolidation budget (allostasis: raise it before known peaks). These are product metrics for the owner's dashboard
later, not a new dashboard now (R 2.2 phase 10 "no second dashboard").

---

## 10. Token economics (mechanisms and formulas; no invented percentages)

Notation per model call: `P` stable prefix tokens, `M` retrieved memory tokens, `U` task and user tokens, `O` output
tokens; prices per token `r_in`, `r_out`, `r_cw` (cache write), `r_cr` (cache read); cache hit rate `h`.

1. **Per-call input cost**: `C_in = h * P * r_cr + (1 - h) * P * r_cw + (M + U) * r_in`. Memory design controls `P`
   (what is stable and cacheable), `M` (budget 6.3) and `h` (deterministic prefix, 6.4). Values of `r_*` come from the
   provider's current price list at the time of measurement.
2. **Pointer versus inline** (agents): a pointer of `p` tokens standing for a document of `D` tokens read by a sub-agent
   saves `D - p` in the orchestrator's context for every later call in the session; over `n` later calls the
   orchestrator's input saving is `n * (D - p)` tokens (before caching), while total tokens rise by the sub-agent's read
   `D` plus its overhead. Track 1 measured the orchestrator's side for the worker brief: 2,739 characters inline vs 284 as a pointer
   (MEASUREMENT.md); the child still reads the 4,632-character brief file, so the saving is in the orchestrator's context
   only; tokens were not measured.
3. **Compile versus load**: a bundle of `b` tokens replacing a search through sources of `S` tokens saves `S_read - b`,
   where `S_read` is what an agent actually reads without the bundle (unknown today; Track 1 MEASUREMENT.md section 4
   records how to measure it). Never claim `S - b`.
4. **Consolidation break-even**: consolidating a scope costs `C_cons = E * c_e` (episodes replayed times cost per
   episode). It pays when the expected number of future reads `k` that use the consolidated item satisfies
   `k * (M_raw - M_cons) * r_in > C_cons`, where `M_raw` is the tokens needed to answer from raw episodes and `M_cons` from
   the consolidated item. Low-read scopes should not be consolidated eagerly: this is the formula behind lazy, salience-
   triggered consolidation.
5. **Retrieval quality versus volume**: adding memory tokens has diminishing and eventually negative returns (context
   rot, AI §14). The budget `b_mem` per task type is set where the measured answer accuracy stops improving (E-ABL-3),
   not at the context limit.
6. **Model-routing for memory maintenance** (G158): summarisation and classification jobs use the cheapest model that
   passes the fidelity checks (E-SEM); the choice is measured.

---

## 11. Instantiation A: the AI coding agents (PROJECT/PROGRAMME projection)

Track 1 (`docs/development/agent-memory/`, `scripts/agent-memory/` on `wave/v1-wave-3d`, PR #221) is the built
projection. This design **agrees** with it on almost everything and does not duplicate it:

| Design element | Track 1 as built | Agreement / difference |
|---|---|---|
| T1 working set | "The live conversation context ... Temporary"; rules: delegate wide reads, never paste logs, point do not retype, compile do not load | Agrees |
| T2 episodic | Issue #80, git history, PRs; append-only; "Never loaded whole" | Agrees. Difference: #80 comments have no machine-readable envelope (kind, packet, ruling id); search is by text. Proposal A1 below |
| T3 semantic | Plan and rulings (canonical), `ORCHESTRATOR-STATE.md` (checkpoint), `V1-STATUS.*` (derived, generated) with an order of authority | Agrees, including "A contradiction is reported ..., not silently resolved" |
| T4 procedural | Briefs and runbooks that "restate rulings; the rulings win"; change in the same commit as the ruling | Agrees; this is the revaluation rule (section 7) |
| Consolidation | Rewrite table per event; state file "rewritten, never appended to"; nothing on #80 or git is deleted | Agrees; it is section 5.3 (regenerate from source) |
| Retrieval / ContextPack | `bundle.mjs` per packet (with `health` and `excluded`); `status.mjs --check` for staleness | Agrees. Difference: no explicit budget or "not recorded" marker |
| Metamemory | `status.mjs --check` (STALE vs current), uncertain-derivation list | Agrees, partial |
| Measurement | Characters, not tokens; one resume test | Agrees on honesty; evaluation plan section 2 extends it |

Proposals for the agents (Track 1 owns them; none is a product packet) [PROP]:
- **A1** A one-line machine-readable header on every #80 RETURN/PROGRESS/ruling comment (`kind=RETURN packet=<id> sha=<sha> rulings=D-nnn`) so a script can index #80 without reading it.
- **A2** Print an explicit "not in plan/rulings" marker in `bundle.mjs` output when a packet cites nothing (the bundle
  already carries `health` and `excluded`, `scripts/agent-memory/lib.mjs`).
- **A3** Run the amnesia and confabulation tests (EVALUATION-PLAN E-AMN, E-CONF) at each wave boundary.
- **A4** Owner ruling on the `CLAUDE.md` read list (Track 1 cannot edit `CLAUDE.md`): replacing the six-file list by the
  three-file resume path would cut the first read from 104,312 to 27,375 characters (Track 1 MEASUREMENT.md section 2).

On the identity invariant (R 1.9: "Do NOT create a separate autonomous-development memory architecture"; development is
"a real production-scale consumer of KEY memory"; "KEY-specific cognition must consume the same governed substrate"; and
R 1.11: "It does not create a separate developer-only memory or automation stack"): Track 1 is files in git, KEY's memory
is Postgres. The owner's wording ("same memory substrate") can be read as one physical substrate. This design proposes
[PROP] reading it as **one set of laws and contracts with separate physical stores**, which the Genome doc also requires ("Do not couple business runtime memory physically to
development-control storage, but reuse the semantic laws", R 2.1). The shared contracts are: the envelope (3.1), the
canonical/derived split, the authority order, the ContextPack shape and health, the status mapping (2.1) and the test
suite (EVALUATION-PLAN). Owner question Q1 asks the owner to choose; the owner's rollout sequencing (R 1.7: "Use PROJECT/PROGRAMME development
memory as the first serious consumer/proving ground"; "Only after benchmarked value, progressively activate the same
substrate for KEY/business cognition") would, under the one-substrate reading, put the agents on the product substrate
first, which D-254 (KEY's memory built inside v1) does not follow (R 6 C-I).

---

## 12. Instantiation B: KEY (the BUSINESS projection)

Mapped onto what exists (R 4). The reference plan is the owner's deferred Memory/Context Genome plan (R 2.2); the
mapping to its phases and to the #106 lanes (two numberings, R 6 C-D) is in the last column.

| Design element | Exists today | Missing | Should change | Plan phase / #106 lane |
|---|---|---|---|---|
| Inventory and causal map | Characterisation in R 4 (this work) | Machine-readable store/writer/reader map with proof (the #122 deliverable; #127 closed) | MEM-CENSUS produces it as a test | Phase 0 / M0 |
| Envelope, kinds, authority, bitemporal time | Partial: AiMemory has confidence, source, expiresAt; Genome has verification; PR #112 vocabulary not on main | dataClass, moduleScope, memberScope on AiMemory and embeddings; valid/recorded time; supersession | Additive columns; adapter types from #112's vocabulary (without the validFrom defect) | Phase 1 / M1 |
| T2 episodic index | BusinessEvent, CognitiveEvent, GenomeMemoryEvent, execution and action logs; read as "episodic" by unified retrieval | Pointer-and-keys contract; per-event dataClass | Classify event types at write (D-227 already fails unclassified closed in prompts) | Phase 3-4 / M2 |
| T3 semantic | AiMemory (key-value, overwrite on upsert), GenomeFact (verification, evidence), CognitionMemory (member lessons) | History on overwrite; userId on member-scoped rows (writer drops it); supersession | AiMemory upsert keeps the previous version (or writes a history row); member preferences stored per member | Phase 1, 4 / M1-M2 |
| Embeddings (derived) | pgvector, `text-embedding-3-small`, copies die with source (W1F/FU packets) | ANN index; representation spec (model, revision); taint class; `temporal_memory` copies dedup per source | Add class columns and dedup; HNSW index after benchmark; representation fields | Phase 7 / M5 (Layer 5 R 3.8) |
| Retrieval facade | `UnifiedMemoryRetrievalService` (LIVE, the one facade) | Filter-first with class; expiresAt filter; channel failure states; trace | Evolve it (the owner: "evolves into the common retrieval boundary rather than being replaced", R 1.1) | Phase 7 / M4 |
| Prompt projection | `readersOwnPromptMemory` gates cognition, events, genome money | AiMemory, embeddings, temporal memory, logs, salience feed, semantic section ungated (R 4.3) | Every memory path goes through one projection keyed by dataClass | Phase 7 / M1 (scope) |
| Consolidation | Circadian-gated, decay of old cognition confidence by 0.1 per night, member-safe promotion | Durable checkpoint; regenerate-from-source; loss accounting; salience-triggered runs | Replace time decay of **confidence** with activation decay (5.5) — confidence must not fall with age (G162) | Phase 8 / M6 |
| Procedural | Cerebellum corrections (7-day TTL), approval learning, `.agents/skills` | Procedure contract, revaluation, promotion ladder in product | Later packet after MEM-EVAL-SUITE | Phase 8 / M7 |
| Salience | Amygdala service, ratio vs baseline, novelty | Prediction errors from recorded predictions; class-aware feed | Feed counts derived from REVENUE events only to revenue readers (8.2) | (M6 input) |
| Temporal summaries | Temporal-flow memory, sourceEventIds, 6-hourly | Tenant predicate on update; embedding dedup; loss accounting | Fix update scope; dedup | Phase 7 / M2 |
| Metamemory | Eval harness (weak, R 3.8 Ragas gaps), channel errors collapse to empty | Coverage index, honest failure states | Add channel status to the pack | Phase 7, 10 / M0 benchmarks |
| Defensive memory | Immune service in-process (volatile) | Quarantine flag, innate screens on stored external content | MEM packet after the scope fixes | — / M8 |

Activation: behaviour-changing memory packets follow the owner's ladder "OFF -> SHADOW -> CANARY -> READ_ENABLED ->
ADVISORY -> ACTIVE" (R 1.7 lane M12) and #124's `CONTEXT_GENOME_READ/WRITE=OFF|SHADOW|ACTIVE` pattern where a switch can
be measured before it is made (MEM-CLASS-READ); pure leak fixes ship without a flag, since keeping a leak switchable is
not a safe default.

What this design does **not** propose for v1: the portable Vault (phase 2), local-first sync (phase 9), Wiki/INDEX
projections (phase 6), the general entity graph beyond domain foreign keys (phase 5), the receptor fabric (M3), associative
spreading activation (M4 beyond entity-graph completion), RMCC (M5), and the lifelong projection (M10). They stay in the
reference plan, unchanged, as later work; `OPEN-QUESTIONS-FOR-OWNER.md` Q6 asks which, if any, the owner wants in v1.

---

## 13. Mechanism ledger (a first entry toward the owner's Discovery Ledger, R 1.2)

Disposition vocabulary from R 1.2: RETAINS / EXTENDS / REFINES / CONFLICTS / REJECTED / RESEARCH CANDIDATE.

| Mechanism | Source | Disposition in this design | Evidence level: of the science (S/AI), and whether tested here |
|---|---|---|---|
| Context Genome substrate, scopes, kinds, authority != confidence, bitemporal | R 1.1, R 1.10 | RETAINS | engineering consensus (AI §6) |
| One architecture, many projections | R 1.9 | RETAINS; reading "shared laws, separate stores" (Q1) | — |
| Index-not-content episodic tier | S B4 | EXTENDS (R 2.1 "link to domain authority") | moderate (theory); untested for this use |
| Taint propagation of data class | PROP | EXTENDS D-238 to derived memory | standard information-flow control |
| Salience and prediction-error gate | R 1.7 M6; S C5 | REFINES the existing salience service | strong (human data); untested for this use until E-ABL-2 |
| Activation (ACT-R) instead of age decay | S C1 | REFINES current `exp(-age/30d)` | strong (human data); untested for this use until E-ABL-1 |
| Regenerate-from-source consolidation, loss accounting | R 2.5 G163; S D1 | RETAINS / EXTENDS | widely observed (AI §1) |
| Read-triggered re-verification | S B3 | REFINES reconsolidation (inverted) | contested in biology; sound in engineering |
| Pattern separation via scoped dedup | R 1.7 M4; S C4 | RETAINS | strong (theory); untested for this use (E-SEP) |
| Spreading activation, lateral inhibition, mycelial reinforcement | R 1.2, R 3.4 #126 | RESEARCH CANDIDATE (after MEM-EVAL-SUITE; ablation vs entity-graph completion) | moderate |
| RMCC / ContextCell rank algebra | R 1.3 | RESEARCH CANDIDATE (owner already gated it) | theoretical |
| Hyperdimensional / Hopfield / tensor networks | R 1.8 track 2, R 1.3 | RESEARCH CANDIDATE | theoretical for this use |
| Receptor fabric and receptor gaps | R 1.6 | RESEARCH CANDIDATE (v1 out of scope) | — |
| Immune-style defensive memory | R 1.2, R 1.7 M8; S F | EXTENDS (innate screens in v1; adaptive later) | analogy; attacks are real (AI §14) |
| Procedure ladder with revaluation | R 1.11; S D2 | RETAINS / EXTENDS | strong (human data); untested for this use |
| Portable Vault, local-first | R 2.1-2.2 | RETAINS as later phase | — |
| Model-written core memory (MemGPT self-edit) | AI §4 | REJECTED as authoritative; allowed as proposal | poisoning risk |
| Third-party memory runtimes (Graphiti, Mem0, Letta) | R 1.1 | REJECTED as dependency (owner rule); patterns absorbed | — |
| Endocrine/state memory, hysteresis, priming and reset | R 1.2 families 9-10, R 1.7 M8 | RESEARCH CANDIDATE, not v1 (slow tenant state biasing budgets, design 9, is the nearest v1 use) | analogy |
| Epigenetic expression overlays | R 1.2 family 5 | RETAINS as the projection idea (one canonical store, per-projection views); no separate mechanism in v1 | analogy |
| Bacterial phase variation, bet-hedging, competing hypothesis populations | R 1.2 family 6, R 1.3 | RESEARCH CANDIDATE, not v1 | analogy |
| Clonal dominance hazards (haematopoietic) | R 1.2 family 8, R 1.7 M7 "diversity floor" | RESEARCH CANDIDATE; retrieval diversity and the self-reinforcement check (EVALUATION E-POI-3) are the v1 guard | analogy |
| Stigmergic / swarm memory | R 1.2 family 11 | RETAINS for agents (the repository and #80 are the shared trace, Track 1); product use not v1 | moderate (science) |
| Ecological / evolutionary and multi-scale memory | R 1.2 families 12-13 | RESEARCH CANDIDATE, not v1 | analogy |
| Predictive / counterfactual memory (what was predicted, alternatives) | R 1.8 track 3 | RESEARCH CANDIDATE; v1 records predictions only where `predErr` needs them (3.2); Q12 | — |
| Structural Intelligence Atlas | R 1.4 | RESEARCH CANDIDATE (the owner made it a catalogue, not a runtime) | — |
| Specialisation / Differentiation Engine | R 1.13 | RESEARCH CANDIDATE, not v1 (an agent-factory question more than a memory one) | analogy |
| Scale-Recursive Control / nested world models | R 1.14 | RESEARCH CANDIDATE; the zoom-in/zoom-out-with-provenance requirement is RETAINED (derivedFrom, drill-down) | — |
| Lifelong / second-brain projection | R 1.5, R 1.7 M10 | RETAINS as a later projection, not v1 | — |
| Glymphatic clearance | S E5 | REJECTED as justification; copy hygiene justified by product defects | contested |

---

## 14. Check against the owner's invariants

| Invariant (source) | How the design satisfies it |
|---|---|
| "association != truth"; "activation strength != epistemic strength" (R 1.2) | Activation affects rank only; authority and verification are separate fields and never ranked up by use (5.5, 6.2) |
| "confidence != authority"; "repetition != verification"; "independent corroboration strengthens truth" (R 1.2) | Promotion needs `n_indep` distinct sources (5.4); access counts never change confidence |
| "learned procedure != permission" (R 1.2, R 1.11) | Section 7; enforcement separate |
| "hypothesis != fact"; AI inference not truth (R 1.2, R 2.1 l.437) | Model writes are proposals (3.3) |
| "forgetting should not erase authoritative evidence/audit history" (R 1.2) | Section 4 |
| "untrusted/external memory cannot silently gain authority" (R 1.2) | 3.5, 8.3 |
| "every abstraction must remain traceable" (R 1.2) | `derivedFrom`, source coverage (3.1, 5.3) |
| "no fake-green memory capability" (R 1.2, R 1.7) | Evaluation plan: each mechanism needs a live causal path and an ablation |
| "Raw/source evidence ... never replaced by summaries/schemas" (R 1.10) | Verbatim fetch for figures (6.3); summaries derived |
| "Transient working/activation memory remains separate" (R 1.10) | T1 is never persisted as memory |
| "Sparse/lazy higher-order structure only" (R 1.10) | No higher-order structure in v1 |
| "Different memory classes have different plasticity" (R 1.10) | Section 4 last bullet |
| Plan hard invariants 1-10 (R 2.2) | 1 no parallel authority: extends existing seams (section 12); 2 vectors derived; 3 inference not truth; 4 supersession with lineage; 5 domain identity reused; 6 no provider-specific format (representation spec); 7 no second Mission Control; 8 no file grants authority; 9 no fake green; 10 Atlas: `architecture/atlas/` is on main as a design record that was never materialised (BUILD-MAP #141 "PORTED PARTS"), so the obligation has nowhere live to land (Q7) |
| #123 "inaccessible source memory cannot leak through a derived aggregate"; #126 "inaccessible nodes cannot influence accessible aggregates" | Filter-first (6.1) plus taint propagation (8.2) |
| #124 "confidence=0 remains 0" (a persistence invariant); "old authoritative facts are not discarded solely by age"; #122 "zero-confidence fallback bug" | Confidence never decays with age (5.5, PROP); the retrieval fallback scores confidence 0 like an unscored row (current `confidence ? confidence*0.5+0.5 : 0.5`, R 4.2): MEM-EXPIRED-NOT-SERVED |
| #153 "context pruning/compaction changes the active working set, never canonical truth" | Section 4, 6 |
| D-100, D-128, D-226, D-227, D-233, D-234, D-238 | Section 8.2 (applying "indirectly" to all memory is a reading, Q5) |
| D-254 small, tests-first, schema named, backfill dry-run on owner authority | `PRODUCT-MEMORY-PACKETS-PROPOSAL.md` |
