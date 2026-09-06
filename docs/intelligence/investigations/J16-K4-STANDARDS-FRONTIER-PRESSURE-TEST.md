# J16 / K4 — Standards, Frontier Research and KeyFlow Synthesis Pressure Test

Status: CANONICAL RESEARCH INPUT TO KF-REC-049
Last updated: 2026-09-06

Scope: Business Genome Evolution / Business Knowledge / correction / learning.
Production code: READ-ONLY.

This artifact applies the programme's anti-normalization method:

```text
H1 — FLOOR
What properties are already required by mature standards and production practice?

H2 — FRONTIER
What stronger properties are emerging in temporal knowledge, data lineage,
unlearning and adaptive-system research?

H3 — KEYFLOW SYNTHESIS
What stronger architecture can KeyFlowOS compose because it already has
Business Graph + Genome + Temporal history + Authority + Evidence + Recovery?
```

The goal is not to install or clone the referenced systems. Adopt properties, not products.

---

# 1. Research set

## W3C PROV family

Primary references:
- W3C PROV-DM / PROV-O / PROV Constraints / PROV Primer.

Properties used here:

- provenance is modeled through identified **Entities, Activities and Agents**;
- revisions are new entities related by derivation/revision, rather than mutable identity pretending nothing changed;
- generation, usage and **invalidation** delimit an entity's lifetime;
- responsibility/attribution/delegation can be represented explicitly;
- provenance can itself have provenance;
- alternate/specialized descriptions of the same underlying thing can coexist without collapsing identity;
- a usage/generation path alone is not sufficient to establish derivation: influence must actually be warranted.

Pressure on K4:

```text
KnowledgeSubject != KnowledgeRevision
KnowledgeRevision R2 should not overwrite R1's provenance identity
correction/invalidation is a first-class lifecycle event
lineage edges must represent real influence, not mere co-occurrence
```

## OpenLineage 1.53

Properties used here:

- Run identity is distinct from evolving Job definition;
- facets add typed/namespaced metadata without forcing one universal schema;
- current lineage facets can state exact dataset/job/field derivations;
- exact field-level lineage avoids false broad dependency edges.

Pressure on K4:

```text
source/event was nearby
!=
this exact knowledge field/recommendation/lesson was derived from it
```

K4 needs derivation specificity sufficient for correction and LearningEligibility, but should not force field-level lineage onto every low-risk fact.

## ISO/IEC 42001:2023 and ISO/IEC 42005:2025 direction

Properties used here:

- explicit AI governance and responsibilities;
- risk management;
- traceability, transparency and reliability;
- data governance and lifecycle controls;
- performance evaluation and monitoring;
- continual improvement;
- impact assessment for intended and unintended effects.

Pressure on K4:

Adaptive knowledge/learning is an AI lifecycle concern, not merely a scoring implementation detail. KeyFlow must be able to explain what data/knowledge influenced an adaptive decision and monitor resulting impacts.

## NIST AI RMF / Generative AI Profile

Properties used here:

- lifecycle trustworthiness and risk management;
- measurement/evaluation and ongoing monitoring;
- governance around generative/adaptive AI rather than trusting model confidence alone.

Pressure on K4:

Consumer-specific epistemic eligibility and LearningEligibility should be observable/evaluable controls, not hidden heuristics.

## Temporal / bitemporal systems and current research

Current database and research references distinguish:

```text
VALID / APPLICATION TIME
when the proposition was true in the modeled business reality

TRANSACTION / SYSTEM TIME
when the system learned/recorded this version
```

Recent bitemporal RDF work applies both dimensions to dynamic knowledge representations. PostgreSQL 19 documentation also now explicitly describes application time and system time and calls use of both bitemporal.

Pressure on K4:

`updatedAt` is not enough for retroactive correction, late evidence or future-effective knowledge.

A knowledge revision may need, depending on subject:

```text
validFrom / validTo        — business truth interval
recordedAt / supersededAt  — system knowledge interval
observedAt                 — evidence observation time
verifiedAt                 — verification decision time
```

Do not force all four into every table. Preserve the semantic distinction in the contract and materialize only where justified.

## Machine unlearning / verifiable forgetting

Recent surveys and 2025–2026 research distinguish:

- exact vs approximate unlearning;
- unlearning verification/certification;
- residual influence after nominal deletion;
- the difficulty of proving that deleted data no longer affects downstream models;
- risks to both removed and retained data after approximate unlearning.

Pressure on K4:

```text
SOURCE ROW DELETED
!=
SOURCE INFLUENCE REMOVED
```

KeyFlow's near-term problem is mostly deterministic derived knowledge rather than neural-weight unlearning, so full ML-unlearning machinery is not justified by current evidence. But the architectural property is valuable:

```text
correction / erasure
→ influence closure identified
→ affected derived states invalidated/recomputed/retracted
→ completion verified
```

If future KeyFlow models are fine-tuned or personalized on tenant data, the same lineage can become the deletion/unlearning manifest.

## 2026 knowledge-editing research

Recent work frames knowledge as entangled, context-sensitive and belief-dependent, and argues that editing a single apparent fact can have reasoning consequences beyond one isolated key/value.

Pressure on K4:

Do not assume a corrected field is semantically isolated merely because persistence uses one row. Derived recommendations, rules, memories and causal beliefs may need reevaluation.

---

# 2. H1 — production floor

The research/standards floor supports the following K4 requirements without claiming innovation.

## H1.1 Stable revision identity

```text
KnowledgeSubject
→ R1
→ R2 wasRevisionOf R1
→ R1 remains historical
```

A material update is not merely an in-place value mutation if provenance/verification/history matter.

## H1.2 Explicit provenance and responsibility

Each material revision must be able to answer as appropriate:

```text
what source/evidence produced it?
what activity/inference transformed it?
which human/system agent asserted or verified it?
what prior revision did it supersede?
```

## H1.3 First-class invalidation/supersession

A revision/evidence item can cease being active without requiring physical deletion of history.

```text
ACTIVE
→ SUPERSEDED | INVALIDATED | WITHDRAWN | EXPIRED | DISPUTED
```

Physical erasure and semantic invalidation remain separate.

## H1.4 Temporal truth is not one timestamp

K4 must preserve the distinction between:

```text
WHEN TRUE IN BUSINESS REALITY
vs
WHEN KEYFLOW LEARNED IT
```

where late/retroactive/future-effective information makes the distinction material.

## H1.5 Exact-enough derivation lineage

Derived facts/recommendations/learning must link to actual influencing sources. Avoid broad domain or event-bucket edges that create false causal lineage.

## H1.6 Lifecycle monitoring and auditability

Epistemic and learning controls should produce measurable evidence:

- conflicts;
- stale/expired knowledge usage;
- corrections pending propagation;
- recommendation basis revisions;
- learning updates and their qualifying outcomes;
- unresolved/failed invalidation propagation.

## H1.7 Erasure/correction completion is verified

Analogous to the strong existing tenant GDPR purge:

```text
DO NOT CLAIM ACTIVE KNOWLEDGE CORRECTED
UNTIL REQUIRED ACTIVE DERIVATIVES CONVERGE
OR ARE EXPLICITLY MARKED INCOMPLETE/STALE
```

---

# 3. H2 — frontier pressure

The following properties go beyond a minimal production floor.

## H2.1 Bitemporal epistemic graph

Instead of treating time as metadata on a mutable fact, represent high-value business knowledge as revisions with both:

```text
business validity interval
system-known interval
```

This enables queries such as:

```text
What did KeyFlow believe on June 1?
What does KeyFlow now believe was true on June 1?
Which actions were cleared using the then-current belief?
Which later correction invalidates future reliance but not historical evidence?
```

This is highly relevant to audit, recovery, attribution and retrospective learning.

## H2.2 Influence-aware correction closure

Borrow the *property* behind verifiable unlearning:

```text
Source correction / erasure
→ calculate derived influence closure
→ invalidate/recompute descendants
→ verify closure completion
```

For KeyFlow this can initially be deterministic and lineage-based rather than neural-model unlearning.

## H2.3 Provenance-sensitive confidence

Confidence should not be a free scalar divorced from why the system believes something.

Target direction:

```text
confidence
= derived assessment over provenance/evidence/verification/freshness/conflict
```

Consumers can still cache a score, but the score is explainable/recomputable.

## H2.4 Counterfactual learning audit

Before converting an observed outcome into durable learning, ask:

```text
Would this outcome plausibly have changed without the recommendation/action?
Which concurrent business changes confound attribution?
Did recovery or provider ambiguity alter the observed result?
```

Near-term implementation may be rule-based rather than causal ML.

## H2.5 Learning retraction

If the evidence basis of a prior lesson is later corrected or invalidated:

```text
lesson remains historical evidence
but its active learning weight can be retracted/recomputed
```

This is the knowledge analogue of financial reversal/recovery: do not delete history to correct current truth.

## H2.6 Provenance of provenance / confidence decisions

For high-impact facts and learning updates, the system can record not only evidence but the decision that classified evidence as sufficient:

```text
Evidence
→ KnowledgeVerification decision
→ consumer EpistemicEligibility decision
→ LearningEligibility decision
```

Each remains explainable and independently revisable.

---

# 4. H3 — KeyFlow-specific synthesis

No new canonical concept ID is allocated here. These are target properties inside K4/KF-REC-049 until boundaries stabilize.

## H3.1 Governed Epistemic Loop

KeyFlow can uniquely compose its existing kernels into:

```text
External / human / operational observation
        ↓
KnowledgeAssertion + Evidence
        ↓
KnowledgeRevision
  provenance
  valid/system time
  verification/conflict/freshness
        ↓
consumer-specific EpistemicEligibility
  prompt
  readiness/control
  recommendation/analytics
        ↓
K3 current Authority + Clearance remains separate
        ↓
ActionEnvelope / Effect / OutcomeEvidence
        ↓
K9 external truth + K11 recovery + K8 consequence completeness
        ↓
OutcomeCertainty
        ↓
LearningEligibility
  exact recommendation/action/effect lineage
  observation window
  confounders
  recovery state
        ↓
bounded adaptive confidence / candidate policy
        ↓
NO authority expansion
```

This is stronger than a conventional knowledge graph because authority, external effect certainty and recovery are part of the learning boundary.

## H3.2 Epistemic time travel for governed actions

A future target should make it possible to explain:

```text
ACTION A executed at T
→ using KnowledgeRevision set K(T)
→ under Authority/Clearance C(T)
→ with provider/effect result O(T...)
→ later correction R did/did-not invalidate future learning
```

This makes retrospective audit and learning repair possible without rewriting history.

## H3.3 Correction Clearance / correction impact tier

Correction itself should not automatically become a heavyweight governed action.

Candidate rule:

```text
low-risk profile correction
→ direct authorized edit

high-impact knowledge correction
  (pricing, financial constraint, legal/compliance, authority-driving fact,
   autonomy/readiness blocker, safety-critical operational truth)
→ current knowledge-change authority
→ impact-aware control / Clearance
→ revision + invalidation closure
```

This reuses K2/K3/J15 rather than inventing a Genome authority engine.

## H3.4 Verified Influence Closure

For material correction/erasure:

```text
CorrectionIntent
→ identify descendant materializations / recommendations / memories / learning weights
→ invalidate / recompute / retain-as-history
→ verify every required descendant is converged
→ emit CorrectionCompletionEvidence
```

This is a KeyFlow-specific synthesis of provenance lineage + unlearning verification + K8 evidence/recovery semantics.

## H3.5 Adaptive confidence budget

Learning should change confidence only inside an explicit bounded envelope:

```text
eligible evidence
× causal attribution quality
× temporal relevance
× recovery/outcome certainty
× sample/support strength
→ bounded confidence delta
```

A confidence update cannot increase authority, spend limits, risk tier or delegation scope.

## H3.6 Contradiction-preserving reasoning

Rather than forcing one value too early:

```text
credible conflicting revisions
→ KnowledgeConflict
→ consumer receives conflict-aware eligibility
→ deterministic mutation gates may fail closed
→ advisory reasoning may inspect both with provenance
→ reconciliation creates new resolved revision
```

This directly supports KEY's ability to reason about uncertainty without pretending uncertainty is truth.

---

# 5. Research conclusions for existing findings

## F161 / C111 — strengthened
W3C PROV revision semantics strongly support verification/provenance being tied to a particular revision/entity rather than silently following an overwritten value.

## F163 / C113 — strengthened
Multiple representations are acceptable only when their relationship is explicit (alternate/specialization/materialization) and provenance/ownership is clear. Silent co-authority is not.

## F175 / C125 — strengthened
AI governance standards require data quality/lifecycle controls; deterministic readiness needs an explicit epistemic acceptance predicate rather than row existence.

## F176 / C126 — strengthened
Uncertainty can be exposed to reasoning, but provenance/status must remain visible; storage/ranking alone is not a trust decision.

## F177 / C127 — materially strengthened
PROV's distinction that usage+generation is necessary but not sufficient for derivation aligns directly with the finding that domain co-occurrence is not causal evidence. OpenLineage's exact lineage property also argues against broad false dependency edges.

## F178 / C128 — materially strengthened
Bitemporal knowledge and unlearning verification both support the need for correction/invalidation to propagate through derived influence and for completion to be verifiable.

No existing J16 finding is rejected by this research tranche.

---

# 6. Architecture decisions from this pressure test

## ACCEPT / strengthen

1. `KnowledgeRevision` remains the core target unit for material epistemic change.
2. Verification, freshness, provenance and conflict belong to revisions/evidence, not fields forever.
3. Add semantic distinction between business-valid time and system-known time where material.
4. Consumer-specific EpistemicEligibility is accepted as a derived contract, not a new truth store.
5. LearningEligibility must require exact-enough recommendation/action/effect/outcome lineage.
6. Correction/withdrawal requires influence-aware descendant invalidation/recomputation.
7. Correction completion should be verifiable for material knowledge.
8. Historical truth and active truth must coexist without one masquerading as the other.
9. Learning retraction is a target property when its epistemic basis is invalidated.
10. Authority remains outside the learning loop.

## TARGET-CANDIDATE / pressure further

1. Bitemporal storage for all K4 material facts — semantic property accepted, physical breadth not yet justified.
2. `CorrectionCompletionEvidence` as explicit K8 evidence type — useful candidate; pressure in backward re-audit.
3. Adaptive confidence budget — promising, but exact formula/persistence should wait for broader learning analysis.
4. Counterfactual/confounder scoring — start rule-based; no causal-ML engine justified yet.
5. Provenance-of-provenance for every fact — likely tier by impact/risk, not universal heavy metadata.

## REJECT / not justified now

1. Replace PostgreSQL with a dedicated temporal/knowledge-graph database solely for K4.
2. Introduce a universal RDF/PROV store.
3. Introduce a generic ML unlearning platform before tenant-trained model influence exists.
4. Put all facts through heavyweight approval.
5. Treat embeddings/vector memory as canonical truth.
6. Let model confidence or historical outcomes mutate authority.

---

# 7. Resulting target equation

Working target synthesis:

```text
ACTIVE BUSINESS KNOWLEDGE
=
Resolved KnowledgeRevision
+ provenance/evidence
+ valid/system temporal semantics where material
+ verification/freshness/conflict state
+ explicit materialization state
```

Consumer eligibility:

```text
EpistemicEligibility(consumer, action/context, KnowledgeRevision)
```

Learning:

```text
LearningEligibility
=
OutcomeCertainty
+ exact-enough derivation/action/effect lineage
+ observation window
+ consequence/recovery completeness
+ contradiction/confounder state
+ valid epistemic basis
```

Correction:

```text
Correction / withdrawal / erasure
→ derivation influence closure
→ invalidate/recompute/retract active descendants
→ preserve legally/operationally required history
→ verify convergence
```

Authority law remains:

```text
LEARNING CAN CHANGE BELIEF/PRIORITIZATION
LEARNING CANNOT CREATE AUTHORITY
```

---

# 8. Next programme step

Backward re-audit:

```text
J1  founding knowledge / genesis
J25 human authority to assert/verify/correct
J2  action formation and prompt/current-knowledge inputs
J15 material knowledge-change control and historical evidence
J6  adaptive autonomy / standing policy
J14 external observations and provider truth
J23 temporal validity / long-running work
J18 outcome/recovery certainty
J19 correction/deletion/retention
```

Pressure each against:

- KnowledgeRevision;
- valid/system time distinction;
- EpistemicEligibility;
- LearningEligibility;
- derivation/influence closure;
- correction completion evidence;
- no authority expansion.

No production implementation is authorized by this research artifact.
