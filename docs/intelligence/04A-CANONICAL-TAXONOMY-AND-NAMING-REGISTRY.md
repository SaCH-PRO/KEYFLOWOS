# KeyFlowOS Canonical Taxonomy and Naming Registry

Status: CANONICAL GOVERNANCE ARTIFACT
Last updated: 2026-09-05

Purpose: prevent semantic duplication, alias drift, repeated indexing, inconsistent naming and accidental creation of multiple canonical entries for the same KeyFlowOS concept.

This file governs **how architectural intelligence is named and indexed**. It does not replace domain-specific registers. Numeric allocation for findings, contradictions and recommendations is additionally governed by `04B-CANONICAL-ID-ALLOCATION-LEDGER.md`.

---

# 1. Prime law

```text
ONE SEMANTIC CONCEPT
→ ONE CANONICAL ID
→ ONE CANONICAL NAME
→ ONE CANONICAL OWNER / HOME REGISTER
→ ZERO DUPLICATE CANONICAL ENTRIES
→ MANY ALIASES / REFERENCES PERMITTED
```

If two records appear to describe the same underlying semantic object, do **not** create a second canonical record until the existing registry and allocation ledger have been checked.

Aliases are references, not new concepts.

---

# 2. Mandatory pre-create check

Before creating any new journey, kernel, concept, finding, contradiction, recommendation, decision, invariant, execution packet or target primitive:

```text
1. LOAD:
   - 04-CONCEPT-REGISTRY.md
   - 04A-CANONICAL-TAXONOMY-AND-NAMING-REGISTRY.md
   - 04B-CANONICAL-ID-ALLOCATION-LEDGER.md

2. SEARCH canonical registry/indexes by:
   - exact term
   - synonyms
   - abbreviations
   - implementation names
   - target-architecture names
   - adjacent journey/kernel names

3. CLASSIFY candidate as:
   A. SAME CONCEPT
   B. SPECIALIZATION / SUBTYPE
   C. RELATED BUT DISTINCT
   D. IMPLEMENTATION ALIAS
   E. HISTORICAL / DEPRECATED NAME
   F. GENUINELY NEW CONCEPT

4. IF SAME CONCEPT:
   → reuse canonical ID/name
   → add alias/cross-reference only

5. IF SPECIALIZATION:
   → parent canonical ID MUST be referenced
   → new ID only if independently useful and semantically stable

6. IF RELATED BUT DISTINCT:
   → explicitly state "not equivalent to"

7. IF NEW:
   → allocate next globally unused ID from 04B
   → write canonical definition in exactly one home register
   → update 04B + CURRENT + ROLLOVER
```

No agent should allocate a new ID merely because a new file or implementation class has a different name.

---

# 3. Canonical namespaces

## 3.1 Journeys

```text
J1 ... J25
```

Canonical home:
- `docs/intelligence/03-ANALYSIS-MAP.md`
- detailed dossiers under `docs/intelligence/journeys/`

Rule:
- journey number is identity;
- file title may expand, but must not create a second journey for the same end-to-end user/business transition;
- subflows remain sections/investigations unless they have genuinely distinct end-to-end identity.

Canonical example:
```text
J16 — Business Genome Evolution
```

Aliases such as `Genome Learning Journey`, `Business Knowledge Evolution`, or `Adaptive Genome Loop` must reference J16 unless analysis proves a distinct journey.

---

## 3.2 Kernels

```text
K1 ... K12
```

Canonical home:
- `docs/intelligence/12-KERNEL-PROGRAMME.md`
- detailed dossiers under `docs/intelligence/kernels/`

Rule:
- kernel number is identity;
- conceptual terms such as `Business Knowledge Kernel` may also have a `KF-CONCEPT-*` entry, but that concept entry is a semantic definition of K4, not a second kernel.

Current J16 activation:
```text
K4 — Business Knowledge
```

Canonical aliases:
```text
Business Knowledge Kernel → K4
Knowledge Kernel          → K4 when used in KeyFlow architectural context
Genome Knowledge Kernel   → K4 unless explicitly scoped to implementation-only GenomeFact machinery
```

---

## 3.3 Concepts / semantic primitives

```text
KF-CONCEPT-###
```

Canonical home:
- `docs/intelligence/04-CONCEPT-REGISTRY.md`

Use for stable semantic objects/distinctions reused across journeys/kernels. Do not allocate for implementation class names, temporary investigative phrases, spelling variants or recommendation-only wording.

Current concept range remains:
```text
KF-CONCEPT-001–KF-CONCEPT-042
```

---

## 3.4 Findings

```text
F###
```

Canonical home:
- `08-FINDING-REGISTER.md`
- ordered supplements, with allocation ownership governed by 04B

Definition: an evidence-backed statement about current implementation/system behavior or a verified architecture condition.

Rule:
- strengthen/reuse an existing F-ID when the causal root is the same;
- allocate a new F-ID only for materially distinct causal behavior;
- historical files with colliding headings do not override 04B.

Current canonical range:
```text
F001–F174
```

Latest canonical reconciliation definitions: `08O-FINDING-REGISTER-TAXONOMY-RECONCILIATION-SUPPLEMENT.md`.

---

## 3.5 Contradictions

```text
C###
```

Canonical home:
- `09-CONTRADICTION-REGISTER.md`
- ordered supplements, with allocation ownership governed by 04B

Definition: an active disagreement between two truths, promises, representations, states or architectural semantics.

Rule:
- cross-journey recurrence reuses the same C-ID;
- split only when independent resolution is required;
- historical colliding headings are aliases/remapped according to 04B.

Current canonical range:
```text
C001–C124
```

Latest canonical reconciliation definitions: `09O-CONTRADICTION-REGISTER-TAXONOMY-RECONCILIATION-SUPPLEMENT.md`.

---

## 3.6 Recommendations

```text
KF-REC-###
```

Canonical home:
- `10-RECOMMENDATION-REGISTER.md`
- ordered continuations, with allocation ownership governed by 04B

Definition: a target architectural direction or invariant bundle intended to resolve findings/contradictions.

Rule:
- broaden/refine an existing recommendation before creating another overlapping recommendation;
- a new recommendation requires a distinct target responsibility or migration/proof implication.

Current canonical range:
```text
KF-REC-001–KF-REC-050
```

Latest canonical allocation: `KF-REC-050 — Make user-visible WorkDefinition controls load-bearing across occurrence creation and execution` in `10I-RECOMMENDATION-REGISTER-TAXONOMY-RECONCILIATION-CONTINUATION.md`.

---

## 3.7 Decisions

```text
KF-DEC-###
```

Canonical home: `05-DECISION-REGISTER.md`.
A decision freezes an architectural choice sufficiently to constrain later work. Recommendations remain provisional until alternatives have been considered and the programme accepts the constraint.

---

## 3.8 Execution packets

```text
KF-EXEC-<DOMAIN>-###
```

Canonical home: `docs/intelligence/execution/`.
Execution packet identity is implementation scope, not architecture concept identity. A packet may implement multiple concepts/recommendations but must not mint synonyms for them.

---

## 3.9 Proof obligations

Preferred bounded form:
```text
PF-<SCOPE>-###
```

Proof IDs are local to a declared scope unless promoted into a global proof index. Never reuse a proof ID for a different assertion.

---

# 4. Canonical naming dimensions

Every reusable architectural term should be classified where applicable:

```text
IDENTITY      what semantic thing is this?
LAYER         product | journey | kernel | semantic primitive | implementation | projection
OWNER         which kernel/domain owns truth?
STATUS        canonical | working | candidate | implementation seam | deprecated
SCOPE         global | journey | domain | provider | bounded packet
TEMPORALITY   definition | occurrence | revision | attempt | snapshot | projection
AUTHORITY     authoritative | derived | advisory | compatibility
```

---

# 5. Alias registry

| Alias / implementation term | Canonical reference | Classification | Notes |
|---|---|---|---|
| Business Knowledge Kernel | K4 | canonical kernel alias | Same kernel, not a second kernel |
| Knowledge Kernel | K4 | shorthand alias | Only in KeyFlow architecture context |
| Business Genome | KF-CONCEPT-003 | canonical concept | Living evidence-aware business understanding |
| GenomeFact | KF-CONCEPT-004 | implementation concept | Current persistence primitive, not automatically canonical fact |
| Resolved Fact / Canonical Fact | KF-CONCEPT-017 | target semantic concept | Stronger than arbitrary GenomeFact row |
| Genome Evidence | KF-CONCEPT-005 / KF-CONCEPT-016 | implementation vs general evidence | Preserve distinction |
| Business Blueprint | KF-CONCEPT-002 | canonical concept | Declaration/configuration, not automatically resolved truth |
| Business Graph | KF-CONCEPT-007 | macro concept | Complete factual business state treated as reality |
| Governed Action Envelope | KF-CONCEPT-025 | working canonical concept | Avoid synonym proliferation |
| Clearance | KF-CONCEPT-026 | canonical concept | Exact current permission to execute material action |
| Execution Claim | KF-CONCEPT-028 | canonical concept | Exclusive consumption/effect pursuit; distinguish AttemptOwnership |
| Temporal Work Projection | KF-REC-047 target term | target projection | Not workflow truth |
| Recovery Control Twin | J23/J18 target-candidate term | derived operational lens | Not separate truth store |
| KnowledgeRevision | K4 / KF-REC-049 reserved primitive | target primitive | Promote only after convergence |
| LearningEligibility | K4 / KF-REC-049 reserved primitive | target derived predicate | Not yet a KF-CONCEPT ID |
| historical workflow-control F146/F147 | F167/F168 | remapped historical IDs | 04B governs |
| historical recurrence F149/F150 | F169/F170 | remapped historical IDs | 04B governs |
| historical provider-recovery F152/F153 | F171/F172 | remapped historical IDs | 04B governs |
| historical scheduled-recovery F154 | F173 | remapped historical ID | 04B governs |
| historical compensation F155 | F174 | remapped historical ID | 04B governs |
| historical workflow-control KF-REC-046 | KF-REC-050 | remapped historical ID | Preserved KF-REC-046 is workflow versioning |

---

# 6. J16 / K4 reserved vocabulary

Use these exact terms consistently until convergence:

```text
KnowledgeSubject
KnowledgeRevision
KnowledgeAssertion
KnowledgeInference
KnowledgeChangeIntent
KnowledgeVerification
KnowledgeConflict
MaterializationState
LearningEligibility
```

Status: **RESERVED TARGET VOCABULARY — NOT YET ALL PROMOTED TO KF-CONCEPT IDs**.

Do not create alternate canonical names unless analysis first proves semantic distinction.

---

# 7. Distinction matrix — commonly confused concepts

| Concept A | Concept B | Governing distinction |
|---|---|---|
| Business Blueprint | Business Genome | declared/configured understanding vs living evidence-aware interpretation |
| Business Genome | Business Graph | interpretation/readiness/intelligence vs complete factual reality |
| GenomeFact | Resolved Fact | current storage row vs ontology-resolved canonical knowledge |
| Observation | Assertion | something observed/imported/inferred vs a source making a proposition |
| Assertion | Evidence | proposition vs support for believing it |
| Accepted | Verified | workflow acceptance vs provenance/authority-backed verification |
| Verification | Clearance | truth judgment vs permission to execute |
| Readiness | Authority | prerequisites/capability state vs permission/right |
| Approval | Clearance | historical control evidence vs current exact authorization |
| Clearance | Execution Claim | may execute vs which executor may consume permission |
| EffectId | AttemptId | logical material effect vs one execution try |
| WorkOccurrence | EffectId | logical work instance vs side-effect identity |
| RecoveryEffectId | EffectId | inverse/mitigating effect vs original effect |
| Process success | Business outcome | internal transition completion vs real-world result |
| Learning | Authority | adaptive belief/policy suggestion vs permission envelope |
| Projection | Authoritative truth | derived view vs legal/source truth |

---

# 8. Canonical entry template

Every new canonical concept should include:

```text
ID
Canonical name
Status
Definition
Owner kernel/domain
Scope
Not equivalent to
Aliases
Primary journeys
Primary evidence/recommendations
Supersedes / superseded by (if any)
```

Every new finding/contradiction/recommendation should link canonical concepts where they exist.

---

# 9. Rename / merge procedure

Never silently rename or reassign a canonical concept.

If two IDs collide/duplicate:

```text
load 04B
→ choose surviving canonical ID
→ remap or alias historical entry
→ preserve historical evidence
→ never reuse the old numeric meaning as a new allocation
→ update CURRENT + ROLLOVER
```

---

# 10. Index integrity rules

1. IDs are monotonically allocated and never reused.
2. A canonical ID has exactly one current semantic meaning/home definition.
3. Supplements do not independently allocate numbers; 04B does.
4. Cross-journey reappearance references existing IDs.
5. Implementation classes/tables do not automatically receive architecture IDs.
6. Candidate semantic primitives can be reserved by name before permanent allocation.
7. 04-CONCEPT-REGISTRY is semantic vocabulary source of truth.
8. 04B is numeric allocation source of truth for F/C/KF-REC.
9. Journey/Kernel registers are identity sources for J/K namespaces.
10. CURRENT/HANDOFF/ROLLOVER record latest allocated ranges.
11. Any detected duplicate is an intelligence-integrity defect and is repaired before broad new analysis continues.
12. Filename suffixes (`08H`, `08I`, etc.) are organizational, never identity allocators.

---

# 11. Agent operating rule

ChatGPT, Claude Code, Kimi Code and later agents must follow:

```text
LOAD 04A + 04B
→ SEARCH
→ REUSE
→ REFINE
→ CROSS-REFERENCE
before
CREATE NEW ID / NAME
```

When uncertain, keep a temporary descriptor in the investigation and defer permanent allocation.

---

# 12. Current anti-duplication checkpoint

```text
Journey namespace:       J1–J25 fixed
Kernel namespace:        K1–K12 fixed
Finding range:           through F174
Contradiction range:     through C124
Recommendation range:    through KF-REC-050
Concept range:           through KF-CONCEPT-042
Allocator:               04B-CANONICAL-ID-ALLOCATION-LEDGER.md
```

The historical collision band has been reconciled without deleting evidence. J16/K4 candidate vocabulary remains reserved rather than prematurely promoted.

No production implementation is authorized by this taxonomy artifact.
