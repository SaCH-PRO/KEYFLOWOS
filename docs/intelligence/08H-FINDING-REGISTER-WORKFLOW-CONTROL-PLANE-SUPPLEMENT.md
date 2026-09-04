# KeyFlowOS Finding Register — Workflow Control Plane Supplement

Status: CANONICAL CONTINUATION OF `08G-FINDING-REGISTER-CANCELLATION-SUPERSESSION-SUPPLEMENT.md`

Implementation baseline: `main@5ec358e9b792817eda1e37fd80a0574eb7905a8a`

The move from `d7c5b86c...` to `5ec358e9...` contains only audit/state documentation changes; inspected implementation code is unchanged.

Canonical sequence continues after F144.

---

## F145 — Cross-Module workflow enable/disable control is not load-bearing for observed commerce-backed workflow paths

**Status:** VERIFIED CROSS-SURFACE / CONTROL-PLANE FINDING

The shipped Cross-Module Intelligence UI states:

> Disabling a workflow stops it from running but preserves your configuration.

The UI writes `CrossModuleWorkflow.enabled` through `updateCrossModuleWorkflow()`.

`WORKFLOW_DEFINITIONS` exposes commerce workflow keys including:

```text
store_order_crm_sync
store_order_revenue
store_order_refund_expense
post_purchase_review_request
post_purchase_reorder_prompt
inventory_low_alert
inventory_out_alert
purchase_order_expense
preorder_delay_notice
```

Observed execution for these concepts is implemented in `CommerceIntegrationService` event handlers / scheduled-job processors.

No `CrossModuleWorkflow.enabled` / `isWorkflowEnabled()` check was observed in that service.

For post-purchase jobs, `CrossModuleAgentService.processScheduledJobs()` also consumes the same ScheduledAgentJob types without rechecking the workflow enabled state at execution time.

Therefore a workflow can be shown as disabled in the control UI while corresponding commerce event/scheduled paths remain able to run.

This is not merely a stale-job question. It is a declared-control-plane vs execution-plane disconnect.

Target law:

> A user-visible control that claims to disable a workflow must dominate every material execution path owned by that workflow definition, including new occurrence creation and policy-defined already-pending work.

Affected kernels: K3, K5, K7, K8, K11.
Affected journeys: J6, J9, J10, J18, J23.

---

## F146 — Post-purchase workflow timing configuration is exposed to users but bypassed by the live scheduler

**Status:** VERIFIED PRODUCT-CONTRACT / TEMPORAL-CONFIGURATION FINDING

`WORKFLOW_DEFINITIONS` advertises configurable values:

```text
post_purchase_review_request.reviewDelayDays default 3
post_purchase_reorder_prompt.reorderDelayDays default 30
```

The UI allows users to update those configuration fields and persists them on `CrossModuleWorkflow.config`.

`CommerceIntegrationService.handleOrderDelivered()` does not load that workflow config. Its scheduling helpers use fixed values:

```text
reviewDelayMs  = 3  * 24h
reorderDelayMs = 30 * 24h
```

Thus changing the visible delay configuration does not alter the observed live post-purchase scheduler.

Target law:

> A configuration exposed as controlling runtime behavior must be part of the authoritative versioned WorkDefinition consumed by occurrence creation; otherwise it is not configuration truth.

Affected kernels: K5, K7, K8.
Affected journeys: J10, J23.

---

# Architectural implication

The correct target is not to scatter `if enabled` checks everywhere.

Define a load-bearing WorkDefinition / workflow policy contract:

```text
Workflow Definition
  key
  version
  enabled/state
  config
  ownership
  trigger
  occurrence policy
  cancellation policy
  migration/supersession policy
        ↓
Occurrence creation resolves authoritative definition version
        ↓
Execution revalidates definition/invalidation policy where required
```

Specialized domain executors may remain separate; they must consume the same authoritative control-plane meaning.

No production implementation is authorized by this supplement.
