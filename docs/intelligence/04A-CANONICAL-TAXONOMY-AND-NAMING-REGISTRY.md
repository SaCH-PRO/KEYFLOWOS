# KeyFlowOS Canonical Taxonomy and Naming Registry

Status: CANONICAL GOVERNANCE ARTIFACT
Last updated: 2026-09-05

Purpose: prevent semantic duplication, alias drift, repeated indexing, inconsistent naming and accidental creation of multiple canonical entries for the same KeyFlowOS concept.

This file governs **how architectural intelligence is named and indexed**. It does not replace the domain-specific registers; it tells every agent how to create, reference, rename, merge and deprecate entries across them.

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

If two records appear to describe the same underlying semantic object, do **not** create a second canonical record until the existing registry has been checked.

Aliases are references, not new concepts.

---

# 2. Mandatory pre-create check

Before creating any new journey, kernel, concept, finding, contradiction, recommendation, decision, invariant, execution packet or target primitive:

```text
1. SEARCH canonical registry/indexes by:
   - exact term
   - synonyms
   - abbreviations
   - implementation names
   - target-architecture names
   - adjacent journey/kernel names

2. CLASSIFY candidate as:
   A. SAME CONCEPT
   B. SPECIALIZATION / SUBTYPE
   C. RELATED BUT DISTINCT
   D. IMPLEMENTATION ALIAS
   E. HISTORICAL / DEPRECATED NAME
   F. GENUINELY NEW CONCEPT

3. IF SAME CONCEPT:
   → reuse canonical ID/name
   → add alias/cross-reference only

4. IF SPECIALIZATION:
   → parent canonical ID MUST be referenced
   → new ID only if independently useful and semantically stable

5. IF RELATED BUT DISTINCT:
   → explicitly state "not equivalent to"

6. IF NEW:
   → allocate next ID in exactly one namespace
   → update the canonical index/home register
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

Use for:
- stable semantic objects/distinctions;
- architecture vocabulary reused across several journeys/kernels;
- terms whose definition matters independently of a single finding/recommendation.

Do NOT create a new concept merely for:
- an implementation class/table name already covered by an existing concept;
- a temporary investigative phrase;
- an alternative spelling;
- a recommendation-specific wording.

---

## 3.4 Findings

```text
F###
```

Canonical home:
- `08-FINDING-REGISTER.md`
- ordered `08A...08Z...` supplements

Definition:
A finding is an evidence-backed statement about current implementation/system behavior or a verified architecture condition.

Rule:
- a later trace that strengthens the same defect reuses the existing F-ID;
- new F-ID only when the causal defect is materially distinct;
- each finding must include affected journeys/kernels and a target law where possible.

Current range:
```text
F001–F166
```

---

## 3.5 Contradictions

```text
C###
```

Canonical home:
- `09-CONTRADICTION-REGISTER.md`
- ordered `09A...` supplements

Definition:
A contradiction is an active disagreement between two truths, promises, representations, states or architectural semantics.

Rule:
- do not create a new contradiction simply because the same contradiction appears in another journey;
- reference the same C-ID and add affected surfaces;
- split only when independent resolutions are required.

Current range:
```text
C001–C116
```

---

## 3.6 Recommendations

```text
KF-REC-###
```

Canonical home:
- `10-RECOMMENDATION-REGISTER.md`
- ordered `10A...` continuations

Definition:
A recommendation is a target architectural direction or invariant bundle intended to resolve findings/contradictions.

Rule:
- broaden/refine an existing recommendation before creating another overlapping recommendation;
- a new recommendation requires a distinct target responsibility or migration/proof implication.

Current range:
```text
KF-REC-001–KF-REC-049
```

---

## 3.7 Decisions

```text
KF-DEC-###
```

Canonical home:
- `05-DECISION-REGISTER.md`

Definition:
A decision freezes an architectural choice sufficiently to constrain later work.

Rule:
- recommendations may remain provisional;
- only promote to a Decision when alternatives were considered and the programme accepts the constraint.

---

## 3.8 Execution packets

```text
KF-EXEC-<DOMAIN>-###
```

Canonical home:
- `docs/intelligence/execution/`

Rule:
- execution packet identity is implementation scope, not architecture concept identity;
- packet may implement several existing concepts/recommendations but must never mint synonyms for them.

Example:
```text
KF-EXEC-EXTFX-001
```

---

## 3.9 Proof obligations

Preferred canonical form inside a bounded investigation/packet:

```text
PF-<SCOPE>-###
```

Proof IDs are local to a declared scope unless promoted into a global proof index.

Never reuse the same proof ID for a different assertion.

---

# 4. Canonical naming dimensions

Every reusable architectural term should be classified along these dimensions where applicable:

```text
IDENTITY      what semantic thing is this?
LAYER         product | journey | kernel | semantic primitive | implementation | projection
OWNER         which kernel/domain owns truth?
STATUS        canonical | working | candidate | implementation seam | deprecated
SCOPE         global | journey | domain | provider | bounded packet
TEMPORALITY   definition | occurrence | revision | attempt | snapshot | projection
AUTHORITY     authoritative | derived | advisory | compatibility
```

This prevents two differently named objects from being assumed distinct when they differ only by layer or status.

---

# 5. Alias registry

Aliases must use this shape:

| Alias / implementation term | Canonical reference | Classification | Notes |
|---|---|---|---|
| Business Knowledge Kernel | K4 | canonical kernel alias | Same kernel, not a second kernel |
| Knowledge Kernel | K4 | shorthand alias | Only in KeyFlow architecture context |
| Business Genome | KF-CONCEPT-003 | canonical concept | Living evidence-aware business understanding |
| GenomeFact | KF-CONCEPT-004 | implementation concept | Current persistence primitive, not automatically synonymous with canonical business fact |
| Resolved Fact / Canonical Fact | KF-CONCEPT-017 | target semantic concept | Stronger than arbitrary GenomeFact row |
| Genome Evidence | KF-CONCEPT-005 / KF-CONCEPT-016 | implementation vs general evidence distinction | `GenomeEvidence` is implementation-specific; `Evidence` is cross-system semantic primitive |
| Business Blueprint | KF-CONCEPT-002 | canonical concept | Founder/operator declaration/configuration; not automatically resolved truth |
| Business Graph | KF-CONCEPT-007 | macro concept | Complete factual business state treated as reality |
| Governed Action Envelope | KF-CONCEPT-025 | working canonical concept | Do not mint `Action Package`, `Execution Envelope`, etc. without aliasing/checking |
| Clearance | KF-CONCEPT-026 | canonical concept | Exact current permission to execute material action |
| Execution Claim | KF-CONCEPT-028 | canonical concept | Exclusive consumption of a Clearance/effect pursuit; distinguish attempt ownership where needed |
| Temporal Work Projection | existing KF-REC-047 target term | target projection | Not a new workflow source of truth |
| Recovery Control Twin | J23/J18 target-candidate term | derived operational lens | Not separate truth store |
| KnowledgeRevision | K4 / KF-REC-049 candidate semantic primitive | target primitive | Add a KF-CONCEPT ID only after J16 pressure/research confirms stable boundaries |
| LearningEligibility | K4 / KF-REC-049 candidate semantic primitive | target derived predicate | Not yet a standalone canonical concept ID |

Important: candidate terms in the alias registry are reserved names. Agents should reuse the reserved spelling rather than inventing variants while the concept is under pressure testing.

---

# 6. J16 / K4 reserved vocabulary

Until J16/K4 reaches target convergence, use these exact terms consistently:

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

Do not create alternate canonical names such as:

```text
BeliefVersion
FactRevision
TruthRevision
GenomeRevisionRecord
KnowledgeApproval
LearningConfidenceGate
```

unless the analysis first proves they are semantically distinct. If they appear in notes/source code, record them as aliases or implementation terms.

---

# 7. Distinction matrix — commonly confused concepts

| Concept A | Concept B | Governing distinction |
|---|---|---|
| Business Blueprint | Business Genome | declared/configured understanding vs living evidence-aware interpretation |
| Business Genome | Business Graph | interpretation/readiness/intelligence vs complete factual business reality |
| GenomeFact | Resolved Fact | current storage row vs ontology-resolved canonical knowledge |
| Observation | Assertion | something observed/imported/inferred vs a source making a proposition |
| Assertion | Evidence | proposition vs support for believing it |
| Accepted | Verified | workflow acceptance vs provenance/authority-backed epistemic verification |
| Verification | Clearance | truth judgment vs permission to execute an action |
| Readiness | Authority | prerequisites/capability state vs permission/right |
| Approval | Clearance | historical control evidence vs current exact authorization |
| Clearance | Execution Claim | may execute vs which executor may consume the permission |
| EffectId | AttemptId | logical external/business effect vs one execution try |
| WorkOccurrence | EffectId | logical work instance vs material side-effect identity |
| RecoveryEffectId | EffectId | new inverse/mitigating effect vs original effect |
| Process success | Business outcome | internal transition completion vs desired real-world result |
| Learning | Authority | adaptive belief/policy suggestion vs permission envelope |
| Projection | Authoritative truth | derived query/materialized view vs source of legal state |

Before minting a new term, compare it to this table.

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

Every new finding/contradiction/recommendation should link back to canonical concept IDs where they exist.

---

# 9. Rename / merge procedure

Never silently rename a canonical concept.

If a better name emerges:

```text
OLD ID remains stable
→ registry records new canonical display name
→ old name becomes alias
→ references migrate gradually
→ no second ID is created
```

If two canonical IDs are later discovered to be duplicates:

```text
choose surviving canonical ID
→ mark duplicate ID DEPRECATED / MERGED INTO <ID>
→ preserve historical references
→ never reuse deprecated ID
→ update alias registry
```

If one concept later splits into two genuinely distinct concepts:

```text
original ID remains for original/general concept
→ allocate new ID only for distinct child/new concept
→ document split boundary and migration of references
```

---

# 10. Index integrity rules

1. IDs are monotonically allocated and never reused.
2. A canonical ID appears as the canonical heading in exactly one home register.
3. Supplements continue a namespace; they do not restart numbering.
4. Cross-journey reappearance references the existing ID.
5. Implementation classes/tables do not automatically receive architecture IDs.
6. Candidate semantic primitives can be **reserved by name** before receiving a permanent ID.
7. The Concept Registry is the semantic vocabulary source of truth.
8. Journey/Kernels registers are identity sources for J/K namespaces.
9. CURRENT/HANDOFF/ROLLOVER must record the latest allocated ranges.
10. Any detected duplicate is treated as an intelligence-integrity defect and repaired before broad new analysis continues.

---

# 11. Agent operating rule

ChatGPT, Claude Code, Kimi Code and any later architecture/implementation agent must follow:

```text
SEARCH → REUSE → REFINE → CROSS-REFERENCE
before
CREATE NEW ID / NAME
```

When uncertain whether a term is new, prefer a temporary descriptor inside the current investigation and defer permanent ID allocation until its distinction is proven.

The architecture programme values semantic precision over vocabulary proliferation.

---

# 12. Current anti-duplication checkpoint

As of this registry creation:

```text
Journey namespace:       J1–J25 fixed
Kernel namespace:        K1–K12 fixed
Finding range:           through F166
Contradiction range:     through C116
Recommendation range:    through KF-REC-049
Concept range:           currently through KF-CONCEPT-042 in 04-CONCEPT-REGISTRY.md
```

J16/K4 candidate vocabulary is reserved but intentionally not assigned new `KF-CONCEPT-*` IDs yet. This prevents premature concept proliferation while the microscopic trace and standards research are still active.

No production implementation is authorized by this taxonomy artifact.
