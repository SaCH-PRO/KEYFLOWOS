# J17 — Operator Attention & Priority Standards / Frontier Pressure Test

Status: CANONICAL RESEARCH PRESSURE TEST / TARGET SYNTHESIS INPUT
Date: 2026-09-06
Primary journey: J17 — Command Center → Priority → Action
Primary recommendation: KF-REC-051
Implementation authorized: **NO**

## Purpose

Pressure-test the J17/KF-REC-051 target against mature alarm/incident attention disciplines and current AI post-deployment monitoring guidance without importing their domain assumptions wholesale.

Method:

```text
H1 FLOOR
What production-grade attention/control properties are already well established?

H2 FRONTIER
What stronger properties are emerging around operator overload, human-AI feedback and adaptive monitoring?

H3 KEYFLOW SYNTHESIS
What stronger operating model can KeyFlowOS uniquely compose from business knowledge + authority + temporal work + evidence + recovery + operator control?
```

Standards and established practices are evidence/floor, not the default KeyFlow destination.

---

# 1. H1 — floor properties

## 1.1 ISA alarm-management lifecycle

ISA-18 materials establish a lifecycle discipline around attention-worthy operator signals. Relevant transferable properties include:

- identify/rationalize whether an alarm should exist at all;
- document cause, consequence and operator response;
- assign priority/class according to a defined philosophy;
- make alarms meaningful and actionable;
- provide shelving/suppression semantics;
- monitor alarm-system performance over time;
- retain history and audit changes;
- manage stale/noisy/alarm-flood conditions;
- use human-machine-interface design to support situational awareness.

Key transfer:

```text
ATTENTION ITEM CREATION IS A GOVERNED LIFECYCLE
not
EVERY DETECTED EVENT BECOMES OPERATOR ATTENTION
```

And:

```text
SNOOZE / SHELVE
= explicit temporary operator-control state
not
SOURCE TRUTH CHANGED
```

The ISA distinction that an alarm should require an operator response is especially useful for KeyFlow:

```text
EVENT / OBSERVATION
!= ATTENTION ITEM REQUIRING HUMAN RESPONSE
```

This supports selective admission rather than universal event mirroring.

## 1.2 Google SRE alert quality

Google SRE guidance strongly emphasizes:

- alerts should be actionable;
- alerts should focus on user-impacting symptoms rather than brittle internal causes;
- alert fatigue / pager burnout is an operational failure;
- duplicated alerts should be suppressed/coalesced where one root problem explains them;
- urgency should correspond to the actual need for human response;
- alerting quality should be assessed, not assumed.

SRE alerting-on-SLO material also evaluates alert strategies through properties such as precision, recall, detection time and reset time.

Key transfer:

```text
OPERATOR ATTENTION IS A SCARCE RESOURCE
```

and:

```text
ACTIONABILITY
is a first-class property of whether something belongs in an interruptive / next-action surface
```

A useful KeyFlow translation of SRE reset time is:

> **attention reset lag** — elapsed time between authoritative source resolution and convergence/removal/reclassification of the operator item.

This directly operationalizes F182.

## 1.3 NIST AI RMF / deployed-AI monitoring

NIST AI RMF Core and its current 2026 deployed-AI monitoring work support:

- production monitoring of system functionality/behavior;
- explicit transparency/accountability assessment;
- interpretation of AI outputs in context;
- human feedback, appeal and override mechanisms;
- response/recovery/change-management processes;
- monitoring of human factors, not only system internals;
- risk-tailored post-deployment monitoring;
- recognition that deployed-AI monitoring terminology/practices remain fragmented and still need innovation.

Key transfer:

```text
KEY-GENERATED PRIORITY / RECOMMENDATION
→ must remain observable as a socio-technical decision-support behavior
→ including how humans accept, override, dismiss, snooze and act on it
```

User override is signal for monitoring and improvement; it is not automatic evidence that the business truth or authority should change.

---

# 2. H2 — frontier properties

The external evidence points beyond a static dashboard toward an attention system whose own performance is measurable.

## 2.1 Attention quality metrics

Candidate measurable properties:

```text
ATTENTION PRECISION
Of items surfaced as high/urgent, how many genuinely warranted action/decision?

ATTENTION RECALL
Of material business conditions requiring attention, how many were surfaced?

DETECTION LAG
Source condition becomes material → operator item becomes visible.

RESET LAG
Source condition resolves/supersedes → operator item converges.

STALE ATTENTION RATE
Share of active operator items whose source predicate no longer holds.

ACTIONABILITY RATE
Share of next-action items for which the current principal/KEY actually has a valid next step.

DEGRADED-PROJECTION RATE
How often a composite view is partial/stale/unavailable.

OVERRIDE / DISMISS / SNOOZE PATTERN
How users reshape the attention surface, without treating those acts as source truth.
```

These metrics should initially be observability/proof instruments, not optimization targets that the system can game.

## 2.2 Attention rationalization

Before admitting a new operator-attention family, ask:

```text
What business condition does it represent?
What consequence occurs if ignored?
What response is expected?
Who can respond?
How long is response useful?
What makes it resolve/supersede?
What other item already represents the same root cause?
```

This is stronger than simply adding another item mapper.

## 2.3 Dynamic suppression / coalescing without hidden truth

Alarm-management practice supports context-sensitive suppression, but KeyFlow must preserve explainability:

```text
underlying source conditions remain durable/inspectable
→ operator projection may coalesce or suppress redundant attention
→ suppressed reasons remain visible in drill-down
```

No suppressed item should silently authorize or execute anything.

## 2.4 Human-AI attention feedback

NIST's human-factors monitoring pressure suggests a bounded feedback loop:

```text
priority recommendation shown
→ user acknowledges / acts / overrides / snoozes / dismisses
→ outcome + later source state observed
→ evaluate attention quality
→ suggest ranking/admission policy refinement
```

But:

```text
USER DISMISSAL
!= SOURCE FALSE

FREQUENT ACCEPTANCE
!= NEW AUTHORITY

OUTCOME CORRELATION
!= CAUSAL LEARNING WITHOUT LINEAGE
```

K4/K3/K8 safeguards remain in force.

---

# 3. H3 — KeyFlow synthesis

## 3.1 Source-grounded Attention Contract

KeyFlow can combine capabilities that conventional alarm systems generally do not have in one governed model:

```text
Business Graph / domain state
+ K4 KnowledgeRevision / EpistemicEligibility
+ K7 temporal/work state
+ K3 current authority / Clearance
+ K8 outcome/evidence
+ K9 provider/external truth
+ K10 financial consequence
+ K11 recovery state
→ AttentionAdmission
→ PriorityAssessment
→ OperatorQueryLens
→ user/KEY action intent
→ canonical governed effect
→ OutcomeEvidence
→ AttentionResolution
```

This is a semantic composition, not a mandate for a universal new table.

## 3.2 Question-specific priority lenses

Retain KF-REC-051's key innovation:

```text
WHAT IS OWED?
WHAT IS DANGEROUS?
WHAT SHOULD I DO NEXT?
WHAT CAN KEY SAFELY HANDLE?
WHAT NEEDS MY DECISION?
WHAT IS STUCK / BROKEN?
```

The same source condition may rank differently under different lenses without contradiction because the ordering question is explicit.

This is preferable to pretending one scalar score is universal priority truth.

## 3.3 Projection Completeness Envelope

Composite operator views should expose something like a derived envelope:

```text
computedAt
source coverage / degraded sources
freshness distribution
stale sources
unknown sources
materialization lag
confidence / epistemic coverage where relevant
```

A user-visible form could remain simple while operator drill-down exposes details.

Target law:

```text
HEALTH / PRIORITY POINT ESTIMATE
without projection completeness context
must not imply stronger certainty than inputs support
```

This extends F179 beyond a generic error banner.

## 3.4 Attention budget / interruption cost

Treat human attention as finite.

Candidate rule:

```text
SURFACE / INTERRUPT only when consequence × urgency × actionability justifies attention cost
```

Lower-value but useful information may remain discoverable in non-interruptive views.

This should be a policy/assessment dimension, not a financial token budget or self-granting autonomy mechanism.

## 3.5 Attention lineage — “why am I seeing this?”

Every material operator item should be able to explain, at appropriate depth:

```text
source condition / source id
admission reason
priority dimensions
source freshness / completeness
control/actionability state
prior disposition
related/coalesced items
what would resolve it
```

This gives KeyFlow a natural explanation surface without making AI-generated prose the source of truth.

## 3.6 Attention reset fidelity

Introduce a proof/observability objective:

```text
AUTHORITATIVE SOURCE RESOLVES
→ all active operator projections converge within declared lag
```

Measure it per source family.

This directly detects F182-style stale operator work and makes projection correctness empirically testable.

---

# 4. What the research changes

## Strengthened

- **F179/C129** — composite health needs explicit degraded/partial semantics.
- **F181/C131** — operator-attention admission must be load-bearing and selective.
- **F182/C132** — reverse convergence/reset is a first-class quality property, not cleanup.
- **F183/C133** — operator lifecycle visibility must match actual query scope.
- **F184/C134** — priority must preserve consequence/actionability/source semantics rather than flattening type labels.
- **KF-REC-051** — strongly supported; add attention-quality monitoring and rationalization gates.

## Unchanged

- **F180/C130** — standards do not justify projection-only `EXECUTED`; canonical effect/outcome semantics remain necessary.
- **KF-REC-047** remains the temporal-work read model and a source to J17, not the whole attention system.
- **KF-REC-049** still supplies epistemic eligibility.
- **KF-REC-048** still supplies recovery/outcome certainty.

## No new canonical finding required from research alone

The external work strengthens target properties. It does not prove additional repository behavior by itself.

---

# 5. Rejected overbuild

Do **not** infer that KeyFlow now needs:

- an ISA-style process alarm database;
- PagerDuty-like incident infrastructure for every business item;
- a universal event-to-alert mirror;
- one global learned priority score;
- an opaque ML attention ranker;
- a second authority engine inside Command Center;
- a second source-of-truth `AttentionItem` table solely because the semantic role exists.

Physical persistence must be justified by migration/query/performance evidence later.

---

# 6. Target refinements to KF-REC-051

Add these explicit quality properties:

```text
ATTENTION ADMISSION IS SELECTIVE AND RATIONALIZED
EVERY INTERRUPTIVE ATTENTION ITEM HAS AN EXPECTED RESPONSE OR DECISION
SOURCE RESOLUTION HAS A MEASURABLE ATTENTION RESET LAG
COMPOSITE PRIORITY VIEWS EXPOSE DEGRADED / PARTIAL INPUT STATE
REDUNDANT ROOT-CAUSE ATTENTION MAY BE COALESCED WITHOUT HIDING SOURCE HISTORY
USER DISPOSITION IS MONITORED AS HUMAN-SYSTEM FEEDBACK BUT DOES NOT REWRITE TRUTH/AUTHORITY
PRIORITY/ATTENTION QUALITY IS POST-DEPLOYMENT MONITORED
```

Suggested future proof metrics:

```text
attention precision
attention recall
detection lag
reset lag
stale attention rate
actionability rate
projection degradation rate
snooze/dismiss/override recurrence
```

Use metrics as assurance signals first; do not let them silently optimize authority or truth.

---

# 7. Backward re-audit trigger

Pressure next through:

```text
J6  proactive autonomy / interruption selection
J7  financial truth / overdue and money consequence
J15 approval/governance attention
J17 Command Center
J18 failure/recovery attention
J23 temporal work

K3 authority
K4 knowledge
K7 work/time
K8 evidence/outcome
K11 recovery
```

Primary question:

> Does the operator-attention model preserve each source kernel's truth and control semantics while giving the user a coherent, explainable, bounded answer to what deserves attention now?

No production implementation is authorized by this research artifact.

## External evidence consulted

- ISA-18 Series / ISA alarm management lifecycle, prioritization, rationalization, shelving, performance monitoring and alarm-flood guidance.
- Google SRE guidance on actionable alerts, symptom-vs-cause, SLO-based alerting, signal/noise, fatigue, precision/recall/detection/reset properties.
- NIST AI RMF Core / Playbook and 2026 NIST AI 800-4 deployed-AI monitoring work on production monitoring, human factors, transparency, appeal/override and post-deployment feedback.
