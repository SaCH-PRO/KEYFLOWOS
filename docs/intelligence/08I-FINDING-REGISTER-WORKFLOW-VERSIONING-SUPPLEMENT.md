# KeyFlowOS Finding Register — Workflow Versioning Supplement

Status: CANONICAL CONTINUATION OF `08H-FINDING-REGISTER-MISSED-SCHEDULE-SUPPLEMENT.md`

Implementation baseline: `main@d7c5b86cfa276d75ffa42d5f1707c43704dc9f21`

Canonical sequence continues after F145.

---

## F146 — CrossModuleWorkflow mutation/disable does not explicitly version, migrate or invalidate already-created scheduled occurrences

**Status:** VERIFIED CODE-LEVEL / TEMPORAL-VERSIONING FINDING

`CrossModuleWorkflow` stores mutable `enabled/config` but no observed definition version. `updateWorkflow()` can mutate those values.

Future `ScheduledAgentJob` rows created from the workflow snapshot derived settings into their payload. Later execution uses the persisted job payload and does not reload the current workflow enabled/config state.

Thus definition mutation/disable does not have an explicit contract for already-created occurrences. Old semantics may continue to execute without visible version/migration lineage.

This does not assume that disabling a workflow must always cancel pending work; the defect is that the policy is implicit.

Target law:

> Waiting work is explicitly bound to a definition version and follows a declared migration/supersession policy when the definition changes.

Affected kernels: K3, K5, K6, K7, K8, K11.
Affected journeys: J6, J9, J18, J23.

---

## F147 — Scheduled EmailCampaign effect can materially drift after scheduling because execution reads mutable current campaign state

**Status:** VERIFIED CODE-LEVEL / ACTION-VERSIONING FINDING

A campaign can be placed in `SCHEDULED` state and later mutated through `updateCampaign()` without an observed status/version guard preventing changes to subject, body, segment filter or scheduled time.

At send time, `sendCampaign()` claims the row and then reads the current mutable campaign state and current audience selection.

Therefore the effect eventually executed is not durably bound to an immutable scheduled action/version.

This may be acceptable product behavior when users intentionally edit a scheduled campaign, but the temporal system does not persist whether the original occurrence was updated, superseded or re-derived.

Where prior human control applies, material action mutation must reuse existing ActionEnvelope fingerprint / Clearance invalidation laws rather than inheriting stale control.

Target law:

> A scheduled material action has inspectable action/version identity; mutation either updates that identity with explicit lineage or supersedes/re-derives the occurrence.

Affected kernels: K3, K6, K7, K8, K11.
Affected journeys: J9, J15, J18, J23.

---

# Pool law

```text
DEFINITION V1
→ OCCURRENCE O
→ DEFINITION V2
→ explicit KEEP_V1 | MIGRATE | SUPERSEDE | REDERIVE | RECONTROL
```

Silent old-snapshot and silent mutable-latest semantics are both insufficient.

No production implementation is authorized by this supplement.
