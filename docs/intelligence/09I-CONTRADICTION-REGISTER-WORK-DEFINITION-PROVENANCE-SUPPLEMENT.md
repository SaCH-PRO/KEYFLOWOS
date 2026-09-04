# KeyFlowOS Contradiction Register — Work Definition Provenance Supplement

Status: CANONICAL CONTINUATION OF `09H-CONTRADICTION-REGISTER-WORKFLOW-CONTROL-PLANE-SUPPLEMENT.md`

Canonical sequence continues after C097.

---

## C098 — mutable workflow definition vs unversioned long-lived occurrence provenance

**Status:** VERIFIED ACTIVE CONTRADICTION

CrossModuleWorkflow configuration can change in place, while ScheduledAgentJob occurrences do not preserve the governing definition/configuration version.

Thus:

```text
current definition: mutable/latest
pending occurrence: long-lived historical intent
provenance link: insufficient
```

The system cannot durably explain whether the occurrence belongs to the previous definition, the current definition, or a migrated/superseded policy.

Target resolution: long-lived work records the immutable definition/revision provenance that created it, while explicit pending-occurrence policy determines whether current definition changes grandfather, revalidate, migrate, supersede or cancel it.

Affected kernels: K5, K7, K8, K11.
Affected journeys: J6, J9, J10, J18, J23.

No production implementation is authorized by this supplement.
