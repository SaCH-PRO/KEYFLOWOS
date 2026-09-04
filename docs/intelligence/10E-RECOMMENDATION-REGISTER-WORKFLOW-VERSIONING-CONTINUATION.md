# KeyFlowOS Recommendation Register — Workflow Versioning Continuation

Status: CANONICAL CONTINUATION OF `10D-RECOMMENDATION-REGISTER-MISSED-SCHEDULE-CONTINUATION.md`

Implementation baseline: `main@d7c5b86cfa276d75ffa42d5f1707c43704dc9f21`

Canonical recommendation sequence continues after KF-REC-045.

---

## KF-REC-046 — Version workflow definitions and explicitly bind/migrate waiting occurrences

**Status:** PROVISIONAL / HIGH-CONFIDENCE TARGET

**Primary kernels:** K7 Temporal/Event/Workflow, K6 State Transition

Every long-lived work definition should expose enough identity/version lineage to answer:

```text
which definition/version created this occurrence?
was that definition changed later?
did the occurrence retain old semantics, migrate, or become superseded?
was the exact action materially changed?
does prior control remain valid?
```

Conceptual mutation policies:

```text
KEEP_V1
MIGRATE_TO_V2
SUPERSEDE_AND_REDERIVE
LATEST_AT_EXECUTION
REQUIRE_RECONTROL
```

The policy must be explicit by work type. Do not silently rely on old payload snapshots or mutable-latest rows.

Where material action parameters change, reuse:

- KF-REC-023 ActionEnvelope + fingerprint;
- KF-REC-026 exact-action Clearance + invalidation;
- KF-REC-038 Durable WorkOccurrence semantic contract.

Possible semantic fields:

```text
DefinitionId
DefinitionVersion
OccurrenceId
CreatedFromDefinitionVersion
ActionFingerprint
Supersedes/SupersededBy
MigrationReason
ControlVersion/Fingerprint reference where applicable
```

These fields do not require one universal new table; existing domain records/revisions may implement them.

Affected journeys: J6, J9, J15, J18, J23 and future long-lived configurable workflows.

---

# Promotion rule

Before implementation:

- enumerate mutable workflow definitions that create future work;
- classify desired pending-occurrence policy for definition edit/disable;
- distinguish configuration revision from exact action mutation;
- preserve control invalidation on material action changes;
- prove migration/supersession cannot duplicate effects;
- preserve historical inspectability across deployments.

No production implementation is authorized by this continuation.
