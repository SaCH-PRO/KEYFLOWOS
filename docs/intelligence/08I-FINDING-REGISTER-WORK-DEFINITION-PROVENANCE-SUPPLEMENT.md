# KeyFlowOS Finding Register — Work Definition Provenance Supplement

Status: CANONICAL CONTINUATION OF `08H-FINDING-REGISTER-WORKFLOW-CONTROL-PLANE-SUPPLEMENT.md`

Implementation baseline: `main@5ec358e9b792817eda1e37fd80a0574eb7905a8a`

Canonical sequence continues after F147.

Identifier correction: F147 is now canonically used by workflow timing-configuration bypass after resolving a concurrent F145 allocation. This provenance finding is therefore F148.

---

## F148 — CrossModuleWorkflow mutations are unversioned and ScheduledAgentJob occurrences do not preserve definition/config provenance

**Status:** VERIFIED DATA-MODEL / TEMPORAL-PROVENANCE FINDING

Current `CrossModuleWorkflow` shape includes:

```text
workflowKey
enabled
config
lastRunAt
runCount
createdAt
updatedAt
```

No definition/version identity was observed.

Current `ScheduledAgentJob` shape includes:

```text
jobType
entityId
checkpoint
status
payload
scheduledFor
executedAt
```

No reference to the `CrossModuleWorkflow` row, definition version, resolved configuration version, or supersession policy was observed.

Configuration is mutated in place through `updateWorkflow()`.

Therefore, after a workflow definition/configuration changes, a pending scheduled occurrence cannot durably prove:

- which definition/config version created it;
- whether it should be grandfathered;
- whether it should be revalidated against current config;
- whether it should migrate;
- whether it should be cancelled/superseded;
- whether its eventual historical behavior matched the user-visible configuration at creation time.

Payload snapshots can preserve some action parameters, but they are not a canonical WorkDefinition provenance contract and do not encode the governing definition state/version.

Target law:

> Every long-lived occurrence must be traceable to the definition version/configuration/policy that caused it to exist, while current-state policy may still invalidate or supersede it before effect.

Affected kernels: K5, K7, K8, K11.
Affected journeys: J6, J9, J10, J18, J23.

---

# Existing target linkage

This finding directly supports KF-REC-046 and KF-REC-047.

Do not create a new versioning subsystem automatically. First determine whether existing definition rows can gain immutable revision/provenance semantics without creating a parallel workflow source of truth.

No production implementation is authorized by this supplement.
