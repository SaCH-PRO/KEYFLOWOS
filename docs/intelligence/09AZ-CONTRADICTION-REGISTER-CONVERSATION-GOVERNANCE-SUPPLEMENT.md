# KeyFlowOS Contradiction Register — Conversation Governance Supplement

Status: CANONICAL CONTINUATION OF the KeyFlowOS contradiction register after C172.

Implementation evidence baseline: `main@8f173bfe79f1418159cf4099ea18b0d60d203ec2`.

Canonical sequence continues after C172.

---

## C173 — “quick confirmation required” can coexist with `autoApproved=true` and autonomous execution

**Observed implementation claims**

`AiOversightService.evaluate()` can declare a Tier-2 action to require quick confirmation.

`evaluateAutoApproval()` can then return `autoApproved=true` when caller-supplied confidence is greater than 0.9, while preserving the earlier `requiresQuickConfirm=true` field.

`ConversationalAIService` executes when `autoApproved` is true and does not require actual quick-confirm evidence.

**Contradiction**

```text
CONTROL REQUIRED: QUICK_CONFIRM
AND
NO QUICK-CONFIRM EVIDENCE
AND
MODEL CONFIDENCE > 0.9
→ EXECUTE AUTONOMOUSLY
```

A confidence score is an epistemic/probabilistic signal, not proof that a human control occurred.

Target: required control must be satisfied by valid ControlEvidence or removed by an explicit pre-existing standing policy/delegation decision; model confidence alone cannot satisfy it.

Related finding: F223.
Affected journeys: J2, J5, J6, J15.

---

## C174 — MessageIntake calls the route “approve” but validates approval authority only after the proposed effects have run

**Observed implementation claims**

MessageIntake creates an `AiApprovalItem` and exposes an authenticated `/approve` route.

The route calls `executePlan()` directly. The plan can create internal business state and external replies. Only after those actions complete does the service call `resolvePendingApproval()`, which invokes the Membership/approval-tier checks in `AiOversightService.resolveApproval()`.

**Contradiction**

```text
product/control meaning: APPROVE → AUTHORIZE → EXECUTE
current order:             EXECUTE → AUTHORITY-CHECK APPROVAL
```

If the user lacks the required approval tier, completed child effects are not retroactively unauthorized away; the intake is simply moved to `error` after the fact.

Target: control/authority resolution must precede exact-action clearance and effects.

Related finding: F224.
Affected journeys: J2, J5, J15, J18, J25.

---

No production implementation is authorized by this supplement.
