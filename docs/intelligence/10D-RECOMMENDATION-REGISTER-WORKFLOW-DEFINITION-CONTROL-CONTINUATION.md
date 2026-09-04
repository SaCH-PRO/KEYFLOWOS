# KeyFlowOS Recommendation Register — Workflow Definition Control Continuation

Status: CANONICAL CONTINUATION OF `10C-RECOMMENDATION-REGISTER-CANCELLATION-SUPERSESSION-CONTINUATION.md`

Implementation baseline: `main@5ec358e9b792817eda1e37fd80a0574eb7905a8a`

Canonical recommendation sequence continues after KF-REC-044.

---

## KF-REC-045 — Make WorkDefinition / workflow policy a load-bearing control-plane contract

**Status:** PROVISIONAL / HIGH-CONFIDENCE TARGET

A workflow definition exposed to users should be authoritative for the workflow it names.

Target contract:

```yaml
work_definition:
  definition_id: ...
  key: ...
  version: ...
  owner: ...
  trigger: ...
  enabled_state: ENABLED|DISABLED|PAUSED|RETIRED
  config: ...
  occurrence_policy: ...
  cancellation_policy: ...
  supersession_policy: ...
  authority_policy_ref: ...
  created_at: ...
  effective_at: ...
```

Every producer of a logical occurrence resolves the same authoritative definition semantics before creating work.

Every executor can prove which definition/version produced the occurrence and, where policy requires, whether that definition remains executable.

The target does not require one physical table immediately. Existing `CrossModuleWorkflow`, DelegationLoop, Flow/Automation, AiPlan and other definition models may implement the shared semantic contract during migration.

Affected kernels: K3, K5, K7, K8, K11.
Affected journeys: J6, J9, J10, J15, J18, J23.

---

## KF-REC-046 — Version workflow definitions and define pending-occurrence behavior explicitly

**Status:** PROVISIONAL / TARGET-STATE REFINEMENT

Changing workflow configuration or disabling a definition creates a temporal question: what happens to work already scheduled under the previous definition?

Do not let this emerge accidentally from current code.

Each WorkDefinition should declare a pending-occurrence policy such as:

```text
GRANDFATHER
  existing occurrences retain their captured definition version

REVALIDATE
  existing occurrences remain but must re-evaluate current definition/policy before effect

MIGRATE
  pending occurrences are explicitly migrated to a newer compatible definition version

SUPERSEDE
  old pending occurrences become non-executable and replacement occurrences may be created

CANCEL
  pending occurrences are cancelled, preserving history
```

Policy may vary by workflow and change type.

Examples:

- changing a cosmetic email template may permit migration;
- narrowing customer-contact policy should revalidate/cancel future outreach;
- disabling an automation whose UI says "stops it from running" should not silently leave future effects live;
- materially changing exact action parameters after approval may require re-control rather than migration.

Every occurrence should be traceable to the definition version/configuration that governed its creation.

Affected kernels: K3, K5, K7, K8, K11.
Affected journeys: J6, J9, J10, J15, J18, J23.

---

# Design principle

```text
DEFINITION STATE
→ controls occurrence creation

DEFINITION VERSION
→ explains why occurrence exists

PENDING-OCCURRENCE POLICY
→ controls what definition changes do to existing future work

EXECUTION-TIME REVALIDATION
→ prevents stale assumptions crossing the effect boundary
```

Do not scatter ad-hoc `enabled` checks as the end state. Strengthen the existing control-plane seams into a coherent contract.

No production implementation is authorized by this continuation.
