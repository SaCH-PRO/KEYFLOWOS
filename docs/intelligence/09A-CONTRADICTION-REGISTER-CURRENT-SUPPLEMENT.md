# KeyFlowOS Contradiction Register — Current Supplement

Status: CANONICAL CONTINUATION OF `09-CONTRADICTION-REGISTER.md`

Purpose: preserve newly pooled contradictions without risking whole-file truncation of the large canonical register through connector replacement. This file is part of the canonical contradiction register until the next safe compaction/export pass.

Canonical sequence continues after C047.

---

## C048 — direct authority editor vs alternate authority constructors

**Status:** VERIFIED ACTIVE CONTRADICTION

Direct Membership permission editing requires `team:admin`, while semantically equivalent or stronger authority can be constructed through `team:write` paths such as:

- promotion to ADMIN;
- creation/assignment of a powerful JobRole;
- creation of DelegationRule.

This demonstrates that route-level module verbs are not a coherent grantability algebra.

Target resolution: capability-level authority mutation semantics + Effective Authority Resolver + grantability checks, not strengthening one route in isolation.

---

## C049 — backend-significant payload vs human-visible approval data

**Status:** VERIFIED ACTIVE CONTRADICTION

ApprovalRequest and AiPlan carry structured fields that materially affect policy/execution, while their primary approval screens omit some of those fields from the authorization moment.

The backend can therefore reason about data that the approver has not actually been shown.

Target resolution: `ControlPresentation` derived from the same exact ActionEnvelope/normalized data consumed by policy and execution.

---

## C050 — canonical proposal direction vs visible KEY Actions regime

**Status:** VERIFIED ACTIVE CONTRADICTION

KeyActionProposal is the intended convergence/canonical proposal direction, while the primary `/app/approvals -> KEY Actions` product UI directly lists and resolves live AiApprovalItem records.

This means proposal migration is a user-facing compatibility problem, not only backend cleanup.

Target resolution must preserve live UX while normalizing control evidence; do not delete AiApprovalItem until its consumers have migrated/proven replacement.

---

## C051 — significant detail availability vs authorization-moment acknowledgement

**Status:** VERIFIED ACTIVE CONTRADICTION

AiApprovalItem significant fields are available in an optional SideSheet, but the user can approve from the list and the final dialog repeats only the title.

The product can therefore claim an approval even when significant action data was never acknowledged at the actual decision moment.

Target resolution: concise significant-action summary at the authorization moment, with optional raw detail—not mandatory JSON dumping.

---

# Priority linkage

C048 feeds K2/K3 grantability and control-plane authority convergence.

C049–C051 feed K3/K5/K8 exact-action ControlPresentation/ControlEvidence convergence and J15/J2/J23.

No production implementation is authorized by this supplement.
