# KeyFlowOS Contradiction Register — Workflow Control Plane Supplement

Status: CANONICAL CONTINUATION AFTER `09H-CONTRADICTION-REGISTER-MISSED-SCHEDULE-SUPPLEMENT.md`

Identifier correction: C096 was already canonically allocated to missed-schedule semantics. This supplement therefore continues at C097.

---

## C097 — user-visible workflow disabled state vs still-live commerce execution paths

**Status:** VERIFIED ACTIVE CONTRADICTION

The Cross-Module Intelligence UI tells users that disabling a workflow stops it from running.

Observed commerce-backed execution paths for several workflow keys operate in `CommerceIntegrationService` without consulting `CrossModuleWorkflow.enabled`, while generic ScheduledAgentJob consumption also does not re-check the definition's enabled state.

Therefore:

```text
control-plane truth: DISABLED
execution-plane truth: still executable
```

Target resolution: one authoritative WorkDefinition/control contract must dominate occurrence creation and, according to explicit policy, pending future execution.

Affected kernels: K3, K5, K7, K8, K11.
Affected journeys: J6, J9, J10, J18, J23.

---

## C098 — user-configurable workflow delay vs hard-coded runtime schedule

**Status:** VERIFIED ACTIVE CONTRADICTION

Cross-Module workflow definitions expose `reviewDelayDays` and `reorderDelayDays`, and the UI persists user changes.

The observed post-purchase scheduler does not read those values; it uses fixed 3-day and 30-day delays.

Therefore:

```text
configuration truth: user-selected delay
runtime truth: hard-coded delay
```

Target resolution: occurrence creation binds to an authoritative versioned WorkDefinition whose resolved configuration is recorded or derivable for the occurrence.

Affected kernels: K5, K7, K8.
Affected journeys: J10, J23.

---

# Pool law

```text
DECLARED CONTROL PLANE
must equal
LOAD-BEARING EXECUTION POLICY

USER CONFIGURATION
must equal
RUNTIME DEFINITION INPUT
```

No production implementation is authorized by this supplement.
