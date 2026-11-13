# KeyFlowOS Finding Register — Causal Learning Supplement

Status: CANONICAL CONTINUATION OF `08P-FINDING-REGISTER-KNOWLEDGE-CONSUMPTION-SUPPLEMENT.md`

Implementation evidence baseline: `main@168732d0e2226e11ed033c14fbdf7b3ea5344a41`

Canonical sequence continues after F176. Allocation checked against `04A` + `04B`.

---

## F177 — Genome outcome learning propagates recommendation confidence by broad domain association rather than proven causal/action-pattern lineage

**Status:** VERIFIED CROSS-LAYER / CAUSAL-LEARNING FINDING

KeyFlowOS contains two active recommendation-learning paths that can change future recommendation confidence.

### Path 1 — GenomeMemory domain adjustment

`GenomeRecommendationService.applyMemoryConfidenceAdjustment()` loads up to 1000 GenomeMemory events and computes a domain-wide adjustment:

```text
SUCCESS → +0.05
FAILURE → -0.05
MIXED   → +0.02
```

Every candidate recommendation sharing `candidate.domain` receives that accumulated adjustment.

No observed filter binds the memory event to:

- the same recommendation pattern;
- the same action type/capability;
- the same KnowledgeRevision/evidence basis;
- the same causal mechanism;
- a LearningEligibility decision.

### Path 2 — observed recommendation outcome

`GenomeRecommendationOutcomeService.closeObservationWindow()` computes an impact score from changes in broad cross-domain health/readiness/confidence/risk snapshots and calls:

```text
GenomeOutcomeLearningService.applyOutcomeToConfidence(
  businessId,
  outcome.domain,
  outcome.actionType,
  impactScore,
)
```

But `GenomeOutcomeLearningService.applyOutcomeToConfidence()` does not use `actionType` in its update selection. It loads **all ACTIVE recommendations in the domain** and applies the same confidence delta to each.

Thus:

```text
one observed outcome
→ domain-level confidence movement
→ unrelated active recommendation patterns may gain/lose confidence
```

The observed before/after cross-domain snapshot can also contain changes caused by other actions, new facts, corrections, recovery, time or concurrent business events. The current impact calculation does not establish that the recommendation caused the delta.

This is distinct from F166:

- F166: process/control events can be mislabeled as success/failure learning evidence;
- F177: even outcome-coded/observed evidence is propagated without sufficiently specific causal/action-pattern attribution.

### Target law

```text
OBSERVED CORRELATION / DOMAIN CHANGE
!= CAUSAL EVIDENCE FOR EVERY PATTERN IN THE DOMAIN
```

Learning should bind to an explicit lineage such as:

```text
RecommendationPattern / hypothesis identity
+ recommendation revision
+ linked ActionEnvelope / Capability / Effect lineage
+ pre-observation baseline and observation window
+ OutcomeEvidence certainty
+ consequence/recovery completeness
+ confounder / contradiction state
+ attribution scope
→ LearningEligibility
→ bounded confidence update for the eligible pattern(s)
```

Where causality is weak, preserve the observation as contextual evidence rather than turning it into broad confidence change.

### Positive seams to preserve

- `GenomeRecommendationOutcome` pre/post observation fields;
- configurable outcome learning windows;
- `linkedActionType` / `linkedActionId` fields;
- time decay in `GenomeOutcomeLearningService.getLearnedImpact()`;
- explicit `impactScore` / `impactEvidence` fields.

These are useful building blocks; the target is to make their lineage load-bearing rather than replace them.

Affected kernels: K4, K8, K6, K7, K11.
Affected journeys: J2, J6, J16, J18, J23.

---

# Pool implication

J16/K4 now distinguishes three gates:

```text
EpistemicEligibility
  can this knowledge be used by this consumer?

OutcomeCertainty
  what actually happened / how certain are we?

LearningEligibility
  is that outcome valid evidence for this exact claimed lesson/pattern?
```

None of these grants authority.

No production implementation is authorized by this supplement.
