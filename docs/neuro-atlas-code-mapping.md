# KEYFLOWOS ↔ Neuroscience / Neuroendocrine Atlas Mapping

> **Scope:** This document maps the 45-section "Master Atlas of Neural, Endocrine and Homeostatic Control" provided by the user to concrete structures in the KEYFLOWOS NestJS monorepo. The goal is to surface which biological concepts already have working code analogues, which are partial, and which are missing or weak.
>
> **Methodology:** Read-only deep scan of `apps/server/src/modules/key-cortex`, `apps/server/src/modules/ai`, `apps/server/src/modules/key-autonomy`, and the relevant Prisma schema. File references use the paths and line numbers observed during the scan.
>
> **Caveat:** A few references in the original scan were speculative (e.g., `KeyCortexAttentionService` was flagged "if present" but does not exist in the repo). Those have been corrected below.

---

## 1. Neuron Structure & Function
- **Biological concept:** The basic signalling cell of the nervous system, receiving input via dendrites, integrating in the soma, and transmitting via axons.
- **Code equivalent:** `apps/server/src/modules/key-cortex/key-cortex-event-bus.service.ts:publish` (~line 97); `KeyOrganAdapter` interface `apps/server/src/modules/key-cortex/organs/key-organ-adapter.interface.ts:21`.
- **How it maps:** The event bus is the axon/dendrite network; `KeyOrganAdapter` implementations are neuron-like endpoints that receive (sensory/tool call) and emit (event publish) signals per business.
- **Strength:** Strong
- **Recommendation:** —

## 2. Glial Cells (Support & Insulation)
- **Biological concept:** Non-neuronal cells that support, insulate, and maintain the neural environment.
- **Code equivalent:** `apps/server/src/modules/key-cortex/key-cortex-context-assembly.service.ts`; `KeyCortexContextV2Service` `apps/server/src/modules/key-cortex/key-cortex-context-v2.service.ts:getFullContext`.
- **How it maps:** Context-assembly services are the glial scaffold: they fetch, filter, and package heterogeneous business data so reasoning neurons can operate efficiently.
- **Strength:** Partial
- **Recommendation:** Cache context shards per business to reduce repeated assembly cost.

## 3. Action Potentials / Ion Channels
- **Biological concept:** All-or-nothing electrical impulses propagated by ion-channel dynamics.
- **Code equivalent:** `apps/server/src/modules/key-cortex/key-cortex-event-bus.service.ts:emit` (~line 149); `CognitiveEvent` model `packages/db/prisma/schema.prisma`.
- **How it maps:** Events are discrete pulses; the bus propagates them to subscribers with tenant-scoped routing, analogous to depolarization waves.
- **Strength:** Partial
- **Recommendation:** Add backpressure / circuit-breaker when event rate spikes.

## 4. Synaptic Transmission
- **Biological concept:** Chemical communication across the synaptic cleft via neurotransmitters.
- **Code equivalent:** `apps/server/src/modules/key-cortex/key-cortex-endocrine.service.ts:releaseHormone` (~line 80); `KeyCortexEventBusService` cognitive-event mirroring.
- **How it maps:** Hormones in the endocrine service act like neurotransmitters modulating system arousal (cortisol/dopamine/humility/malaise).
- **Strength:** Strong
- **Recommendation:** —

## 5. Neuroplasticity (LTP / LTD)
- **Biological concept:** Activity-dependent strengthening or weakening of synaptic connections.
- **Code equivalent:** `apps/server/src/modules/key-cortex/key-cortex-learning.service.ts` (~line 100); `KeyCortexMemory` model `packages/db/prisma/schema.prisma`; `confidence`/`confidenceDelta` fields.
- **How it maps:** Learning updates confidence weights and records outcomes, adjusting future behavior based on feedback.
- **Strength:** Partial
- **Recommendation:** Close the loop so learning output automatically adjusts tool-selection weights.

## 6. Cerebral Cortex
- **Biological concept:** Outer layered sheet of the brain responsible for integration, association, and higher-order processing.
- **Code equivalent:** `apps/server/src/modules/key-cortex/key-cortex-reasoning-engine.service.ts` (~line 100); `apps/server/src/modules/key-cortex/key-cortex-consciousness.service.ts:processConsciously` (~line 238).
- **How it maps:** The reasoning engine and consciousness pipeline are the layered cortical sheet where multi-modal inputs converge.
- **Strength:** Strong
- **Recommendation:** —

## 7. Prefrontal Cortex (Executive Function)
- **Biological concept:** Frontal region governing planning, decision-making, and impulse control.
- **Code equivalent:** `apps/server/src/modules/key-cortex/key-cortex-planner.service.ts:generatePlan` (~line 120); `apps/server/src/modules/key-autonomy/autonomy-orchestrator.service.ts`.
- **How it maps:** Planner decomposes objectives into steps; autonomy orchestrator enforces executive veto/approval.
- **Strength:** Strong
- **Recommendation:** —

## 8. Motor Cortex
- **Biological concept:** Cortical region planning and executing voluntary movement.
- **Code equivalent:** `apps/server/src/modules/key-cortex/key-cortex-executor.service.ts:execute` (~line 100); `apps/server/src/modules/ai/action-dispatcher.service.ts`.
- **How it maps:** The executor dispatches approved actions to the tool registry / action dispatcher, initiating business operations.
- **Strength:** Strong
- **Recommendation:** —

## 9. Somatosensory Cortex
- **Biological concept:** Cortical region processing touch, proprioception, and body state.
- **Code equivalent:** `apps/server/src/modules/key-cortex/key-cortex-interoception.service.ts:peekBody` (~line 80); `KeyCortexHomeostasisService` body-integrity metrics.
- **How it maps:** Interoception polls organ adapters for business health, analogous to body-state sensing.
- **Strength:** Strong
- **Recommendation:** —

## 10. Visual Cortex
- **Biological concept:** Cortical processing of visual input.
- **Code equivalent:** Document intelligence / media asset pipelines; no dedicated cortical visual module found.
- **How it maps:** Indirect: document parsing and screenshot/media assets (`MediaAsset` model) handle visual input.
- **Strength:** Weak
- **Recommendation:** Add a document-intelligence organ adapter that surfaces parsed visual content to the cortex bus.

## 11. Auditory Cortex
- **Biological concept:** Cortical processing of sound and speech.
- **Code equivalent:** `apps/server/src/modules/voice-agent/` (LiveKit YAML); no direct cortex auditory adapter found.
- **How it maps:** Voice agent exists but is not yet wired as a first-class sensory organ into the key-cortex bus.
- **Strength:** Weak
- **Recommendation:** Build a `voice-organ-adapter` that transcribes and emits `speech.heard` events.

## 12. Hippocampus / Memory Consolidation
- **Biological concept:** Medial temporal structure converting short-term experience into long-term memory.
- **Code equivalent:** `apps/server/src/modules/key-cortex/key-cortex-memory.service.ts` (~line 50); `UnifiedMemoryRetrievalService` (~line 100); `UnifiedMemoryWriterService`; `TemporalFlowMemory` model.
- **How it maps:** Explicit memory store with recency/decay, semantic embeddings, and temporal-flow summaries.
- **Strength:** Strong
- **Recommendation:** —

## 13. Amygdala / Emotion
- **Biological concept:** Limbic structure generating affective responses and threat/reward salience.
- **Code equivalent:** `apps/server/src/modules/key-cortex/key-cortex-emotion.service.ts:detectEmotion` (~line 50); `KeyCortexMoodDetectionService` `apps/server/src/modules/key-cortex/key-cortex-mood-detection.service.ts:14`.
- **How it maps:** Emotion/mood detection scores user messages and adapts tone/persona.
- **Strength:** Partial
- **Recommendation:** Wire detected emotion into endocrine hormone release (e.g., malaise on frustration).

## 14. Basal Ganglia (Action Selection)
- **Biological concept:** Subcortical nuclei selecting and gating motor/cognitive actions.
- **Code equivalent:** `apps/server/src/modules/key-cortex/key-cortex-tool-registry.service.ts`; `apps/server/src/modules/key-cortex/cognitive-triage.service.ts:classify` (~line 100); `AutonomyOrchestratorService`.
- **How it maps:** Triage classifies effort level; autonomy gate selects/approves actions; tool registry provides the action repertoire.
- **Strength:** Strong
- **Recommendation:** —

## 15. Cerebellum (Motor Learning / Error Correction)
- **Biological concept:** Coordinates movement and learns from prediction errors.
- **Code equivalent:** `apps/server/src/modules/key-cortex/key-cortex-compensation.service.ts:compensate` (~line 50); `KeyCortexReflectionService` outcome tracking.
- **How it maps:** Compensation rolls back failed actions; reflection updates confidence from outcome deltas.
- **Strength:** Partial
- **Recommendation:** Automate compensation invocation in the saga executor on rollback.

## 16. Brainstem / Medulla (Vital Autonomic Control)
- **Biological concept:** Relays autonomic signals and maintains vital functions.
- **Code equivalent:** `apps/server/src/modules/key-cortex/key-cortex-homeostasis.service.ts:controlLoop` (~line 80); `BusinessHealthSnapshot` model.
- **How it maps:** Scheduled homeostasis loop measures integrity and emits corrective hormones/triggers.
- **Strength:** Strong
- **Recommendation:** —

## 17. Thalamus (Sensory Relay / Gating)
- **Biological concept:** Relay and gatekeeper for sensory information to the cortex.
- **Code equivalent:** `apps/server/src/modules/key-cortex/cognitive-triage.service.ts` (~line 100); `FlowOrchestratorService` routing.
- **How it maps:** Triage gates whether a query is reflex/standard/deliberate and routes to the appropriate cognitive layer.
- **Strength:** Strong
- **Recommendation:** —

## 18. Hypothalamus (Homeostatic Set Points)
- **Biological concept:** Regulates hunger, thirst, temperature, and circadian set points.
- **Code equivalent:** `apps/server/src/modules/key-cortex/key-cortex-endocrine.service.ts` (~line 60); `KeyCortexHomeostasisService` (~line 80).
- **How it maps:** Endocrine hormones encode system set-point deviations; homeostasis service measures and responds.
- **Strength:** Strong
- **Recommendation:** —

## 19. Pituitary Gland (Master Endocrine Release)
- **Biological concept:** Releases hormones under hypothalamic control.
- **Code equivalent:** `apps/server/src/modules/key-cortex/key-cortex-endocrine.service.ts:getState` / persistence (~line 100); `CognitiveTriageService.releaseFromBody`.
- **How it maps:** Endocrine service persists and releases hormones that modulate downstream organs.
- **Strength:** Strong
- **Recommendation:** —

## 20. Pineal Gland / Circadian Pacemaker
- **Biological concept:** Regulates sleep-wake and circadian rhythms via melatonin.
- **Code equivalent:** `apps/server/src/modules/key-cortex/key-cortex-reflection.service.ts` scheduled dream/synthesis/maintenance (`@Cron` lines 696, 721).
- **How it maps:** Cron-scheduled reflection/digest cycles provide circadian-like business processing.
- **Strength:** Partial
- **Recommendation:** Add a dedicated circadian scheduler keyed to business timezone.

## 21. HPA Axis (Stress Response)
- **Biological concept:** Hypothalamus-pituitary-adrenal cascade releasing cortisol under stress.
- **Code equivalent:** `apps/server/src/modules/key-cortex/key-cortex-endocrine.service.ts` cortisol hormone; `KeyCortexHomeostasisService` integrity penalties; `InvoiceOverdueWatcherService`.
- **How it maps:** Watchers detect stressors (overdue invoices, no-shows) and the endocrine system raises cortisol/malaise.
- **Strength:** Strong
- **Recommendation:** —

## 22. HPT Axis (Metabolic Regulation)
- **Biological concept:** Thyroid hormone axis regulating metabolic rate.
- **Code equivalent:** `apps/server/src/modules/key-cortex/key-bi-engine.service.ts:computeMentalModel` (~line 143); `BusinessHealthSnapshot` area scoring.
- **How it maps:** BI engine computes business metabolic health (revenue, tasks, deals) and status.
- **Strength:** Partial
- **Recommendation:** Add explicit "metabolic rate" metric (actions processed per hour).

## 23. HPG Axis (Reproductive / Growth Cycles)
- **Biological concept:** Hypothalamus-pituitary-gonadal hormonal cycles.
- **Code equivalent:** `BusinessGenome` stage transitions `packages/db/prisma/schema.prisma`; `GenomeEvolutionProposal` model.
- **How it maps:** Genome stage lifecycle (seed → growth → mature) and evolution proposals mirror developmental cycles.
- **Strength:** Partial
- **Recommendation:** —

## 24. GH Axis / Growth Hormone
- **Biological concept:** Promotes tissue growth and repair.
- **Code equivalent:** `apps/server/src/modules/key-cortex/key-cortex-learning.service.ts`; `KeyCortexReflectionService.synthesis` (~line 394).
- **How it maps:** Learning and synthesis consolidate successful patterns to grow the business model.
- **Strength:** Partial
- **Recommendation:** Persist DNA evolution proposals to `GenomeEvolutionProposal` table and approve workflow.

## 25. Prolactin Axis (Nurturing / Lactation)
- **Biological concept:** Hormone supporting nurturing and parental care.
- **Code equivalent:** `apps/server/src/modules/key-cortex/key-cortex-suggestion.service.ts:generateSuggestions` (~line 25); `KeyCortexDigestService` morning briefs.
- **How it maps:** Gentle follow-up suggestions and daily nurturing briefs keep the user engaged.
- **Strength:** Partial
- **Recommendation:** —

## 26. Oxytocin / Vasopressin (Social Bonding & Trust)
- **Biological concept:** Peptide hormones modulating trust, bonding, and social behavior.
- **Code equivalent:** `apps/server/src/modules/key-cortex/key-cortex-ethics.service.ts:evaluateAction` (~line 114); `ConsentRecord` model.
- **How it maps:** Ethics framework and consent records enforce trustworthy, privacy-preserving behavior.
- **Strength:** Strong
- **Recommendation:** —

## 27. Autonomic Nervous System
- **Biological concept:** Involuntary control of organs, split into sympathetic and parasympathetic branches.
- **Code equivalent:** `apps/server/src/modules/key-cortex/key-cortex-organ-registrar.service.ts`; `KeyOrganAdapter` interface; organ adapters in `apps/server/src/modules/key-cortex/organs/`.
- **How it maps:** Organ adapters provide autonomous, business-wide connections to each module (inbox, genome, connector, temporal flow, storelink).
- **Strength:** Strong
- **Recommendation:** —

## 28. Sympathetic Nervous System (Fight or Flight)
- **Biological concept:** Arousal branch mobilizing energy under threat.
- **Code equivalent:** `apps/server/src/modules/key-cortex/watchers/invoice-overdue-watcher.service.ts`; `KeyProactiveEngineService:evaluateProactiveActions` (~line 138).
- **How it maps:** Watchers and proactive engine trigger high-priority alerts and genome signals.
- **Strength:** Strong
- **Recommendation:** —

## 29. Parasympathetic Nervous System (Rest & Digest)
- **Biological concept:** Calming branch promoting maintenance and recovery.
- **Code equivalent:** `apps/server/src/modules/key-cortex/key-cortex-reflection.service.ts:runMaintenance` (~line 483); `KeyCortexReflectionService.scheduledDream`.
- **How it maps:** Maintenance/dream/synthesis cron jobs perform background housekeeping and consolidation.
- **Strength:** Partial
- **Recommendation:** —

## 30. Enteric Nervous System (Gut Brain)
- **Biological concept:** Semi-autonomous neural network of the digestive tract.
- **Code equivalent:** Not explicitly implemented; closest is commerce/bookings/content pipeline internal logic.
- **How it maps:** No direct enteric analogue; business-module internal workflows are autonomous but not centrally modelled.
- **Strength:** Missing
- **Recommendation:** Add per-module "local nervous system" health endpoints surfaced via organ adapters.

## 31. Neuroendocrine Integration
- **Biological concept:** Nervous and endocrine systems jointly regulate physiology.
- **Code equivalent:** `apps/server/src/modules/key-cortex/key-cortex-homeostasis.service.ts` + `key-cortex-endocrine.service.ts` interaction; `CognitiveTriageService.releaseFromBody`.
- **How it maps:** Homeostasis measures body state and releases hormones; triage writes to endocrine state.
- **Strength:** Strong
- **Recommendation:** —

## 32. Circadian Rhythms
- **Biological concept:** ~24-hour biological cycles.
- **Code equivalent:** `apps/server/src/modules/key-cortex/key-cortex-digest.service.ts` daily/weekly digest; `KeyProactiveEngineService` 8 AM / 6 PM / 3 AM cron schedules.
- **How it maps:** Scheduled briefs and reflection cycles align with business rhythms.
- **Strength:** Partial
- **Recommendation:** Make scheduling timezone-aware per business.

## 33. Stress Response
- **Biological concept:** Coordinated physiological reaction to perceived threat.
- **Code equivalent:** `apps/server/src/modules/key-cortex/key-cortex-endocrine.service.ts` cortisol/humility/malaise; `KeyCortexHomeostasisService` integrity metrics.
- **How it maps:** Hormonal signals reflect operational stress; homeostasis raises alerts.
- **Strength:** Strong
- **Recommendation:** —

## 34. Reward / Dopamine System
- **Biological concept:** Dopaminergic pathways reinforcing beneficial behavior.
- **Code equivalent:** `apps/server/src/modules/key-cortex/key-cortex-endocrine.service.ts` dopamine hormone; `KeyCortexLearningService` positive-outcome reinforcement.
- **How it maps:** Dopamine released on successful actions; learning weights positive outcomes.
- **Strength:** Partial
- **Recommendation:** Tie dopamine release to explicit user-positive feedback events.

## 35. Serotonin System (Mood Regulation)
- **Biological concept:** Serotonergic modulation of mood, sleep, and appetite.
- **Code equivalent:** `apps/server/src/modules/key-cortex/key-cortex-mood-detection.service.ts:detectMood` (~line 14); `CortexSession.mood` field.
- **How it maps:** Mood detection classifies user queries and session mood.
- **Strength:** Partial
- **Recommendation:** Use mood state to modulate endocrine baseline and response tone.

## 36. GABA / Glutamate (Inhibition / Excitation)
- **Biological concept:** Primary inhibitory and excitatory neurotransmitters.
- **Code equivalent:** `apps/server/src/modules/key-cortex/key-cortex-ethics.service.ts:evaluateAction` veto (~line 114); `AutonomyOrchestratorService` allow/block.
- **How it maps:** Ethics/autonomy provide excitatory (approve) and inhibitory (deny) gating of actions.
- **Strength:** Strong
- **Recommendation:** —

## 37. Acetylcholine (Attention / Learning)
- **Biological concept:** Neuromodulator of attention, arousal, and memory encoding.
- **Code equivalent:** `apps/server/src/modules/key-cortex/key-cortex-awareness.service.ts`; `CognitiveTriageService` effort grading. (`KeyCortexAttentionService` does **not** exist in the repo.)
- **How it maps:** Awareness dashboard and triage allocate attention to weak signals and urgent items.
- **Strength:** Partial
- **Recommendation:** Make attention a first-class resource budget in the consciousness pipeline.

## 38. Norepinephrine (Arousal / Alertness)
- **Biological concept:** Modulates vigilance and arousal.
- **Code equivalent:** `apps/server/src/modules/key-cortex/key-cortex-proactive-engine.service.ts:evaluateProactiveActions` (~line 138); `AgentTrigger` model.
- **How it maps:** Proactive engine and triggers raise system alertness every 15 minutes.
- **Strength:** Strong
- **Recommendation:** —

## 39. Endocrine Pancreas (Glucose Regulation)
- **Biological concept:** Insulin/glucagon regulation of blood glucose.
- **Code equivalent:** `apps/server/src/modules/key-cortex/key-bi-engine.service.ts` revenue/cashflow metrics; `GenomeFinancialMetric` model.
- **How it maps:** Financial metrics track cash inflow/outflow and maintain liquidity set points.
- **Strength:** Partial
- **Recommendation:** Add explicit cash-flow target and corrective action suggestions.

## 40. Adrenal Medulla / Cortex (Catecholamines / Corticosteroids)
- **Biological concept:** Adrenal glands release epinephrine and cortisol.
- **Code equivalent:** `apps/server/src/modules/key-cortex/key-cortex-endocrine.service.ts` cortisol + dopamine; `KeyCortexHomeostasisService`.
- **How it maps:** Endocrine hormones encode arousal and stress; homeostasis triggers them.
- **Strength:** Strong
- **Recommendation:** —

## 41. Thyroid Axis (Metabolic Rate)
- **Biological concept:** Thyroid hormones set baseline metabolic rate.
- **Code equivalent:** `AutopilotSettings` model; `BusinessAutonomyProfile` model.
- **How it maps:** Autonomy settings set the baseline action rate and tier limits for the business.
- **Strength:** Partial
- **Recommendation:** Link autonomy tier to observed business velocity (actions/day).

## 42. Gonadal Axis (Reproduction / Differentiation)
- **Biological concept:** Sex hormones driving reproductive development.
- **Code equivalent:** `BusinessBlueprint` identity/brand/customer-model sections; `BusinessGenome` dnaScores.
- **How it maps:** Blueprint and genome capture differentiated business identity and maturity.
- **Strength:** Partial
- **Recommendation:** —

## 43. Neuroimmune Interaction
- **Biological concept:** Bidirectional signaling between nervous and immune systems.
- **Code equivalent:** `SentimentWatcherService`; no dedicated neuroimmune module.
- **How it maps:** Sentiment watcher detects social/communication "infection" signals; otherwise absent.
- **Strength:** Weak
- **Recommendation:** Add a system-health watcher that flags data-integrity anomalies and schema drift.

## 44. Blood-Brain Barrier
- **Biological concept:** Selective barrier protecting the brain from blood-borne agents.
- **Code equivalent:** `apps/server/src/modules/key-cortex/key-cortex-safe-database.service.ts:safeQuery` (~line 103); tenant scoping in Prisma queries.
- **How it maps:** Safe DB wrapper and tenant isolation protect business data from cross-tenant leakage.
- **Strength:** Strong
- **Recommendation:** —

## 45. Neurodevelopment / Neurogenesis
- **Biological concept:** Birth and maturation of neurons and circuits.
- **Code equivalent:** `apps/server/src/modules/key-cortex/knowledge-ingestion.service.ts:ingestText` (~line 30); `KnowledgeSource` model; `GenomeEvolutionProposal`.
- **How it maps:** Knowledge ingestion adds new facts; evolution proposals generate new DNA sections—analogous to neurogenesis and circuit formation.
- **Strength:** Partial
- **Recommendation:** Auto-apply low-risk DNA evolution proposals after reflection.

---

# Top 10 Architectural Improvements

1. **Close the live-chat memory loop**
   - **Rationale:** `UnifiedMemoryRetrievalService` is not wired into the live chat path (`FlowOrchestratorService`), so KEY forgets context mid-conversation.
   - **Affected files:** `apps/server/src/modules/ai/flow-orchestrator.service.ts`, `apps/server/src/modules/key-cortex/unified-memory-retrieval.service.ts`
   - **Size:** Small

2. **Give `processConsciously` an efferent executor**
   - **Rationale:** The 11-step consciousness pipeline has no path to actually act; it only logs/reflects. Connect it to `KeyCortexExecutorService`.
   - **Affected files:** `apps/server/src/modules/key-cortex/key-cortex-consciousness.service.ts`, `apps/server/src/modules/key-cortex/key-cortex-executor.service.ts`
   - **Size:** Medium

3. **Wire endocrine release to all live paths**
   - **Rationale:** Endocrine writes recently arrived via `CognitiveTriageService.releaseFromBody`; other paths still bypass hormonal state.
   - **Affected files:** `apps/server/src/modules/key-cortex/key-cortex-reasoning.service.ts`, `apps/server/src/modules/ai/flow-orchestrator.service.ts`, `apps/server/src/modules/key-cortex/key-cortex-endocrine.service.ts`
   - **Size:** Medium

4. **Persist watcher signals instead of dropping them**
   - **Rationale:** Watchers historically computed signals and discarded them; recent fixes help but coverage is uneven.
   - **Affected files:** `apps/server/src/modules/key-cortex/watchers/*.service.ts`, `KeyCortexMemory` writes
   - **Size:** Small

5. **Implement missing reflection persistence**
   - **Rationale:** `KeyCortexReflectionService` notes that hypothesis/insight persistence is not implemented (model absent).
   - **Affected files:** Add Prisma model + `key-cortex-reflection.service.ts`
   - **Size:** Medium

6. **Add dedicated visual and auditory organ adapters**
   - **Rationale:** Vision and audition are only indirect; document intelligence and voice agent should be first-class organs.
   - **Affected files:** New `apps/server/src/modules/key-cortex/organs/document-intelligence-adapter.service.ts`, `voice-adapter.service.ts`
   - **Size:** Large

7. **Make compensation automatic in sagas**
   - **Rationale:** `KeyCortexCompensationService` exists but must be explicitly invoked; sagas should auto-compensate on failure.
   - **Affected files:** `apps/server/src/modules/key-cortex/key-cortex-saga.service.ts`, `key-cortex-compensation.service.ts`
   - **Size:** Medium

8. **Add a circadian/timezone-aware scheduler**
   - **Rationale:** All cron schedules run in server time, not business timezone.
   - **Affected files:** New scheduler service, `KeyProactiveEngineService`, `KeyCortexDigestService`
   - **Size:** Medium

9. **Unify role/triage/autonomy gating**
   - **Rationale:** `RoleEngineService`, `CognitiveTriageService`, and `AutonomyOrchestratorService` overlap in classifying intent and risk; unify into a single policy layer.
   - **Affected files:** `apps/server/src/modules/ai/role-engine.service.ts`, `apps/server/src/modules/key-cortex/cognitive-triage.service.ts`, `apps/server/src/modules/key-autonomy/autonomy-orchestrator.service.ts`
   - **Size:** Large

10. **Operationalize eval harness**
    - **Rationale:** `EvalHarnessService` exists but is not integrated into CI; it currently only runs built-in suites when called.
    - **Affected files:** `apps/server/src/modules/key-cortex/eval-harness.service.ts`, test/CI config
    - **Size:** Small

---

# Glossary: Biological → Code Analogies

| Biological Term | Code Equivalent |
|-----------------|-----------------|
| Neuron | `KeyOrganAdapter` + event bus publisher/subscriber |
| Axon | `KeyCortexEventBusService.emit` |
| Synapse | Endocrine release / event dispatch |
| Neurotransmitter | Hormone (`cortisol`, `dopamine`, `humility`, `malaise`) |
| Cortex | `KeyCortexReasoningEngineService` + `KeyCortexConsciousnessService` |
| Prefrontal cortex | `KeyCortexPlannerService` + `AutonomyOrchestratorService` |
| Motor cortex | `KeyCortexExecutorService` + `ActionDispatcherService` |
| Somatosensory cortex | `KeyCortexInteroceptionService` |
| Hippocampus | `KeyCortexMemoryService`, `UnifiedMemoryRetrievalService`, `TemporalFlowMemory` |
| Amygdala | `KeyCortexEmotionService`, `KeyCortexMoodDetectionService` |
| Basal ganglia | `CognitiveTriageService`, `KeyCortexToolRegistryService` |
| Cerebellum | `KeyCortexCompensationService` |
| Brainstem / medulla | `KeyCortexHomeostasisService` |
| Thalamus | `CognitiveTriageService` |
| Hypothalamus | `KeyCortexEndocrineService` + homeostatic set points |
| Pituitary | `KeyCortexEndocrineService` persistence/release |
| HPA axis | Watchers → endocrine cortisol → homeostasis |
| Autonomic nervous system | `KeyCortexOrganRegistrarService` + organ adapters |
| Sympathetic | Watchers + proactive engine |
| Parasympathetic | Reflection / maintenance / dream cron jobs |
| Blood-brain barrier | `KeyCortexSafeDatabaseService` tenant scoping |
| Circadian rhythm | Cron schedules in proactive/digest/reflection services |
| Neuroplasticity | `KeyCortexLearningService`, confidence deltas |
| Neurogenesis | `KnowledgeIngestionService`, `GenomeEvolutionProposal` |
| Dopamine | Positive-outcome hormone release + learning reinforcement |
| Serotonin | Mood state + response tone modulation |
| GABA / glutamate | Ethics/autonomy excitatory/inhibitory gating |
| Acetylcholine | Attention allocation via awareness/triage |
| Norepinephrine | Proactive alert triggers |

---

## Confidence & Limitations

- **Source atlas:** User-provided 45-section "Master Atlas of Neural, Endocrine and Homeostatic Control". The mapping above is a best-effort interpretation; some biological concepts are stretched by design because the codebase is a business OS, not an organism.
- **Read-only scope:** No files were modified; line numbers reflect the state of the repo at scan time.
- **Known gaps:** Visual/auditory cortex equivalents are weak; enteric nervous system is missing; reflection hypothesis persistence is partial; a dedicated attention service does not exist.
- **Next step:** The top-10 improvement list can be turned into an implementation plan or individual tickets. Several items overlap with the separate "starved read paths" work (e.g., close live-chat memory loop, persist watcher signals).
