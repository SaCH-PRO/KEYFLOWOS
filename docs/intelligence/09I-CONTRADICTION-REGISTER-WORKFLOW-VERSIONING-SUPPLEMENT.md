# KeyFlowOS Contradiction Register — Workflow Versioning Supplement

Status: CANONICAL CONTINUATION OF `09H-CONTRADICTION-REGISTER-MISSED-SCHEDULE-SUPPLEMENT.md`

Canonical sequence continues after C096.

---

## C097 — old-snapshot temporal semantics vs mutable-latest temporal semantics

**Status:** VERIFIED SYSTEMIC CONTRADICTION

Current temporal fabrics disagree on what happens when a definition changes after future work is scheduled:

```text
CrossModuleWorkflow → ScheduledAgentJob
  old derived payload survives later definition mutation

EmailCampaign
  scheduled effect reads latest mutable campaign state at send time
```

Neither path persists an explicit definition/action version and migration policy.

The system therefore cannot answer consistently:

> What exactly was scheduled, and which changes are allowed before execution?

Target resolution:

```text
DefinitionVersion
+ Occurrence binding
+ Action fingerprint where material
+ explicit mutation policy
→ KEEP | MIGRATE | SUPERSEDE | REDERIVE | RECONTROL
```

Affected kernels: K3, K5, K6, K7, K8, K11.
Affected journeys: J6, J9, J15, J18, J23.

No production implementation is authorized by this supplement.
