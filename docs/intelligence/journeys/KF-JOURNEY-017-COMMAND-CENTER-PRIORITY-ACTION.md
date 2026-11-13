# KF-JOURNEY-017 — Command Center → Priority → Action

Status: ACTIVE MICROSCOPIC RECONSTRUCTION — INITIAL ENTRY/AGGREGATION TRACE

Current repository head: `main@9bff44f8f9a5195e06af3669ccb1a8f4c47ccd76`
Code-bearing forensic baseline remains: `d7c5b86cfa276d75ffa42d5f1707c43704dc9f21`
Prior evidence head `168732d0...` → current main delta: AUDIT / ARCHITECTURE-JOURNAL ONLY; no code-bearing files in compare.
Production implementation: READ-ONLY.

## A. Journey definition

J17 asks:

> How does KeyFlowOS turn heterogeneous business state into a trustworthy, prioritized operational view for the user, and how does a displayed priority/recommended action transition into governed execution without the Command Center becoming a parallel source of truth or authority?

End-to-end shape:

```text
Business / external / temporal / knowledge / governance / recovery state
→ source-specific analysis/projections
→ Command Center aggregation
→ normalization into CommandCenterItem
→ deduplication / ranking
→ top priorities / briefing / pulse / recommended actions
→ user review / navigation / approval / execute intent
→ canonical governed-action surface
→ current Clearance / execution
→ OutcomeEvidence
→ later priority/knowledge update
```

J17 is therefore a control-surface journey, not merely a dashboard journey.

## B. Why J17 is high-leverage

The current `BusinessCommandCenterService` imports and aggregates at least:

- BusinessIntelligenceService;
- KeyExecutiveModeService;
- KeyActionProposalService;
- TemporalFlowService;
- GenomeEvolutionService;
- BlueprintService;
- BusinessAssetsService;
- ConstitutionVersionService;
- GenomeScoringService;
- GenomeModuleReadinessService;
- GenomeSignalService;
- GenomeRecommendationService;
- CommandCenterKeyGenomeBridgeService.

That places J17 directly at the convergence of:

```text
K3 Governance / authority
K4 Business Knowledge
K5 capability/readiness
K7 temporal/event/workflow state
K8 evidence/outcome
K9 external truth indirectly
K11 recovery/operator state indirectly
```

It is also a highly visible product surface: the snapshot builds health, pulse, briefing, governance counts, top priorities and recommended actions.

## C. Current aggregation topology

`BusinessCommandCenterService.snapshot(businessId)` executes a broad parallel fan-in:

```text
executive brief
executive-mode briefs
pending KEY action proposals
approved KEY action proposals
TemporalFlow analysis
genome evolution proposals
Blueprint/Genome integrity
business assets
latest Constitution
Constitution staleness
        ↓
Genome fact scoring
module readiness
cross-domain Genome bridge
        ↓
map each source into CommandCenterItem[]
        ↓
rankItems()
        ↓
health / pulse / briefing / governance
        ↓
topPriorities = first 7
recommendedActions = actions from first 5 ranked items
```

This is not yet a canonical CommandItem runtime in the inspected code path; it is an assembled snapshot/projection over multiple source systems.

## D. Failure semantics of aggregation

Most source calls are wrapped in `safeResolve()`:

```text
source read fails
→ warn log
→ return benign fallback / empty list / zeroed object
→ continue building snapshot
```

Examples include:

```text
pending approvals failure     → []
approved proposals failure    → []
temporal analysis failure     → empty urgent/opportunity/risk sets
genome failure                → zeroed Genome result
assets failure                → []
latest Constitution failure   → null
cross-domain/ranking failures → null/empty inside bridge
```

No first-pass evidence was observed in the returned snapshot of a global source-health/degraded-completeness contract explaining that a source failed rather than had no records.

Candidate semantic issue to pressure before any new ID:

```text
SOURCE UNAVAILABLE
!= SOURCE HAS NOTHING IMPORTANT
```

This is especially material when the user sees “no urgent actions”, no approvals, or apparently healthy status derived from fallback absence.

## E. Current normalization / ranking

Source-specific records are normalized into `CommandCenterItem` with fields such as:

```text
id
type
priority
title
summary
evidence
source/sourceId
href
actions
createdAt
```

Ranking is currently:

```text
1. priorityRank(CRITICAL > HIGH > MEDIUM > LOW)
2. static TYPE_WEIGHT
3. createdAt recency
```

Type weights include, for example:

```text
KEY_APPROVAL          100
KEY_APPROVED           95
TEMPORAL_URGENT        90
MODULE_READINESS       85
MISSING_FACT           83
KEY_GENOME_GAP         82
RISK                   80
GENOME_RECOMMENDATION  78
ASSET_RISK             75
GENOME_PROPOSAL        65
GENOME_SIGNAL          60
CONSTITUTION           60
EXECUTIVE_MODE         45
OPPORTUNITY            40
DOCUMENT               25
```

Candidate pressure:

```text
cross-source priority label + static source/type weight + recency
```

may not preserve:

- epistemic confidence/freshness;
- authority/control urgency;
- reversibility;
- expected business value;
- deadline/lateness;
- consequence/recovery state;
- contradiction state;
- source-health/completeness;
- actionability/available Clearance;
- user attention cost.

Do not conclude the ranking is wrong solely because it is simple. Microscopic tracing must determine whether source services already normalize these semantics before the Command Center sees them.

## F. Recommended-action projection

`buildRecommendedActions()` takes actions attached to the first five ranked items and deduplicates by label+href until five actions exist.

This means the user-facing action list is downstream of the same ranking function.

Most inspected actions are navigational/review actions such as:

```text
Review approval
Execute (opens approved tab)
Open Temporal Flow
Review missing facts
Update Business Genome
Review signal/recommendation
Open Governance Console
```

The Command Center itself does not appear in this first pass to directly consume Clearance and execute a material provider/domain effect. It acts primarily as a projection/navigation/control surface.

Target law to preserve:

```text
PRIORITY / RECOMMENDED ACTION
!= CLEARANCE
!= EXECUTION CLAIM
```

A Command Center `EXECUTE` affordance must ultimately route into the canonical current-governance path rather than treating `proposal.status = APPROVED` as sufficient current authority.

## G. Existing K4 pressure immediately inherited

The snapshot computes module readiness from `GenomeModuleReadinessService`, so F175/C125 can feed the Command Center directly.

It maps:

- readiness blockers;
- missing facts;
- weak Genome sections;
- Genome signals;
- Genome recommendations;
- cross-domain Genome summaries.

Therefore J17 is a major **consumer of EpistemicEligibility**.

Target:

```text
K4 source state
→ consumer-specific Command Center eligibility / confidence / freshness
→ priority projection
```

The Command Center must not independently resolve business truth.

## H. Cross-domain Genome bridge

`CommandCenterKeyGenomeBridgeService` combines:

- latest/computed cross-domain snapshot;
- ranked Genome recommendations;
- detected opportunities;
- stale/low-confidence signals;
- module readiness;
- GenomeAutonomyGate evaluations for selected blocked recommendations.

Several subcalls catch errors and return null/empty fallback.

The bridge is a useful convergence seam, but it compounds the need for source-health/projection-completeness semantics.

## I. Positive seams to preserve

- one central snapshot assembly point for the product surface;
- source-specific services remain authoritative rather than Command Center owning their state;
- `CommandCenterItem` provides a useful normalized presentation contract;
- source/sourceId/evidence fields preserve some provenance;
- ranking is deterministic and explainable today;
- actions are mostly navigation/review, reducing accidental direct-authority leakage;
- Constitution staleness is explicitly surfaced;
- weak Genome sections expose confidence/freshness dimensions;
- cross-domain bridge already separates blocking/unsafe automation information.

## J. Initial candidate questions — do not allocate IDs yet

### Candidate J17-A — degraded source vs empty source

Does a failed source read become indistinguishable to the user/ranker from a healthy source with zero important records?

Pressure:

```text
SOURCE READ FAILED
!= ZERO PRIORITIES FROM SOURCE
```

Need controller/types/UI trace to see whether degradation is surfaced elsewhere.

### Candidate J17-B — heterogeneous priority normalization

Are priority labels semantically comparable across approvals, temporal urgency, risks, readiness gaps, recommendations and opportunities, or are unlike semantics compressed before ranking?

Need source mapping trace.

### Candidate J17-C — priority relevance / freshness

Does ranking account for:

```text
truth freshness
source freshness
validity/deadline
supersession/cancellation
outcome/recovery state
```

or can stale high-priority items remain above current actionable work?

### Candidate J17-D — approved vs currently executable wording

Command Center maps any approved proposal as:

```text
Execute approved: <title>
Approved and ready to execute
```

Need trace through KeyActionProposalService execution path to prove whether current authority/Clearance/state are revalidated before effect execution. If execution revalidates, this may be a presentation precision issue rather than a safety defect.

### Candidate J17-E — ranking-to-action explainability

Can the product explain **why this item outranks another** beyond type/priority, and can the user see which evidence/source freshness drove the result?

This is a value/architecture question, not yet a verified defect.

## K. Initial journey target direction

Do not make the Command Center a new source of truth.

Direction:

```text
source-specific authoritative truth/projection
+ source health / freshness / provenance
→ Command Center normalized item
+ explicit priority dimensions
→ deterministic/explainable priority synthesis
→ recommended next action
→ canonical governance/action path
```

Possible priority dimensions to pressure-test:

```text
urgency / deadline
business impact / expected value
risk / reversibility
confidence / epistemic eligibility
readiness / actionability
authority/control state
recovery/consequence state
staleness / supersession
attention cost
```

Avoid an opaque ML priority model by default. Deterministic composable scoring may be more appropriate unless evidence later justifies learning-based ranking.

## L. Relationship to historical 'Universal Command Spine' intent

Repository product docs describe a candidate/declared `CommandItem` Universal Command Spine with richer fields such as urgency/impact/confidence/expected value/executableByKey/requiresApproval/risk/execution payload.

The inspected `BusinessCommandCenterService` path currently assembles snapshot `CommandCenterItem`s rather than demonstrating that one persistent CommandItem source is load-bearing for all inputs.

Treat the Universal Command Spine as product/target evidence until current code/migrations/readers/writers prove its runtime authority.

Do not assume one universal persistent command table is the target merely because product docs name it.

## M. Exact next microscopic trace

1. inspect Command Center controller/API/types and UI rendering for degraded/source-freshness semantics;
2. trace `KeyActionProposalService` APPROVED → execution and current Clearance revalidation;
3. trace source-specific priority/urgency semantics into item mappings;
4. trace TemporalFlow overdue/resolved/superseded filtering into Command Center;
5. trace Genome recommendation ranking vs Command Center static ranking;
6. inspect any actual `CommandItem` model/service/readers/writers on current code-bearing baseline;
7. check taxonomy before promoting J17-A...E into canonical F/C IDs;
8. pool J17 with K3/K4/K7/K8/K11;
9. refresh continuity before another broad tranche.

No production implementation is authorized by this dossier.
