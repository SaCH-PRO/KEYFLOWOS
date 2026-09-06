# KeyFlowOS Contradiction Register — Taxonomy Reconciliation Supplement

Status: CANONICAL CONTINUATION AFTER J16/K4 C111–C116

Canonical sequence continues after C116.

This file resolves genuine semantic roots that had collided numerically in parallel historical supplements. `04B-CANONICAL-ID-ALLOCATION-LEDGER.md` governs the remapping.

---

## C117 — user-visible workflow disabled state vs still-live execution paths

**Status:** VERIFIED ACTIVE CONTRADICTION

The Cross-Module control plane can represent a workflow as disabled while observed commerce-backed execution paths can remain eligible because they do not consume that authoritative enabled state.

```text
control-plane truth: DISABLED
execution-plane truth: still executable
```

Target resolution: one load-bearing WorkDefinition/control contract dominates occurrence creation and explicit pending-work invalidation/revalidation policy.

Affected kernels: K3, K5, K7, K8, K11.
Affected journeys: J6, J9, J10, J18, J23.

---

## C118 — user-configurable workflow delay vs hard-coded runtime schedule

**Status:** VERIFIED ACTIVE CONTRADICTION

The user-facing definition stores configurable review/reorder delays while the observed runtime scheduler uses fixed values.

```text
configuration truth: user-selected delay
runtime truth: hard-coded delay
```

Target resolution: occurrence creation consumes one authoritative versioned definition/configuration.

Affected kernels: K5, K7, K8.
Affected journeys: J10, J23.

---

## C119 — recurring schedule phase vs worker recovery time

**Status:** VERIFIED ACTIVE CONTRADICTION

DelegationLoop can derive the next recurrence from actual processing time after a late run, causing worker outage/recovery to redefine future schedule phase even when the declared interval did not change.

Target resolution: recurrence phase and coalescing/drift policy are explicit WorkDefinition semantics.

Affected kernels: K7, K8, K11.
Affected journeys: J6, J18, J23.

---

## C120 — one recurring-invoice occurrence vs multiple replica-created financial effects

**Status:** VERIFIED DISTRIBUTED-CONCURRENCY CONTRADICTION

A process-local guard cannot ensure that one logical recurring-invoice due occurrence is claimed by only one application replica before invoice creation.

```text
one logical due occurrence
vs
potentially multiple invoices / financial effects
```

Target resolution: stable recurrence-occurrence identity + atomic distributed claim + explicit misfire policy.

Affected kernels: K7, K8, K10, K11.
Affected journeys: J7, J10, J18, J23.

---

## C121 — stable internal delivery identity vs unstable provider effect identity

**Status:** VERIFIED ACTIVE CONTRADICTION

OutboundDelivery can preserve one KeyFlow delivery identity while retries through the shared adapter contract can issue fresh provider requests without a stable provider idempotency identity.

```text
KeyFlow truth: same logical delivery/effect
provider request truth: potentially new effect request
```

Target resolution: bind stable EffectId to provider-native idempotency where supported; otherwise reconcile ambiguity before unsafe retry.

Affected kernels: K7, K8, K9, K11.
Affected journeys: J5, J9, J14, J18, J23.

---

## C122 — multi-stage Instagram provider state vs opaque whole-operation retry

**Status:** VERIFIED ACTIVE CONTRADICTION

Instagram publishing can create a provider container before the final publish call, but the intermediate provider checkpoint is not durably represented in the observed flow.

```text
provider truth: stage 1 may exist / stage 2 may be uncertain
local recovery truth: retry whole opaque publish
```

Target resolution: durable provider-stage checkpoint + stage-aware resume/reconciliation.

Affected kernels: K8, K9, K11.
Affected journeys: J9, J14, J18, J23.

---

## C123 — durable scheduled-work failure vs absent canonical recovery ownership

**Status:** VERIFIED RECOVERY-OWNERSHIP CONTRADICTION

A ScheduledAgentJob can become failed/terminal while the system lacks one explicit recovery owner for deciding whether the same logical occurrence should retry, reconcile, stop, expire or be superseded.

This does not require one universal recovery worker. It requires every work fabric to map its failure state into the shared KF-REC-048 recovery semantics.

Affected kernels: K7, K8, K11.
Affected journeys: J6, J18, J23.

---

## C124 — one failed logical effect vs multiple possible compensation owners

**Status:** VERIFIED RECOVERY-OWNERSHIP CONTRADICTION

More than one compensation mechanism can be capable of reacting to the same failed logical step without one canonical RecoveryIntent/RecoveryEffect ownership boundary.

```text
one failed effect
vs
two mechanisms each believing inverse/mitigating action is theirs
```

Target resolution: one recovery identity/owner per logical inverse or mitigating effect; other surfaces reference the same recovery state.

Affected kernels: K3, K6, K8, K11.
Affected journeys: J2, J15, J18, J23.

---

# Alias / strengthened evidence references

These historical collisions are not new contradiction roots:

- mutable definition / missing occurrence provenance old C099 → canonical C097;
- cross-provider ambiguous outcome old C102 → canonical C099;
- compensation result overwritten by generic failure old C106 → canonical C104;
- control/recurrence refinement duplicates → canonical C117–C120.

No production implementation is authorized by this supplement.
