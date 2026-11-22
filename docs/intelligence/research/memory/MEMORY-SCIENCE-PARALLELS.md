# Memory science parallels (KF-MEMORY-RND-001, deliverable 2)

Status: research record, 2026-11-22. Track 2 of owner ruling D-253 (research and design only). No authority:
nothing here releases implementation.

Purpose: extend the owner's prior biological and medical research (recorded in `PRIOR-RESEARCH-RECOVERED.md`,
mainly issue #106 comment 5981828884, "Memory Architecture Discovery continuity invariant", 2026-10-04) with the
established science behind each mechanism, so that the design (`KEYFLOW-MEMORY-SYSTEM-DESIGN-001.md`) borrows
what the science actually supports and no more.

## How to read this file

Every entry has the same five parts:

- **Science**: what the field holds, with a standard source (author, year, book or paper). Sources are cited from
  the author's knowledge of the literature; none was re-read for this document. Where the author is unsure whether a
  source says exactly what is attributed to it, the entry says so ("verify").
- **Evidence**: strong (replicated over decades, textbook consensus), moderate (well supported, mechanism or scope
  debated), or contested (live disagreement, or largely theoretical).
- **Engineering analogue** [ANA]: the mechanism it suggests for a software memory.
- **Where it breaks**: the limits of the analogy. Biology is an existence proof and a source of hypotheses, never a
  specification; the owner's own rule is "no forced biological/physical analogy where standard CS is superior"
  (#106 comment 5981955643).
- **Design use** [PROP]: whether the design adopts it (and where), or not.

Labels used throughout: **[SCI]** established science, **[ANA]** analogy, **[PROP]** this document's proposal. In each
entry the "Science" part is [SCI], the "Engineering analogue" and "Where it breaks" parts are [ANA], and the "Design use"
part is [PROP]. Citations were checked by an independent reviewer from knowledge of the literature (not re-read online);
the corrections it found are applied.

General textbook sources referred to below: Kandel, Schwartz, Jessell et al., *Principles of Neural Science*
(5th ed. 2013, 6th ed. 2021); Squire and Kandel, *Memory: From Mind to Molecules* (2nd ed. 2009); Baddeley,
Eysenck and Anderson, *Memory* (2nd ed. 2015); Murphy and Weaver, *Janeway's Immunobiology* (9th ed. 2016);
Guyton and Hall, *Textbook of Medical Physiology*.

---

## Part A. Memory systems

### A1. Sensory memory

- **Science** [SCI]: very brief, high-capacity, modality-specific buffers. Sperling (1960, *Psychological
  Monographs*) showed with partial report that iconic memory holds more than can be reported, decaying within
  roughly a few hundred milliseconds; echoic memory lasts longer (seconds; Darwin, Turvey and Crowder 1972).
  Atkinson and Shiffrin (1968) placed sensory registers before a short-term store in their modal model.
- **Evidence**: strong for the phenomenon; exact durations vary with method.
- **Engineering analogue** [ANA]: raw intake buffers: request payloads, webhook bodies, streamed tool output, the full
  text of a document before anything is extracted. Large, short-lived, most of it never attended to.
- **Where it breaks**: biological sensory memory is lost by design; in an auditable business system raw input that
  matters (an invoice, a message) is *evidence* and must be kept in its source system. The analogue is the
  *transient parse buffer*, not the record.
- **Design use** [PROP]: tier T0 ("intake buffer") in the design; the rule that intake is not memory until encoded matches
  the owner's "Raw capture is not itself knowledge" (#106 comment 5982024549) and "Receptors are not authoritative by
  default" (5982051462).

### A2. Working memory, capacity and chunking

- **Science** [SCI]: Baddeley and Hitch (1974) replaced the unitary short-term store with a multi-component working
  memory (central executive, phonological loop, visuospatial sketchpad); Baddeley (2000, *Trends in Cognitive
  Sciences*) added the episodic buffer. Miller (1956) "seven, plus or minus two" was about span and chunking; Cowan
  (2001, *Behavioral and Brain Sciences*) argued the capacity of the focus of attention is nearer three to five
  chunks. Chunking (Miller 1956; Chase and Simon 1973 on chess expertise) raises effective capacity by recoding many
  items as one familiar unit; expertise works largely through better chunks and long-term working memory (Ericsson
  and Kintsch 1995).
- **Evidence**: strong for capacity limits and chunking; the exact number and the architecture (multi-component vs
  embedded-processes, Cowan) are debated.
- **Engineering analogue** [ANA]: the model's context window is the working memory; the agent's live context is the
  scarcest resource. Chunking is the compiler's job: hand the model a few large meaningful units (a packet bundle, a
  ruling row with its id) rather than many fragments. Expertise as chunks maps to procedural memory and schemas that
  let one pointer stand for a whole procedure.
- **Where it breaks**: a context window is not capacity-limited in items the way human working memory is; it holds
  hundreds of thousands of tokens. The binding constraint is different: cost, latency and attention dilution
  (see the AI survey, "context rot" and "lost in the middle"). So the human number (4 or 7) must not be borrowed as
  a design constant. What transfers is the principle: a small, well-chunked active set outperforms a large unstructured one.
- **Design use** [PROP]: the context compiler's budget and its "chunk by pointer" rule (design section 6). Track 1 already
  applies it ("Compile, do not load"; "Point, do not retype").

### A3. Episodic, semantic and procedural memory (Tulving; Squire)

- **Science** [SCI]: Tulving (1972, in Tulving and Donaldson, *Organization of Memory*) distinguished episodic memory
  (personally experienced events located in time and place) from semantic memory (general knowledge); Tulving (1985,
  *Canadian Psychology*) linked episodic memory to autonoetic ("self-knowing") consciousness. Squire's taxonomy
  (Squire 1992, *Psychological Review*; Squire 2004, *Neurobiology of Learning and Memory*) divides long-term memory
  into declarative (episodic and semantic; medial temporal lobe and diencephalon) and nondeclarative (procedural
  skills and habits, striatum; priming, neocortex; simple classical conditioning, cerebellum and amygdala;
  non-associative learning, reflex pathways).
- **Evidence**: strong for the dissociations (patient H.M.: amnesia reported by Scoville and Milner 1957; intact mirror-drawing learning
  shown by Milner 1962 and Corkin 1968, while he could not form new declarative memories). The boundary between episodic and semantic is
  graded rather than sharp (semanticisation of episodes over time).
- **Engineering analogue** [ANA]: episodic = an append-only, time-stamped event log with context (who, when, which
  tenant, which source); semantic = a store of current facts and decisions, each traceable to episodes; procedural =
  versioned runbooks and skills; priming = cached context that biases the next retrieval.
- **Where it breaks**: in the brain the systems interact continuously and the same neurons may take part in several;
  in software they can and should be separate stores with explicit derivation links. Also, human semantic memory
  loses its source; a business memory must not (see D2, source monitoring).
- **Design use** [PROP]: the tier structure (design section 2). The owner's memory kinds (#106, "Architecture update",
  FACT, PREFERENCE, OBSERVATION, EPISODE, DECISION, POLICY, PROCEDURE, HYPOTHESIS, DERIVED_STATE, LESSON, CONSTRAINT)
  refine this taxonomy and are kept.

---

## Part B. Encoding, consolidation and the hippocampus

### B0. Hebbian learning, LTP and LTD

- **Science** [SCI]: Hebb (1949, *The Organization of Behavior*) proposed that co-active neurons strengthen their
  connection. Long-term potentiation was demonstrated by Bliss and Lømo (1973, *Journal of Physiology*); long-term
  depression and spike-timing-dependent plasticity (Markram et al. 1997; Bi and Poo 1998) complete the picture.
  Early-phase LTP is protein-synthesis independent; late-phase LTP (hours) needs protein synthesis.
- **Evidence**: strong for LTP/LTD as cellular mechanisms; their sufficiency for memory is well supported but debated.
- **Engineering analogue** [ANA]: association weights strengthened by co-use and weakened by disuse.
- **Where it breaks**: co-activation is not causation and not truth; Hebbian strengthening of an association says two
  items were used together, nothing more (the owner's "association != truth").
- **Design use** [PROP]: association weights in consolidation (design 5.5), never feeding confidence.

### B1. Encoding

- **Science** [SCI]: depth of processing (Craik and Lockhart 1972) and the generation effect (Slamecka and Graf 1978): meaningful, elaborated
  encoding is remembered better. Encoding specificity (Tulving and Thomson 1973): retrieval succeeds when the cue
  matches the encoding context. Transfer-appropriate processing (Morris, Bransford and Franks 1977).
- **Evidence**: strong (levels-of-processing is criticised as circular, but the elaboration effect is robust).
- **Engineering analogue** [ANA]: at write time, store the context the item will be retrieved by (tenant, entity ids,
  task type, module, time, source), not only the text. Encoding specificity is the argument for rich metadata and
  for hybrid retrieval (keyword and structured filters, not only embeddings).
- **Where it breaks**: humans cannot choose their retrieval cues in advance; a system can index on several.
- **Design use** [PROP]: the write path's required envelope (design section 3).

### B2. Consolidation (synaptic and systems)

- **Science** [SCI]: Müller and Pilzecker (1900) proposed consolidation. Synaptic consolidation (hours) depends on
  protein synthesis (late-phase LTP). Systems consolidation (weeks to years) gradually makes memories less dependent
  on the hippocampus: the standard model (Squire and Alvarez 1995). Retrograde amnesia graded in time (recent
  memories lost, remote kept; Ribot's law, 1881) is the main evidence. Multiple trace theory and later trace
  transformation theory (Nadel and Moscovitch 1997; Winocur and Moscovitch 2011) hold that detailed episodic memories
  stay hippocampus-dependent and what becomes cortical is a schematic, semanticised version.
- **Evidence**: strong for the existence of consolidation; the standard model vs trace transformation is contested.
- **Engineering analogue** [ANA]: a background job that turns recent episodes into durable semantic facts and schemas,
  while the episodes are kept. Trace transformation is the closer fit for an auditable system: the gist migrates,
  the detail stays retrievable in the episodic store.
- **Where it breaks**: biological consolidation is lossy and not reversible; ours must keep lineage from every
  consolidated item back to its episodes (owner: "abstraction must be reversible by lineage/drill-down", #106 comment
  5982024549).
- **Design use** [PROP]: consolidation (design section 5), with "derived, never authoritative" on every consolidated item.

### B3. Reconsolidation

- **Science** [SCI]: retrieving a consolidated memory can return it to a labile state in which it can be modified or
  disrupted (Nader, Schafe and LeDoux 2000, *Nature*, rats, fear memory, anisomycin in the amygdala). Boundary
  conditions are numerous (memory age, strength, prediction error at retrieval; Sevenster, Beckers and Kindt 2013
  argue prediction error is needed). Clinical translation (e.g. propranolol for phobia or PTSD) has mixed results.
- **Evidence**: moderate in animals; contested in humans.
- **Engineering analogue** [ANA]: a retrieved item is a moment to re-verify and update it (refresh `lastVerifiedAt`,
  attach new evidence, mark contradiction). Retrieval as an update opportunity.
- **Where it breaks**: in humans reconsolidation is a *vulnerability* (memories change silently when recalled; this
  is one route to false memory). In software a read must never silently rewrite a memory. Updates on retrieval must
  be explicit, versioned writes with provenance.
- **Design use** [PROP]: "read-triggered re-verification, never read-triggered rewrite" (design section 5.4).

### B4. Hippocampal indexing and complementary learning systems

- **Science** [SCI]: Teyler and DiScenna (1986, *Behavioral Neuroscience*) proposed the hippocampal memory indexing
  theory: the hippocampus stores an index to the distributed neocortical patterns active during an experience, not
  the content itself; Teyler and Rudy (2007, *Hippocampus*) updated it. Complementary learning systems (McClelland,
  McNaughton and O'Reilly 1995, *Psychological Review*): a fast-learning hippocampus with sparse, separated
  representations stores episodes quickly; a slow-learning neocortex extracts structure through interleaved
  replay; fast learning in the cortex alone would cause catastrophic interference. Kumaran, Hassabis and McClelland
  (2016, *Trends in Cognitive Sciences*) updated it: schema-consistent information can be learned by the cortex
  quickly (Tse et al. 2007, *Science*, rats with a learned schema learned new paired associates in one trial, and the memory became
  hippocampus-independent within 48 hours).
- **Evidence**: CLS: strong as a computational account, strongly influential in machine learning (experience replay).
  Indexing theory: influential, direct evidence moderate (engram studies such as Tanaka et al. 2014, *Neuron*, support it).
- **Engineering analogue** [ANA]: two stores with different learning rates. A fast, append-only episodic index (cheap
  writes, pointers to source records) and a slow semantic layer updated only by consolidation over many episodes.
  The index-not-content idea is the strongest single lesson: store *pointers* to authoritative business records
  (invoice id, message id) plus retrieval keys, not copies of their content.
- **Where it breaks**: in software, there is no catastrophic interference between rows of a database; it arises only
  when the "slow store" is a learned model (fine-tuning) or a set of rewritten summaries. The second case is real for
  us: repeated re-summarisation is a slow learner that can overwrite structure (summary drift). So the CLS argument
  applies to the summaries and schemas, not to the tables.
- **Design use** [PROP]: core of the design. Index-not-content is also the cheapest way to honour tenancy and revenue
  scope: an index entry that points to a finance record is resolved through the record's own permission check
  at read time (design section 8).

### B5. Sleep, replay and systems consolidation

- **Science** [SCI]: co-firing of hippocampal place cells active together in waking is reactivated in subsequent sleep
  (Wilson and McNaughton 1994, *Science*); the temporal order of waking sequences is preserved (Skaggs and McNaughton
  1996, *Science*) and replayed time-compressed (Nádasdy et al. 1999, *Journal of Neuroscience*; Lee and Wilson 2002,
  *Neuron*). Sleep benefits declarative memory (Diekelmann
  and Born 2010, *Nature Reviews Neuroscience*); active systems consolidation proposes slow oscillations, spindles and
  sharp-wave ripples coordinate hippocampo-cortical transfer. Disrupting ripples impairs learning in rats (Girardeau
  et al. 2009, *Nature Neuroscience*). Replay is also seen in awake rest and can run in reverse (Foster and Wilson
  2006). Prioritised replay: some accounts hold that replay favours rewarded or surprising experiences (Mattar and
  Daw 2018, *Nature Neuroscience*, a normative model; verify the extent of empirical support).
- **Evidence**: strong for replay's existence and sleep's benefit; causal role in consolidation moderately strong.
- **Engineering analogue** [ANA]: offline consolidation windows (scheduled, low-traffic, budget-capped) that replay recent
  episodes, prioritised by surprise (prediction error) and outcome value, to extract and update semantic memory.
  Prioritised experience replay in RL (Schaul et al. 2016) is the established engineering analogue.
- **Where it breaks**: sleep is a global offline state; a multi-tenant system never sleeps and must consolidate
  per tenant, interleaved with live traffic, under a cost budget. The existing KEY circadian service models this; see
  design section 9.
- **Design use** [PROP]: consolidation triggers (design section 5.1).

### B6. Synaptic homeostasis

- **Science** [SCI]: the synaptic homeostasis hypothesis (Tononi and Cirelli 2003, *Brain Research Bulletin*; 2014,
  *Neuron*) holds that waking learning net-potentiates synapses and sleep downscales them, restoring signal-to-noise
  and energy balance; de Vivo et al. (2017, *Science*) reported smaller synapses after sleep in mouse cortex.
- **Evidence**: moderate; contested (alternative accounts emphasise selective potentiation during sleep).
- **Engineering analogue** [ANA]: periodic renormalisation of scores: salience, activation and association weights decay
  or are rescaled globally so that the ranking does not saturate and old high scores do not dominate forever.
- **Where it breaks**: rescaling evidence-bearing fields (confidence, authority) would be wrong. Only derived
  ranking signals (activation, access frequency) may be renormalised.
- **Design use** [PROP]: "downscale activation, never confidence or authority" (design section 5.5).

---

## Part C. Forgetting, spacing, schemas

### C1. Forgetting: decay, interference, and why forgetting is functional

- **Science** [SCI]: Ebbinghaus (1885, *Über das Gedächtnis*) measured savings for nonsense syllables: steep early
  loss, then slow; the curve is better fit by a power or similar function than a simple exponential (Wixted and
  Ebbesen 1991; Rubin and Wenzel 1996). Jenkins and Dallenbach (1924): less forgetting after sleep than waking,
  read as evidence for interference over decay. McGeoch (1932) argued interference not disuse causes forgetting;
  proactive and retroactive interference are robust (Underwood 1957). Retrieval-induced forgetting: practising some
  items impairs recall of related unpractised items (Anderson, Bjork and Bjork 1994). Directed forgetting: an
  instruction to forget reduces later recall (item and list methods; MacLeod 1998 review); think/no-think suppression
  (Anderson and Green 2001, *Nature*; replication has been mixed). Functional view: Anderson and Schooler (1991,
  *Psychological Science*) showed that the probability an item will be needed falls with time and rises with
  frequency in ways that match forgetting curves, so forgetting tracks need (rational analysis). Richards and
  Frankland (2017, *Neuron*) argue forgetting supports generalisation and flexibility. Active forgetting mechanisms
  (e.g. Rac1 and dopamine-dependent in *Drosophila*; Davis and Zhong 2017, *Neuron*) exist.
- **Evidence**: strong for curves and interference; decay as a cause is contested; the rational-analysis argument is
  influential and well supported for recency and frequency statistics.
- **Engineering analogue** [ANA]: forgetting = lowering retrieval priority and removing *access paths* and *derived
  copies*, not deleting authoritative records. Anderson and Schooler give the formula shape: rank by a need
  probability estimated from recency and frequency of use (ACT-R base-level activation, `B = ln(sum_j t_j^-d)`,
  Anderson and Lebiere 1998, with decay parameter d commonly set to 0.5 in ACT-R models). Interference is the
  real problem in retrieval: near-duplicate and superseded items compete with the current one; the remedy is
  supersession links and dedup, not time decay.
- **Where it breaks**: legal, audit and tenancy obligations override "need": some records must be kept although never
  read; some must be deleted on request although useful (privacy erasure is not forgetting, it is a governed
  deletion with its own record). Also retrieval-induced forgetting is a *bias* to guard against: frequently retrieved
  memories should not suppress related, rarely retrieved but relevant ones (diversity in retrieval).
- **Note**: ACT-R's base-level equation has no spacing effect; Pavlik and Anderson (2005, *Cognitive Science*) make decay
  depend on activation at each presentation, the principled basis for a spaced re-verification schedule (C2).
- **Design use** [PROP]: design section 5.5 (forgetting removes derived copies and access paths, under governance); the
  ACT-R activation as the ranking term for recency/frequency; the owner's G161 "Forgetting as Governance" is the
  governing framing.

### C2. Spacing and testing effects

- **Science** [SCI]: the spacing effect (Ebbinghaus 1885; meta-analysis Cepeda et al. 2006, *Psychological
  Bulletin*) and the testing effect or retrieval practice (Roediger and Karpicke 2006, *Psychological Science*;
  Karpicke and Roediger 2008, *Science*). Desirable difficulties (Bjork 1994).
- **Evidence**: strong, among the most replicated findings in learning science.
- **Engineering analogue** [ANA]: for the system itself, a weak one: a database does not strengthen by recall. Two real
  uses: (1) for the *human* user (the owner's Lifelong second-brain target and research gap 10, "cognitive
  offloading", #106 comment 5982128271), surface memories for review on a spaced schedule; (2) for the system,
  "testing" = scheduled re-verification of memories against source, at intervals that grow while they keep passing
  (a spaced verification schedule).
- **Where it breaks**: using recall to *strengthen* a memory's ranking makes retrieval self-reinforcing (rich get
  richer), which is the owner's "repetition != verification" hazard.
- **Design use** [PROP]: spaced re-verification (design section 7); access counts never raise confidence.

### C3. Schemas and gist

- **Science** [SCI]: Bartlett (1932, *Remembering*) showed reconstructive recall shaped by schemas ("The War of the
  Ghosts"). Fuzzy-trace theory (Brainerd and Reyna 1990; Reyna and Brainerd 1995) holds that verbatim and gist traces
  are encoded in parallel and decay at different rates; gist is more durable and drives many false memories
  (DRM paradigm: Roediger and McDermott 1995). Schemas speed learning of consistent information (Tse et al. 2007;
  van Kesteren et al. 2012, *Trends in Neurosciences*, SLIMM model).
- **Evidence**: strong.
- **Engineering analogue** [ANA]: keep both verbatim (source pointer, exact text) and gist (summary, schema). Answer
  "what kind of thing usually happens" from gist; answer "what exactly was agreed, what figure" only from verbatim.
  Schemas speed encoding: new items that fit an existing schema can be linked rather than re-derived.
- **Where it breaks**: schema-driven distortion is a defect in an auditable system. A summary must never be quoted
  as if it were verbatim.
- **Design use** [PROP]: the verbatim/gist split and the rule "figures, commitments, names and dates are answered from
  verbatim sources only" (design section 6.3). Matches the owner's "Summary/schema never replaces raw evidence"
  (#106 comment 5982087092, lane M6).

### C4. Pattern separation and pattern completion

- **Science** [SCI]: Marr (1971) proposed the hippocampus as an associative memory; computational work (Treves and
  Rolls 1994; McNaughton and Morris 1987) assigns pattern separation to the dentate gyrus (sparse coding, large
  expansion) and pattern completion to CA3 (recurrent collaterals, autoassociation). Evidence in rodents (Leutgeb et
  al. 2007, *Science*) and humans (Bakker et al. 2008, *Science*, fMRI). Yassa and Stark (2011, *Trends in
  Neurosciences*) review.
- **Evidence**: strong as a computational account; moderately strong empirically.
- **Engineering analogue** [ANA]: separation = keep similar but distinct episodes distinct (two invoices to the same
  customer, two members' lessons): stable unique ids, tenant and member keys, no merging by embedding similarity
  alone. Completion = retrieve a whole episode from a partial cue (a customer name retrieves the conversation, the
  quote and the payment).
- **Where it breaks**: the brain trades the two off in one circuit; software can do both exactly by keying. The
  real engineering risk is *false merge* in dedup and clustering (separation failure), which in a multi-tenant
  system is also a leak. The owner's benchmark list already has "pattern separation false-merge rate" (#106 comment
  5982087092).
- **Design use** [PROP]: dedup only within (tenant, member scope, entity) and only on exact or near-exact match with a
  human-readable merge record; completion by entity-graph expansion within scope (design sections 3.4 and 6).

### C5. Salience, neuromodulation and prediction error

- **Science** [SCI]: emotional arousal enhances consolidation via the basolateral amygdala and noradrenaline
  (McGaugh 2000, *Science*; 2004, *Annual Review of Neuroscience*); beta-blockers can reduce the emotional memory
  advantage (Cahill et al. 1994, *Nature*). Dopamine neurons signal reward prediction error (Schultz, Dayan and
  Montague 1997, *Science*), the temporal-difference learning signal. Novelty and dopamine gate hippocampal
  long-term memory (Lisman and Grace 2005, *Neuron*, hippocampal-VTA loop). Locus coeruleus noradrenaline and
  adaptive gain (Aston-Jones and Cohen 2005). Synaptic tagging and capture (Frey and Morris 1997, *Nature*, hippocampal slices): weak
  potentiation is stabilised if strong potentiation occurs nearby in time. Its behavioural counterpart, "behavioural
  tagging", was shown by Moncada and Viola (2007, *Journal of Neuroscience*) and Ballarini et al. (2009, *PNAS*): a weak
  learning event is remembered if a novel or strong event occurs close in time. In humans, Dunsmoor et al. (2015,
  *Nature*) found emotional learning retroactively strengthens memory for conceptually related earlier items.
- **Evidence**: strong for amygdala-noradrenaline modulation and dopamine RPE; moderate for the specific hippocampal
  loop models.
- **Engineering analogue** [ANA]: a write gate and a consolidation priority driven by (a) prediction error (the outcome
  differed from what was predicted), (b) consequence (money, customer, deadline, authority), (c) novelty, (d) explicit
  user marking. Tagging and capture suggests: when a high-salience event happens (a payment fails), raise the
  consolidation priority of related low-salience events in the same window.
- **Where it breaks**: emotional salience in humans also distorts (flashbulb memories are confident but often
  inaccurate; Talarico and Rubin 2003). Salience must raise *retention and review priority*, never confidence.
- **Acetylcholine** [SCI]: Hasselmo (1999, *Trends in Cognitive Sciences*; 2006, *Current Opinion in Neurobiology*)
  proposed that high acetylcholine sets the hippocampus to encoding mode (suppressing recurrent retrieval) and low
  acetylcholine to retrieval and consolidation mode (evidence moderate). [ANA] The nearest engineering parallel is
  keeping write paths and read paths separate, so retrieval never rewrites memory (B3).
- **Design use** [PROP]: the salience formula (design section 3.2) with named variables; tagging-and-capture as a
  consolidation rule.

### C6. Attention as a bottleneck

- **Science** [SCI]: Broadbent (1958) filter theory; Treisman attenuation (1964); load theory (Lavie 1995);
  biased competition (Desimone and Duncan 1995). Inattentional blindness (Simons and Chabris 1999). Attention gates
  what enters working memory and what is encoded.
- **Evidence**: strong.
- **Engineering analogue** [ANA]: transformer attention is a different mechanism with the same name. The analogue that
  transfers is the *budget*: the context compiler decides what enters the model's context, under a token budget,
  with explicit priority. The owner's G157 "Attention Budget" (fictional intelligence genome tranche) is this.
- **Where it breaks**: language-model attention is not limited to a few items, but retrieval of information placed
  in the middle of long contexts is measurably worse in some models (Liu et al. 2023, "Lost in the Middle"; see the
  AI survey). The bottleneck is dilution, not a hard filter.
- **Design use** [PROP]: the per-task budget and the ordering rules (design section 6).

---

## Part D. Learning without forgetting; procedure; monitoring

### D1. Stability-plasticity and catastrophic forgetting

- **Science** [SCI]: Grossberg (1980, *Psychological Review*; 1987, *Cognitive Science*) named the stability-plasticity dilemma. McCloskey and Cohen (1989) and
  Ratcliff (1990) showed catastrophic interference in connectionist networks. Remedies: interleaved replay (CLS,
  above), elastic weight consolidation (Kirkpatrick et al. 2017, *PNAS*), generative replay, modular and
  parameter-isolation methods (survey: Parisi et al. 2019, *Neural Networks*; De Lange et al. 2021).
- **Evidence**: strong for the phenomenon in neural networks.
- **Engineering analogue** [ANA]: KEY's memory is mostly not learned weights, so catastrophic forgetting enters through
  (a) rewritten summaries and schemas, (b) any fine-tuning, (c) procedure versions that overwrite older ones.
  Remedies: never overwrite, version and supersede; regenerate summaries from episodes (not from the previous
  summary) on a schedule; keep the previous procedure version runnable.
- **Where it breaks**: databases do not forget by interference; the dilemma here is organisational (stale
  versus current), not representational.
- **Design use** [PROP]: "regenerate from source, never summarise a summary more than k times" (design section 5.3).
  The owner's research gap 1 (#106 comment 5982128271) asks for this.

### D2. Procedural learning: cerebellum, basal ganglia, habits

- **Science** [SCI]: the cerebellum supports error-driven motor adaptation and timing (Marr 1969; Albus 1971;
  climbing fibres carrying error signals; Ito 1984, *The Cerebellum and Neural Control*). The basal ganglia support action selection and habit formation
  (Graybiel 2008, *Annual Review of Neuroscience*); the shift from goal-directed (dorsomedial striatum) to habitual
  (dorsolateral striatum) control with overtraining, shown by insensitivity to outcome devaluation (Adams and
  Dickinson 1981; overtraining dependence: Adams 1982, *Quarterly Journal of Experimental Psychology B*; Yin and Knowlton 2006, *Nature Reviews Neuroscience*). Doya (1999, *Neural Networks*) proposed
  supervised learning in the cerebellum, reinforcement learning in the basal ganglia, unsupervised learning in the
  cortex. Fitts and Posner (1967) three stages of skill (cognitive, associative, autonomous).
- **Evidence**: strong.
- **Engineering analogue** [ANA]: a procedure is *earned* through repeated verified success (Fitts and Posner: from
  deliberate reasoning to cached routine) and corrected by error signals (cerebellar). Habit insensitivity to outcome
  devaluation is the key *hazard*: a routine that kept running after its goal changed. So every procedure needs a
  revaluation check: it must re-check its preconditions and the outcome it serves.
- **Where it breaks**: there is no motor plant; "automaticity" for an agent is skipping deliberation, which saves
  tokens but removes the chance to notice that conditions changed.
- **Design use** [PROP]: procedural memory lifecycle with revaluation (design section 7); maps to the existing
  `key-cortex-cerebellum.service.ts` (described in `PRIOR-RESEARCH-RECOVERED.md` part 4) and the owner's promotion
  ladder (#106 comment 5994706532).

### D3. Prospective memory

- **Science** [SCI]: remembering to do something in the future; event-based vs time-based (Einstein and McDaniel
  1990). The multiprocess framework (McDaniel and Einstein 2000): strategic monitoring vs spontaneous retrieval.
  Diary studies report prospective failures as a large share of everyday memory failures (e.g. Crovitz and
  Daniel 1984; verify the proportion).
- **Evidence**: strong.
- **Engineering analogue** [ANA]: intentions stored with explicit triggers (a time, an event pattern) checked by the
  system, not by the model remembering. In the agents' case: "next action" fields in the state file and scheduled
  check-ins; in KEY: follow-ups, reminders, open loops (the owner's "unresolved questions/open loops", #106 comment
  5982024549).
- **Where it breaks**: software can monitor triggers perfectly and cheaply; the failure mode is instead intentions
  that outlive their purpose (an orphaned reminder). Every intention needs an owner and an expiry.
- **Design use** [PROP]: an `INTENTION` record with trigger, owner and expiry (design section 2, T3 note).

### D4. Metamemory

- **Science** [SCI]: Hart (1965) feeling-of-knowing; Nelson and Narens (1990) monitoring and control framework;
  judgements of learning; tip-of-the-tongue (Brown and McNeill 1966). Two accounts of the feeling of knowing: cue familiarity
  (Reder 1987; Metcalfe, Schwartz and Joaquim 1993), and Koriat's (1993) accessibility account, based on the amount and
  ease of partial information retrieved. Both allow feelings of knowing that are confidently wrong.
- **Evidence**: strong.
- **Engineering analogue** [ANA]: the system's knowledge about its own memory: coverage (what is recorded for this tenant
  and topic), freshness (`lastVerifiedAt`, `validTo`), confidence calibration, and the ability to answer "not
  recorded". The cue-familiarity account is the warning: similarity scores from retrieval are familiarity, not knowledge.
- **Where it breaks**: calibration of language-model confidence is weak; metamemory must come from structured fields
  and coverage indexes, not the model's self-report.
- **Design use** [PROP]: metamemory (design section 8.5); evaluation (confabulation test).

### D5. Source monitoring and false memory

- **Science** [SCI]: source monitoring framework (Johnson, Hashtroudi and Lindsay 1993, *Psychological Bulletin*):
  memories do not carry source tags; source is inferred at retrieval, so source errors (reality monitoring,
  cryptomnesia) occur. Misinformation effect (Loftus and Palmer 1974; Loftus 2005 review). Imagination inflation and
  implanted false memories (Loftus and Pickrell 1995, "lost in the mall"; the size of that effect is debated).
  DRM false recall (Roediger and McDermott 1995).
- **Evidence**: strong.
- **Engineering analogue** [ANA]: the central lesson for AI memory: *carry the source tag explicitly with every item*, at
  write time, so that source is never inferred. The misinformation effect is the human analogue of memory poisoning:
  post-event content inserted into memory and later recalled as original.
- **Where it breaks**: we can do what the brain cannot (exact provenance), so the failure here is purely a design
  failure if it occurs.
- **Design use** [PROP]: mandatory source and authority fields; the distinction between what the user said, what a tool
  returned, what an external document claimed and what the model inferred (design section 3.1, 8.3).

---

## Part E. The wider nervous system

### E1. Spinal reflex arcs and central pattern generators

- **Science** [SCI]: Sherrington (*The Integrative Action of the Nervous System*, 1906) established reflex integration in the
  spinal cord; the monosynaptic stretch-reflex arc was demonstrated later (Lloyd 1943); spinal reflexes act without the brain; withdrawal reflexes are polysynaptic. Central pattern generators produce rhythmic
  output (locomotion, breathing) without rhythmic input or feedback (Brown 1911; Grillner on lamprey; Marder and
  Bucher 2001, *Current Biology*), modulated by descending and sensory input.
- **Evidence**: strong.
- **Engineering analogue** [ANA]: deterministic guards that act without calling the model: tenancy filter, revenue-scope
  filter, poisoning screens, budget enforcement. They are fast, local and not overridable by the "higher centre".
  CPGs: scheduled routines (consolidation cycles) that run on their own clock, modulated but not driven by load.
- **Where it breaks**: reflexes are adaptive (spinal learning exists, Wolpaw); our guards must *not* adapt
  silently; any change is a reviewed code change.
- **Design use** [PROP]: "reflex layer" of non-learned, non-model guards on every read and write (design section 8).

### E2. Autonomic nervous system, homeostasis and allostasis

- **Science** [SCI]: Cannon coined "homeostasis" (1926), set it out in 1929 (*Physiological Reviews*) and popularised it in
  *The Wisdom of the Body* (1932) (after Bernard's milieu intérieur).
  Sympathetic and parasympathetic branches regulate internal state largely outside awareness. Allostasis (Sterling
  and Eyer 1988; Sterling 2012, *Physiology & Behavior*): predictive regulation, changing set points in anticipation;
  allostatic load (McEwen 1998, *NEJM*) is the cumulative cost of chronic adaptation.
- **Evidence**: strong for homeostasis; allostasis is an accepted framework, its distinction from homeostasis is
  debated.
- **Engineering analogue** [ANA]: control loops that keep memory health variables in range: store size per tenant,
  retrieval latency, consolidation backlog, proportion of stale items, cost per turn. Allostasis: raise the
  consolidation budget before a known peak (month end, for invoicing businesses). Allostatic load: track the
  accumulated debt of deferred consolidation and unverified memories (the owner's "resilience debt", #106 comment
  5981828884, item 12).
- **Where it breaks**: biological set points evolved; ours are configured and must be visible.
- **Design use** [PROP]: memory health metrics and set points (design section 9; evaluation plan section 6).

### E3. Myelination

- **Science** [SCI]: myelin raises conduction velocity; activity-dependent myelination (adaptive myelination) is a
  form of plasticity: learning a motor skill requires new oligodendrocytes in mice (McKenzie et al. 2014,
  *Science*); Fields (2015, *Nature Reviews Neuroscience*) reviews.
- **Evidence**: moderate to strong for activity-dependent myelination; its role in learning is an active field.
- **Engineering analogue** [ANA]: caching frequently used paths: materialised views, prompt-cache prefixes, precompiled
  bundles for common tasks. The analogue is speed for a stable path, not new content.
- **Where it breaks**: a cache can serve stale content; myelin changes timing and synchrony rather than
  content, and does not go stale. Every cached
  path needs invalidation on change of its source (the owner's "stale context fails closed or is reconciled",
  #106 body, item 10).
- **Design use** [PROP]: cache-friendly ordering and invalidation (design section 6.4, 10).

### E4. Developmental pruning

- **Science** [SCI]: synapse density peaks in childhood and is pruned through adolescence (Huttenlocher 1979, 1997);
  activity-dependent refinement ("use it or lose it"; Hubel and Wiesel on ocular dominance); microglia and
  complement tag synapses for elimination (Stevens et al. 2007, *Cell*; Schafer et al. 2012, *Neuron*). Excess or
  deficient pruning is implicated (hypotheses) in schizophrenia and autism (Sekar et al. 2016, *Nature*, C4).
- **Evidence**: strong for pruning; disease links moderate.
- **Engineering analogue** [ANA]: early over-production of candidate links, associations and procedures, then pruning
  of those that never prove useful (never retrieved, never cited in a successful outcome). Pruning removes the *link*,
  not the evidence. The disease link is a useful warning: both under- and over-pruning are failure modes, so pruning
  needs bounds and a measurement of what it removed.
- **Where it breaks**: no critical period is fixed; pruning can run continuously.
- **Design use** [PROP]: association pruning in consolidation (design section 5.5); the owner's mycelial "weakening/pruning
  of poor paths" (#106 comment 5981828884, item 3).

### E5. The glymphatic system

- **Science** [SCI]: Iliff et al. (2012, *Science Translational Medicine*) and Xie et al. (2013, *Science*) described
  cerebrospinal-fluid-driven clearance of interstitial waste, increased in sleep (in mice). The size of the sleep
  effect and the mechanism (convective flow vs diffusion) are debated (e.g. Miao et al. 2024, *Nature Neuroscience*,
  reported reduced clearance during sleep in mice; verify).
- **Evidence**: contested.
- **Engineering analogue** [ANA]: a garbage-collection pass during consolidation windows: delete orphaned derived copies
  (embeddings whose source row is gone), expired caches and dangling index entries. This is the existing product
  defect class of W1F-MEMORY-COPIES and FU-MEMORY-COPIES-REWRITE (`V1-PLAN-RECUT.json`): copies that outlive their
  source.
- **Where it breaks**: the analogy rests on a contested finding; the engineering need does not. Cite the need, not
  the biology.
- **Design use** [PROP]: "copy hygiene" sweep (design section 5.6), dry-run first.

---

## Part F. Immune memory

- **Science** [SCI] (Janeway's *Immunobiology*; Abbas, Lichtman and Pillai, *Cellular and Molecular Immunology*):
  - **Innate vs adaptive**: innate immunity recognises conserved patterns (PAMPs via pattern-recognition receptors
    such as Toll-like receptors; Medzhitov and Janeway 1997) fast and without classical memory; adaptive immunity
    learns specific antigens.
  - **Clonal selection** (Burnet 1957): antigen selects the lymphocyte clones whose receptor fits, which expand.
  - **Memory B and T cells**: after an infection, long-lived memory cells give a faster, larger secondary response.
  - **Affinity maturation**: in germinal centres, somatic hypermutation plus selection raises antibody affinity over
    the response (Eisen and Siskind 1964; Victora and Nussenzweig 2012, *Annual Review of Immunology*).
  - **Tolerance**: central tolerance by negative selection of self-reactive T cells in the thymus (with AIRE driving
    expression of tissue antigens); peripheral tolerance by anergy and regulatory T cells. Failure gives autoimmunity.
  - **Trained immunity**: innate cells can show longer-term enhanced responses after some stimuli (Netea et al.
    2011, *Cell Host & Microbe*; 2016 *Science*): memory-like innate priming.
  - **Tissue-resident memory T cells** stay in tissues and respond locally (Mueller and Mackay 2016).
- **Evidence**: strong (trained immunity moderate).
- **Engineering analogue** [ANA]: defensive memory against memory poisoning and prompt injection.
  - Innate layer = fixed pattern screens on everything written (instruction-like text in stored content, secrets,
    cross-tenant ids, money figures in a non-revenue scope): fast, deterministic, no learning.
  - Adaptive layer = signatures learned from confirmed incidents (a payload that once poisoned a memory), applied to
    future writes, with clonal-selection-like promotion only after confirmation.
  - Tolerance = negative selection: a new signature is tested against a corpus of known-good memories before it is
    enabled, so the defence does not attack legitimate content (autoimmunity = false positives blocking normal work;
    the owner names "autoimmune-style blocking", #106 comment 5982087092, lane M8).
  - Affinity maturation = iterative refinement of procedures or detectors under selection by outcome, matching the
    owner's use for procedures (#106 comment 5994966639, item 9), with the owner's caution "never confuse selection
    fitness with authority".
  - Resident vs central memory = per-tenant memory that never leaves the tenant vs shared, tenant-free procedural
    knowledge. The analogy supports the owner's "central vs resident/local memory compartments" (item 7 of
    5981828884).
- **Where it breaks**: the immune system tolerates a background rate of autoimmunity and infection; a business system
  must treat a single cross-tenant leak as a defect, not a rate. Adaptive learning of detectors from adversarial
  inputs also invites adversaries to train the detector; detectors change only by reviewed release.
- **Design use** [PROP]: design section 8.3 (poisoning) and evaluation plan section 4.

---

## Part G. Clinical memory disorders as a failure-mode catalogue

Each disorder is a named, well-characterised way a memory system fails. The evaluation plan turns each into a test.

| Disorder | Science [SCI] | What it implies for a software memory | Test (see `EVALUATION-PLAN.md`) |
|---|---|---|---|
| Anterograde amnesia | Inability to form new declarative memories after medial temporal lobe damage; H.M. (Scoville and Milner 1957; Corkin 2002, 2013). Procedural learning spared. | The write path fails silently while reads still work: the system answers from old memory and never learns what happened today. | Write-then-read across a session boundary: an event from session 1 must be retrievable by session 2. |
| Retrograde amnesia | Loss of memories from before the injury, often temporally graded (Ribot 1881). | Migration, re-indexing or summarisation loses older memories; recent ones survive. | After a re-index or consolidation cycle, questions about the oldest episodes still answer correctly (or say "archived" with a drill-down). |
| Confabulation | Production of false memories without intent to deceive, often with frontal involvement; seen in Korsakoff syndrome and anterior communicating artery aneurysm (Schnider 2003, *Nature Reviews Neuroscience*, temporal-context-confusion account; Moscovitch 1989). | The model fills gaps with plausible content when memory is missing. This is the dominant risk for LLM memory. | Ask N questions whose answers are not recorded: the system must say "not recorded" for each; score false answers. |
| Korsakoff syndrome | Thiamine deficiency (often with alcohol use disorder); severe anterograde and retrograde amnesia, confabulation in early stages, diencephalic (mammillary bodies, thalamus) damage (Kopelman 1995, *British Journal of Psychiatry*; Victor, Adams and Collins). | Combined failure: cannot store new, loses old, fills gaps. Caused by a missing *supply* (thiamine): the analogue is a dependency (embedding provider, database) silently unavailable. | Dependency-outage test: with the embedding provider off, the system must degrade to keyword retrieval and say so, not answer from nothing. |
| Semantic dementia | Progressive loss of conceptual knowledge with anterior temporal lobe atrophy; episodic memory relatively spared early (Hodges et al. 1992, *Brain*; Patterson, Nestor and Rogers 2007, *Nature Reviews Neuroscience*, hub account). | The semantic layer (facts, schemas) degrades while the event log is intact: summaries drift or are deleted, facts become generic. | Semantic-fidelity test: facts derived by consolidation are checked against their source episodes after k cycles; drift is measured. |
| Source amnesia | Remembering a fact but not where it came from (Schacter, Harbluk and McLachlan 1984). | Items without provenance; cannot tell user statement from model inference. | Every retrieved item must carry a source; items without one are refused by the compiler. |
| Transient global amnesia | Sudden, temporary anterograde amnesia that resolves within about 24 hours (Bartsch and Deuschl 2010, *Lancet Neurology*). | A temporary write outage; after recovery, the gap must be visible, not silently empty. | Outage-gap test: events during a writer outage are either backfilled from source or flagged as a gap. |
| Alzheimer's disease | The commonest memory disorder; pathology begins in entorhinal cortex and hippocampus (Braak and Braak 1991) with early episodic and anterograde loss, then spreads to semantic and other functions. | Gradual index rot: retrieval paths decay before content does. | Index-integrity check: every canonical item reachable through at least one retrieval channel; the unreachable fraction tracked over time. |
| PTSD (over-consolidation) | Intrusive, involuntary retrieval and overgeneralisation of strongly consolidated fear memories (Brewin et al. 2010, *Psychological Review*). | High-salience memories crowd every context: one alarming event (a failed payment) is retrieved into unrelated tasks. | Over-retrieval test: high-salience items appear only where relevant; their share of context per task type is measured. |
| Hyperthymesia (highly superior autobiographical memory) | Exceptional autobiographical recall (Parker, Cahill and McGaugh 2006; LePort et al. 2012); not associated with better performance on standard laboratory memory tasks. | Total recall is not intelligence: retaining everything does not improve decisions. | Ablation: compare full-retention retrieval against consolidated retrieval on task outcome, not recall volume. |

---

## Part H. What the owner's other carriers rest on

The owner's discovery families include mycelium and slime mould, genome and epigenome, bacteria and viruses,
haematopoiesis, endocrine, plant, swarm, ecological and multi-scale memory (#106 comment 5981828884). Short notes on
the science under the ones the design uses:

- **Slime mould** [SCI]: *Physarum polycephalum* forms networks comparable in efficiency and fault tolerance to the
  Tokyo rail network by reinforcing tubes with flow and pruning others (Tero et al. 2010, *Science*); it also leaves
  extracellular slime that it avoids, an externalised spatial memory (Reid et al. 2012, *PNAS*). Evidence moderate
  (a small number of studies). Engineering: reinforce association paths that carry useful retrievals and prune those that do
  not; this is ordinary edge weighting with decay. Breaks: flow is not truth; the owner already says so ("activation
  strength != epistemic strength").
- **CRISPR** [SCI]: bacteria store spacer sequences from past phage infections and use them to cut matching DNA
  (Barrangou et al. 2007, *Science*): heritable defensive memory. Engineering: a signature store of confirmed
  attacks (see Part F). Breaks: exact-match signatures are trivially evaded by paraphrase; use them as one layer.
- **Stigmergy** [SCI]: Grassé (1959) on termite construction; ant pheromone trails (Deneubourg, Goss and others);
  ant colony optimisation (Dorigo 1992) with evaporation. Engineering: shared traces in the environment (the
  repository, issue #80, state files) coordinate agents without direct messaging; evaporation = expiry. This is the
  Track 1 model: the repository *is* the shared trace. The owner's caution "trail reinforcement only after independent
  reward verification" (5981828884, item 11) is the important addition.
- **Epigenetics** [SCI]: heritable changes in gene expression without DNA sequence change (DNA methylation, histone
  modification); cell-type identity is maintained this way. Transgenerational epigenetic inheritance in mammals is
  contested. Engineering: the same canonical memory expressed differently per projection (business vs project vs
  agent) through overlays, without changing the canonical store: this matches the owner's "One memory architecture,
  many projections" (#106 comment 5982170811).
- **Endocrine hysteresis** [SCI, textbook physiology, e.g. Guyton and Hall on receptor down-regulation and HPA-axis
  feedback]: slow hormonal state and receptor down-regulation give history-dependent responses.
  Engineering: slowly changing tenant state (busy season, onboarding phase) that biases retrieval and consolidation
  budgets, with explicit reset; the owner's "decay/reset distinct from factual forgetting" (item 9).
- **Plant priming** [SCI]: plants exposed to a stress can respond faster to a later one ("stress memory", e.g.
  Bruce et al. 2007, *Plant Science*; Crisp et al. 2016, *Science Advances*), with recovery and reset. Engineering:
  short-lived priming state with an explicit reset. The owner's "acquisition vs maintenance vs expression vs
  extinction/reset" (item 10) is a good lifecycle vocabulary and the design uses it for procedures.

Families not used by the design at this stage (haematopoietic, ecological legacy, structural atlas, RMCC rank
algebra) remain in the owner's ledger as research candidates; this file does not dispose of them.

---

## Summary: what the science licenses

| Mechanism | Strength | Adopted in design | As |
|---|---|---|---|
| Working memory capacity and chunking | strong | yes | context budget, pointer-chunks |
| Episodic/semantic/procedural split | strong | yes | tiers T2/T3/T4 |
| Hippocampal indexing | moderate | yes | index entries point to authoritative records |
| Complementary learning systems | strong (theory) | yes | fast episodic, slow consolidated semantic |
| Replay, prioritised | strong / moderate | yes | consolidation by prediction error and outcome |
| Reconsolidation | contested (humans) | inverted | read-triggered re-verification, never silent rewrite |
| Synaptic homeostasis | moderate | yes | renormalise activation only |
| Forgetting as need-tracking | strong | yes | ACT-R activation for ranking; forgetting = access paths and copies |
| Spacing/testing | strong (humans) | partly | spaced re-verification; human review in later projections |
| Schemas and gist | strong | yes | verbatim/gist split |
| Pattern separation/completion | strong (theory) | yes | scoped dedup; entity-graph completion |
| Salience and prediction error | strong | yes | write gate and consolidation priority |
| Stability-plasticity | strong | yes | supersede, never overwrite; regenerate from source |
| Cerebellum/basal ganglia | strong | yes | procedure lifecycle with revaluation |
| Prospective memory | strong | yes | INTENTION records with trigger, owner, expiry |
| Metamemory | strong | yes | coverage, freshness, "not recorded" |
| Source monitoring | strong | yes | mandatory provenance |
| Reflexes and CPGs | strong | yes | deterministic guard layer; scheduled cycles |
| Homeostasis/allostasis | strong | yes | memory health set points |
| Myelination | moderate | yes | caches with invalidation |
| Pruning | strong | yes | association pruning with bounds |
| Glymphatic | contested | need only | copy-hygiene sweep (justified by product defects, not biology) |
| Immune memory | strong | yes | innate screens, adaptive signatures, tolerance tests |
| Clinical disorders | strong | yes | evaluation tests |
