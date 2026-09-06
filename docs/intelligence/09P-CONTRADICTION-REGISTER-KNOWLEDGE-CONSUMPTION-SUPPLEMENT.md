# KeyFlowOS Contradiction Register — Knowledge Consumption Supplement

Status: CANONICAL CONTINUATION OF `09O-CONTRADICTION-REGISTER-TAXONOMY-RECONCILIATION-SUPPLEMENT.md`

Canonical sequence continues after C124. Allocation checked against `04A` + `04B`.

---

## C125 — epistemically weak required fact vs automation-ready module state

**Status:** VERIFIED ACTIVE CONTRADICTION

GenomeFact explicitly represents epistemic states such as `STALE` and `DISPUTED`, plus confidence/freshness/expiry metadata.

Genome module readiness can nevertheless satisfy a blocking fact requirement solely because a matching fact row exists.

`KeyActionGenomePolicyService` can then consume `automationAllowed=true` as execution permission input.

```text
knowledge truth: stale | disputed | expired | weak
readiness truth: required fact present
control implication: automation may be allowed
```

Target resolution: readiness requirements declare and enforce consumer-specific epistemic acceptance predicates over canonical KnowledgeRevision/evidence state.

Affected kernels: K4, K3, K5, K8.
Affected journeys: J2, J6, J15, J16, J25.

---

## C126 — fact represented as stale/disputed/expired vs active KEY working-knowledge prompt context

**Status:** VERIFIED ACTIVE CONTRADICTION

`GenomeFactService.listTopFacts()` is the working-knowledge retrieval surface for FlowOrchestrator prompt context but does not exclude stale, disputed, expired or otherwise weak facts.

The prompt may label a row `stale` or `unverified`, yet still places its value into the context KEY uses to reason.

```text
knowledge truth: do not treat as current canonical truth
prompt truth: present in active working knowledge
```

Target resolution: prompt context distinguishes canonical/current knowledge from contextual, stale, disputed and historical information using an explicit epistemic eligibility contract. Weak context may be shown to KEY as uncertainty/evidence, but not silently promoted into current truth.

Affected kernels: K4, K8, K3.
Affected journeys: J2, J6, J16.

---

# Pool law

```text
STORED FACT
!= READINESS-ELIGIBLE FACT
!= PROMPT-ELIGIBLE CURRENT TRUTH
```

All eligibility decisions should derive from one canonical knowledge/evidence state rather than new parallel truth stores.

No production implementation is authorized by this supplement.
