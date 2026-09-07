# KeyFlowOS Recommendation Register — Operator Attention / Priority Continuation

Status: CANONICAL CONTINUATION AFTER KF-REC-050
Implementation evidence: `main@9bff44f8f9a5195e06af3669ccb1a8f4c47ccd76`
Production implementation: READ-ONLY / NOT AUTHORIZED

---

## KF-REC-051 — Establish a source-grounded Operator Attention & Priority Contract for Command Center → Action

**Status:** PROVISIONAL / STRONGLY SUPPORTED TARGET

**Primary journey:** J17 — Command Center → Priority → Action
**Primary kernels:** K7 Temporal/Workflow, K8 Evidence/Outcome
**Secondary kernels:** K3 Governance, K4 Business Knowledge, K5 Capability, K6 State Transition, K10 Financial Truth, K11 Recovery/Reliability

### Problem statement

The current Command Center presents multiple useful but semantically fragmented operational surfaces:

```text
BusinessCommandCenter synthesized snapshot
→ transient CommandCenterItems
→ Top Priorities / briefing / recommended actions

persistent CommandItem spine
→ Command Queue
→ obligations / suggestions / assignment / disposition / execution metadata

TemporalFlow
→ selected temporal events / urgency / risks / opportunities

source-specific rankers
→ Genome recommendation rank
→ finance detections / money moves
→ approvals / recovery / other domain states
```

The target should not make any one of these a universal source of business truth.

The missing architectural responsibility is:

> How does KeyFlow turn authoritative heterogeneous business conditions into trustworthy operator attention, rank them for the question being asked, preserve disposition/source/effect semantics, and route material action through canonical governance/execution?

---

# A. Separate the semantic layers

Minimum target distinction:

```text
SOURCE CONDITION / AUTHORITATIVE STATE
!=
OPERATOR ATTENTION / WORK PROJECTION
!=
PRIORITY ASSESSMENT
!=
USER DISPOSITION
!=
CONTROL / CLEARANCE
!=
EFFECT EXECUTION
!=
OUTCOME EVIDENCE
```

A `CommandItem` may participate in the operator-attention/work layer. It is not automatically the source state, authority decision or effect truth.

---

# B. Admission and convergence are one contract

A projection source adapter must own both directions:

```text
source condition becomes relevant
→ stable source/projection identity
→ admit/update operator item

source condition changes/resolves/supersedes
→ re-evaluate admission predicate
→ keep / update / resolve / supersede / cancel projection
→ retain history
```

Target law:

```text
PROJECTION ADMISSION WITHOUT REVERSE CONVERGENCE = INCOMPLETE ADAPTER
```

This addresses both F181 and F182.

Do not solve missing source adapters by mirroring every EventEmitter event indiscriminately. Admission is an architectural choice about operator relevance, not a logging side effect.

---

# C. Source health and projection completeness are first-class

Every composite operator view must distinguish:

```text
HEALTHY + ZERO ITEMS
DEGRADED / SOURCE UNAVAILABLE
STALE / LAST KNOWN
PARTIAL / SOME SOURCES MISSING
REBUILDING / RECONCILING
```

A failed source read may not silently become zero work/zero risk.

Recommended projection metadata where material:

```text
source status
source observedAt / refreshedAt
projection computedAt
freshness / staleness
materialization completeness
last successful refresh
source error classification
```

This is the J17 application of the broader projection laws already established in K4 and KF-REC-047.

---

# D. Priority is multidimensional before it is ordered

Do not define one universal `priorityScore` as the ontology of importance.

Preserve an explainable **PriorityAssessment** containing dimensions such as:

```text
urgency / deadline / lateness
business impact / expected value
risk / consequence severity
confidence / EpistemicEligibility
readiness / actionability
control / authority wait state
recovery / outcome uncertainty
reversibility / point-of-no-return
effort / capacity
source freshness / completeness
user disposition / attention cost
```

Source-specific rank evidence may be carried forward rather than flattened away.

Example:

```text
GenomeRecommendationRanker score/breakdown
→ source rank evidence
→ global PriorityAssessment
```

not:

```text
rich Genome rank
→ discard
→ risk level alone becomes global priority
```

---

# E. Rank by the operator question, not by a single universal score

Different questions legitimately require different deterministic orderings:

```text
WHAT IS OWED?
→ due / overdue / legal or contractual lateness first

WHAT IS DANGEROUS?
→ consequence severity / uncertainty / point-of-no-return first

WHAT SHOULD I DO NEXT?
→ urgency × expected value × actionability, constrained by risk/safety

WHAT CAN KEY SAFELY HANDLE?
→ current Clearance/readiness/reversibility/effect certainty

WHAT NEEDS MY DECISION?
→ waiting-for-control + consequence of delay + decision deadline

WHAT IS STUCK / BROKEN?
→ recovery need + uncertainty + elapsed time + consequence horizon
```

This preserves deterministic explainability while avoiding false comparability.

---

# F. User disposition is not source truth

Explicitly type operator actions:

```text
ACKNOWLEDGE
SNOOZE
DISMISS_FROM_ATTENTION
ASSIGN
COMPLETE_MANUAL_WORK
DISCHARGE_OBLIGATION
REQUEST / RESOLVE CONTROL
REQUEST EXECUTION
REOPEN
```

These must not silently claim:

```text
source resolved
effect executed
business outcome succeeded
```

unless the corresponding source/effect transition is actually proven.

This directly resolves F180/C130.

---

# G. Material action returns to canonical execution ownership

For a Command Center action that can cause a material business effect:

```text
operator item
→ resolve authoritative source/current revision
→ construct or recover exact ActionEnvelope / WorkOccurrence
→ current K3 Clearance
→ K11 execution ownership / EffectId / AttemptId
→ K6 domain transition / K9 provider effect where applicable
→ K8 OutcomeEvidence
→ projection converges from evidence
```

Do not make `CommandService.execute()` a second universal effect executor merely because CommandItem stores `executionTool`.

Possible migration strategies may include:

- deep-link/intent routing to the existing owner service;
- typed command-action adapters per source family;
- canonical ActionEnvelope creation for genuinely generic action items;
- read-only/advisory CommandItems with no execute affordance.

Choose per semantic class rather than forcing one dispatch mechanism.

---

# H. CommandItem role — strong candidate, bounded semantics

Current evidence supports retaining/evolving CommandItem as a durable operator work/attention projection for suitable classes, especially:

```text
OBLIGATION
source-derived durable work
assigned follow-up
persistent operator disposition
```

Positive seams to preserve:

- stable five-tuple obligation identity;
- `SUGGESTION` vs `OBLIGATION` distinction;
- due/overdue semantics;
- snooze;
- discharge distinct from checkbox completion;
- source-driven raise/settle contract;
- owner/assignment fields;
- priority/urgency/impact/value/risk metadata.

But target law:

```text
COMMANDITEM MAY OWN OPERATOR WORK STATE
COMMANDITEM DOES NOT AUTOMATICALLY OWN BUSINESS / AUTHORITY / EFFECT TRUTH
```

Do not mandate that every insight, Genome recommendation or ephemeral warning must become a persisted CommandItem.

---

# I. Relationship to KF-REC-047 Temporal Work Projection

KF-REC-047 remains valid and narrower:

```text
KF-REC-047
→ cross-domain visibility of long-lived temporal/work/recovery states

KF-REC-051
→ broader operator attention + priority + disposition + action routing
```

Relationship:

```text
Temporal Work Projection
→ one major source into Operator Attention / Priority
```

not:

```text
Temporal Work Projection = all business priority truth
```

---

# J. Relationship to K4 / KF-REC-049

K4 supplies epistemic eligibility and source/provenance integrity:

```text
knowledge item
→ EpistemicEligibility
→ PriorityAssessment confidence/freshness inputs
```

Priority ranking may not upgrade weak knowledge into stronger truth.

---

# K. Relationship to recovery

J18/K11/KF-REC-048 supplies:

```text
failure certainty
outcome uncertainty
retry/reconcile/cancel/reverse options
current Recovery Clearance
```

These become attention/priority inputs, not independent CommandItem truth.

---

# L. Query / UI contract

Server query scope and UI controls must agree.

```text
selected status/category/time/owner/query lens
→ server-side scope
→ response includes scope/completeness metadata
→ client rendering/filtering
```

Do not advertise `SNOOZED`, `COMPLETED`, `DISMISSED`, etc. over an OPEN-only dataset unless the control triggers a server re-query.

This addresses F183/C133.

---

# M. Findings / contradictions addressed

Primary J17 roots:

```text
F179 / C129  degraded source vs healthy zero projection
F180 / C130  projection says EXECUTED without source/effect proof
F181 / C131  consumer priority branch without load-bearing source materialization
F182 / C132  source resolves while persistent CommandItem can stay open
F183 / C133  multi-status UI over OPEN-only server dataset
F184 / C134  rich source ranking compressed into incompatible global priority semantics
```

Related mature roots include F120, F141–F144, F175–F178 and the Approval != Clearance / Projection != Truth invariants.

---

# N. Promotion gates

Before any implementation packet is authorized:

1. classify every current CommandItem writer/source family;
2. classify each as suggestion, obligation, durable work, control item, recovery item, or compatibility-only projection;
3. define source identity + reverse convergence for each included family;
4. define source health/freshness semantics for synthesized Command Center inputs;
5. define PriorityAssessment dimensions and at least the core operator query lenses;
6. map existing source-specific rankers into the priority contract without double-scoring;
7. define which CommandItem dispositions mutate only projection state vs authoritative source state;
8. remove or adapt false `Approve`/`Execute` semantics;
9. define canonical action routing and current Clearance revalidation;
10. define OutcomeEvidence-driven terminalization;
11. fix server-query/UI status scope consistency;
12. prove stale/resolved source conditions cannot remain actionable without explicit reason;
13. prove degraded sources cannot improve health/priority scores;
14. preserve obligation semantics and deterministic explainability;
15. backward re-audit J6/J7/J15/J17/J18/J23 plus K3/K4/K7/K8/K11.

No production implementation is authorized by KF-REC-051.
