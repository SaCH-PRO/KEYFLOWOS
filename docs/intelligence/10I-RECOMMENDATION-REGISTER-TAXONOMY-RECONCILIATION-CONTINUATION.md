# KeyFlowOS Recommendation Register — Taxonomy Reconciliation Continuation

Status: CANONICAL CONTINUATION AFTER KF-REC-049

Canonical sequence continues after KF-REC-049.

This file resolves a historical recommendation-ID collision. `04B-CANONICAL-ID-ALLOCATION-LEDGER.md` governs the allocation.

---

## KF-REC-050 — Make user-visible WorkDefinition controls load-bearing across occurrence creation and execution

**Status:** PROVISIONAL / HIGH-CONFIDENCE TARGET

**Primary kernels:** K3 Governance, K5 Capability/Definition, K7 Temporal/Workflow
**Secondary kernels:** K8 Evidence, K11 Recovery/Reliability

KeyFlowOS exposes workflow enablement/configuration that can currently diverge from the runtime paths the controls claim to govern.

The target is not scattered `if enabled` checks. It is one authoritative, versioned definition/control contract consumed by every material path owned by that workflow.

Conceptual contract:

```text
WorkDefinition
  DefinitionId
  Version
  owner
  trigger
  enabled state
  configuration
  occurrence policy
  lateness/misfire policy
  concurrency policy
  cancellation/supersession policy
  authority/control policy ref
  effective time
        ↓
Occurrence creation resolves exact definition version
        ↓
Occurrence records governing version/provenance
        ↓
current policy revalidation where required
        ↓
execute | wait | migrate | supersede | cancel | re-control
```

### A. Control-plane meaning is load-bearing

```text
USER SAYS DISABLED
→ no new work may bypass that definition through a parallel path
```

Pending work follows an explicit policy rather than an implicit assumption:

```text
KEEP_EXISTING
CANCEL_PENDING
SUPERSEDE
REVALIDATE_AT_EXECUTION
MIGRATE
REQUIRE_RECONTROL
```

### B. Visible configuration is runtime configuration

A delay, threshold or policy exposed to the user as controlling a workflow must be consumed by occurrence creation/execution from the authoritative definition version.

```text
DECLARED CONFIGURATION
== GOVERNING RUNTIME INPUT
```

### C. Definition provenance composes with KF-REC-046

KF-REC-050 does not replace the preserved workflow-versioning recommendation.

Relationship:

```text
KF-REC-045
explicit lateness / misfire policy
        ↓
KF-REC-046
version definitions + bind waiting occurrences
        ↓
KF-REC-050
make the versioned definition/control plane load-bearing
        ↓
KF-REC-047
project resulting work state for users/operators
```

### D. Recovery composes with KF-REC-048

If a definition changes after an effect attempt has begun, the new control-plane state does not rewrite external reality. Existing effect/recovery identity, provider certainty and Recovery Clearance semantics still govern safe continuation.

### E. Do not create a universal workflow engine from this recommendation

Specialized domain executors may remain specialized.

The invariant is shared control semantics and provenance, not one physical runtime.

## Findings directly addressed

- F167 workflow disable is not load-bearing;
- F168 user-visible delay configuration is bypassed;
- strengthened F146 definition-version provenance;
- related F169 recurrence semantics.

## Contradictions directly addressed

- C117 disabled control plane vs live execution;
- C118 configured delay vs hard-coded runtime;
- strengthened C097 definition/version inconsistency.

## Promotion criteria

Before implementation:

- inventory every user-visible workflow/control definition and its actual execution paths;
- define authoritative owner for each workflow key;
- bind occurrence creation to exact definition/version/configuration;
- specify pending-work semantics for disable/edit/delete;
- integrate current authority/Clearance for material definition mutation;
- prove no parallel executor bypasses the definition;
- prove definition mutation cannot silently inherit stale control over materially changed actions;
- preserve domain-specific executors and provider semantics where appropriate;
- define compatibility/migration for live CrossModuleWorkflow and ScheduledAgentJob rows.

No production implementation is authorized by this recommendation.
