# KeyFlowOS Finding Register — Taxonomy Reconciliation Supplement

Status: CANONICAL CONTINUATION AFTER J16/K4 F161–F166

Implementation baseline: `main@168732d0e2226e11ed033c14fbdf7b3ea5344a41`

Canonical sequence continues after F166.

This file exists because parallel historical supplements created colliding F-IDs. `04B-CANONICAL-ID-ALLOCATION-LEDGER.md` governs remapping.

---

## F167 — Cross-Module workflow disable control is not load-bearing for observed commerce-backed execution paths

**Status:** VERIFIED CROSS-SURFACE / CONTROL-PLANE FINDING

`CrossModuleWorkflow.enabled` can be changed through the user-visible control plane, while observed commerce event/scheduled execution paths can proceed without consulting that enabled state.

Target law: a user-visible workflow control must dominate every material execution path owned by the definition, including creation of new occurrences and policy-defined invalidation/revalidation of pending work.

Affected kernels: K3, K5, K7, K8, K11.
Affected journeys: J6, J9, J10, J18, J23.

---

## F168 — User-configurable post-purchase workflow delays are bypassed by hard-coded runtime scheduling

**Status:** VERIFIED PRODUCT-CONTRACT / TEMPORAL-CONFIGURATION FINDING

Cross-Module workflow definitions expose configurable review/reorder delays, but observed commerce scheduling uses fixed 3-day / 30-day values rather than the persisted workflow configuration.

Target law: visible configuration that claims to control runtime must be part of the authoritative WorkDefinition consumed by occurrence creation.

Affected kernels: K5, K7, K8.
Affected journeys: J10, J23.

---

## F169 — DelegationLoop silently coalesces missed recurrences and shifts future cadence to worker recovery time

**Status:** VERIFIED CODE-LEVEL / RECURRENCE-SEMANTIC FINDING

After a late run, DelegationLoop derives the next run from `Date.now() + interval` rather than the prior schedule phase. Missed logical intervals can collapse into one run and future phase drifts to actual processing time.

Target law: recurrence phase, coalescing and misfire policy are explicit WorkDefinition semantics; worker recovery time must not silently redefine the schedule.

Affected kernels: K7, K8, K11.
Affected journeys: J6, J18, J23.

---

## F170 — RecurringInvoice lacks a distributed due-occurrence claim, allowing duplicate financial effects for one logical recurrence

**Status:** VERIFIED CODE-PATTERN / FINANCIAL-CONCURRENCY FINDING

The processor preserves schedule phase but uses only a process-local running flag. No distributed due-occurrence claim/uniqueness boundary was observed before invoice creation.

Target law: every financial recurrence has a stable scheduled occurrence identity and atomic ownership before material financial consequence creation.

Affected kernels: K7, K8, K10, K11.
Affected journeys: J7, J10, J18, J23.

---

## F171 — Stable OutboundDelivery identity is not mapped to stable provider-effect idempotency identity

**Status:** VERIFIED CROSS-LAYER / EXTERNAL-RECOVERY FINDING

`OutboundDelivery` preserves one internal delivery identity across retries, but the shared `ChannelAdapter.publish(...)` contract has no first-class EffectId/provider-idempotency input. Retries may therefore create fresh provider requests even where providers support idempotency semantics.

Target law: stable KeyFlow EffectId maps to provider-native idempotency where available; ambiguous external outcomes reconcile before unsafe fresh effects.

Affected kernels: K7, K8, K9, K11.
Affected journeys: J5, J9, J14, J18, J23.

---

## F172 — Instagram publishing is a multi-stage external operation without durable provider-stage checkpoints

**Status:** VERIFIED CODE-LEVEL / PARTIAL-EXTERNAL-OPERATION FINDING

Observed flow is container creation followed by publish. The stage-1 provider container ID is held only in function scope. Failure/ambiguity after container creation causes the whole operation to be retried from the beginning.

Target law: multi-stage provider effects persist stage checkpoints and resume/reconcile from the last safe state rather than blindly replaying the entire external operation.

Affected kernels: K8, K9, K11.
Affected journeys: J9, J14, J18, J23.

---

## F173 — ScheduledAgentJob first-attempt failure can terminalize work without a generic durable recovery owner

**Status:** VERIFIED RECOVERY-OWNERSHIP FINDING

Historical scheduled-recovery analysis found generic scheduled work can reach failed/terminal state after a processing failure without one canonical cross-domain recovery owner that preserves the same occurrence/effect identity and decides retry/reconcile/stop semantics.

This does not justify a universal recovery worker. It reinforces KF-REC-048: each existing work fabric must map into the shared recovery semantic contract.

Affected kernels: K7, K8, K11.
Affected journeys: J6, J18, J23.

---

## F174 — More than one compensation mechanism can target the same failed logical step without a canonical compensation owner

**Status:** VERIFIED RECOVERY-OWNERSHIP / DUPLICATE-INVERSE-EFFECT FINDING

Historical compensation analysis identified overlapping compensation mechanisms around the same failed logical work. Without one recovery ownership/identity rule, two mechanisms can each believe they should create the inverse/mitigating effect.

Target law:

```text
ONE FAILED LOGICAL EFFECT
→ one canonical RecoveryIntent / RecoveryEffect identity
→ one compensation/reversal owner
→ all other surfaces observe/reference that recovery
```

This strengthens KF-REC-048 and the J18 Recovery Clearance Loop; it does not imply one universal compensation service.

Affected kernels: K3, K6, K8, K11.
Affected journeys: J2, J15, J18, J23.

---

# Alias / strengthened evidence references

The following colliding historical findings are **not new roots**:

- work-definition provenance old F148 → canonical F146;
- cross-provider ambiguous-outcome old F151 → canonical F149;
- planner compensation outcome overwrite old F156 → canonical F154;
- control/recurrence refinement duplicates → canonical F167–F170.

No production implementation is authorized by this supplement.
