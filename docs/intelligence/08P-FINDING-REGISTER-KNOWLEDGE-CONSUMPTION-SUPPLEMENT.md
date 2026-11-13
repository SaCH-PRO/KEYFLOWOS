# KeyFlowOS Finding Register — Knowledge Consumption Supplement

Status: CANONICAL CONTINUATION OF `08O-FINDING-REGISTER-TAXONOMY-RECONCILIATION-SUPPLEMENT.md`

Implementation evidence baseline: `main@168732d0e2226e11ed033c14fbdf7b3ea5344a41`

Canonical sequence continues after F174. Allocation checked against `04A` + `04B`.

---

## F175 — Genome module readiness can count epistemically invalid facts as present and allow automation

**Status:** VERIFIED CROSS-LAYER / EPISTEMIC-READINESS FINDING

`GenomeModuleReadinessService.computeModuleReadiness()` determines whether a required fact is present through `findBestMatchingFact()`.

The match is based on:

```text
section
+ normalized domain
+ normalized field
```

A matching fact satisfies the requirement regardless of observed:

```text
verificationStatus = DISPUTED | STALE | INFERRED | UNVERIFIED_IMPORTED
expiresAt in the past
freshnessScore
confidenceScore
qualityScore
operationalReadinessScore
riskIfWrong
```

The loader even reconstructs `score.overall = 0`, but `computeModuleReadiness()` does not use the score when deciding presence.

`automationAllowed` is then simply:

```text
blockingMissing.length === 0
```

`KeyActionGenomePolicyService.evaluateExecution()` consumes the persisted readiness result and can permit execution when `automationAllowed` is true and readiness/risk thresholds pass.

Therefore:

```text
FACT ROW EXISTS
can currently imply
REQUIRED KNOWLEDGE PRESENT FOR AUTOMATION
```

without proving the knowledge is current, verified, undisputed or sufficiently trustworthy for the action.

This is distinct from F161: F161 concerns stale verification metadata surviving a value replacement; F175 concerns the downstream readiness contract accepting epistemically weak rows even when their weak state is represented correctly.

### Target law

```text
KNOWLEDGE REQUIREMENT SATISFIED
!= ROW EXISTS
```

A module/capability requirement must specify an epistemic acceptance predicate, conceptually including as appropriate:

```text
KnowledgeSubject / required field
accepted verification classes
minimum confidence/evidence quality
freshness / expiry policy
conflict/dispute policy
risk-if-wrong sensitivity
source/provenance constraints
current MaterializationState
```

High-risk or autonomy-relevant requirements should fail closed when the accepted knowledge state is not proven.

Affected kernels: K4, K3, K5, K8.
Affected journeys: J2, J6, J15, J16, J25.

---

## F176 — KEY prompt working knowledge includes stale, disputed, expired or weak GenomeFacts without an epistemic eligibility filter

**Status:** VERIFIED CROSS-LAYER / REASONING-CONTEXT FINDING

`GenomeFactService.listTopFacts()` is explicitly documented as returning what KEY should treat as its working knowledge.

Its query is:

```text
where businessId
order by confidenceScore desc, updatedAt desc
take N
```

It does not filter by:

```text
verificationStatus
expiresAt
freshnessScore
conflict/dispute state
minimum confidence
source/provenance class
```

`FlowOrchestratorService` then injects all returned rows into the business context prompt.

`USER_VERIFIED` is labeled `verified`, `STALE` is labeled `stale`, and every other verification class — including `DISPUTED` — is collapsed to `unverified`. The fact remains present in the prompt either way.

Thus a fact that the knowledge layer itself represents as stale, disputed, expired or otherwise weak can still become active reasoning context merely because it ranks in the top N.

This is distinct from F175:

- F175 affects deterministic readiness / governed execution gates;
- F176 affects model reasoning context and therefore recommendations, interpretation and later action formation.

### Target law

```text
STORED KNOWLEDGE
→ epistemic eligibility for this consumer/context
→ prompt/advisory context
```

not:

```text
TOP N BY STORED CONFIDENCE
→ working truth
```

The target need not hide uncertainty from KEY. It should expose uncertainty deliberately, e.g.:

```text
CANONICAL / VERIFIED CURRENT
CONTEXTUAL / INFERRED
STALE — DO NOT RELY WITHOUT REVALIDATION
DISPUTED — CONFLICT PRESENT
EXPIRED — HISTORICAL ONLY
```

and mutation/authorization must never be justified by weak prompt context alone.

Affected kernels: K4, K8, K3.
Affected journeys: J2, J6, J16.

---

# Pool implication

F175 + F176 establish a shared K4 distinction:

```text
KNOWLEDGE STORAGE
!= KNOWLEDGE ELIGIBILITY FOR A CONSUMER
```

Consumer-specific eligibility is derived from the same canonical KnowledgeRevision/evidence state; it must not create another truth store.

KF-REC-049 should be refined to include explicit **consumer epistemic contracts** for:

- deterministic readiness/control gates;
- LLM/prompt context;
- recommendations/analytics;
- learning inputs.

No production implementation is authorized by this supplement.
