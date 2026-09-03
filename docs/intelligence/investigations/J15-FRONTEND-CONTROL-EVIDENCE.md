# J15 — Frontend Control-Evidence Forensics

Status: ACTIVE FORENSICS / UX + GOVERNANCE CONVERGENCE

Implementation baseline: `main@d7c5b86cfa276d75ffa42d5f1707c43704dc9f21`

Affected journeys:
- J2 KEY Request → Governed Action
- J15 Approval / Governance Lifecycle
- J23 Temporal Flow / Long-Running Workflow

Affected kernels:
- K3 KEY Authority & Governance
- K5 Capability Fabric
- K7 Temporal / Event / Workflow
- K8 Evidence & Outcome

## Governing question

> What exact material action does the human see, understand and affirm, and is that the same exact action the server later treats as authorized?

This is the user-facing half of ActionEnvelope → ControlEvidence binding.

---

# 1. Visible approval surfaces

Current user-facing regimes found in the primary web app:

```text
/app/approvals
  ├ Team Requests → ApprovalRequest / ApprovalStep
  └ KEY Actions   → AiApprovalItem

/app/plans/:planId
  └ AiPlan / AiPlanStep approval

KEY chat
  └ Flow quick-confirm / KeyPlanCard
```

A repository search in this pass did not find a dedicated `apps/web` KeyActionProposal approval surface.

Classification:

`SEARCH-SCOPED / strengthens F065 + C033`

The current “canonical proposal” migration direction therefore does not yet correspond to the primary visible KEY Action approval UI.

---

# 2. KEY Actions panel — AiApprovalItem

Primary files:

- `apps/web/src/app/app/approvals/components/ai-approvals-panel.tsx`
- `apps/web/src/lib/api/ai-approvals.ts`

The panel is directly wired to:

```text
/ai-approvals/businesses/:businessId/items
/resolve
```

and uses the `AiApprovalItem` type.

This is direct consumer proof that AiApprovalItem remains product-live, not merely backend compatibility residue.

## Favorable detail surface

When the user opens an item SideSheet, it can show:

- title;
- status;
- risk tier label;
- module;
- description;
- rationale;
- expected benefit;
- risks;
- full `inputPayload` JSON;
- full `affectedEntities` JSON;
- resolution metadata.

This is useful raw evidence exposure and should not be lost in convergence.

## F087 — KEY Action can be approved without viewing significant action data

**Status:** VERIFIED UX / CONTROL-EVIDENCE FINDING

The list itself shows only:

- title;
- description/tool name;
- risk label;
- module;
- creation time.

The user can press **Approve** directly from that list row without opening the SideSheet containing `inputPayload` and `affectedEntities`.

A second `ConfirmDialog` appears, but its message contains only the item title:

```text
You are about to approve "<title>". This will apply immediately.
```

It does not restate significant transaction/action data, capability identity, parameters or affected entities.

Therefore the product can collect an approval even when the human has not seen the material fields that make the action distinct.

### Architectural implication

High-impact control UX should present a concise **significant-action summary** at the actual authorization moment.

Raw JSON may remain expandable for expert detail, but the binding-critical data must not require opening an optional detail pane.

---

# 3. Team Requests — ApprovalRequest

Primary files:

- `apps/web/src/app/app/approvals/[id]/page.tsx`
- `apps/web/src/lib/api/approvals.ts`

The client `ApprovalRequest` type explicitly includes:

```text
payload?: Record<string, unknown> | null
```

The detail page renders:

- title;
- request type;
- threshold;
- current step;
- requester;
- free-text description;
- approvers/steps;
- decisions/comments/timestamps;
- created/resolved metadata.

## F088 — ApprovalRequest payload is available to the client but not shown to the approver

**Status:** VERIFIED UX / CONTROL-EVIDENCE FINDING

The detail UI never renders `req.payload`.

This is material because backend workflow logic can inspect payload fields for subject matching and threshold decisions.

The human therefore may approve a request based on title/description/threshold while not seeing the structured data that the backend itself treats as transaction-relevant.

Examples of request types exposed in the UI include:

- quote discount;
- expense;
- refund;
- purchase order;
- content delivery;
- time off;
- evidence verification.

### Architectural implication

Specialized ApprovalRequest workflow remains legitimate, but its presentation should derive a human-readable significant-data view from the same normalized capability/action data that control policy evaluates.

---

# 4. AI Plan approval

Primary files:

- `apps/web/src/app/app/plans/[planId]/page.tsx`
- `apps/web/src/lib/plans.ts`

The browser-side `PlanStep` type already contains:

- `toolName`;
- `module`;
- `action`;
- `description`;
- `riskTier`;
- `requiresApproval`;
- `dependsOn`;
- `inputPayload`;
- expected benefit.

The plan approval page renders before approval:

- plan objective;
- urgency;
- each step's human action;
- each step description;
- a T3/T4 badge only when riskTier >=3.

It does **not** render:

- `toolName`;
- `inputPayload`;
- affected entities/resources;
- exact material parameter bounds;
- plan fingerprint/version.

The draft action is a single button:

```text
Approve & Execute
```

with no dedicated confirmation summary.

## F089 — AI Plan approval omits exact tool and parameter data already available to the browser

**Status:** VERIFIED UX / HIERARCHICAL-CLEARANCE FINDING

The human approves the whole plan from semantic step labels/descriptions while the browser already possesses exact tool and input payload fields that can materially determine side effects.

This means current plan approval cannot satisfy a strong hierarchical-clearance interpretation even at the UX/evidence layer.

This strengthens:

- F038;
- F052;
- F068;
- F078;
- C041;
- KF-REC-029.

### Target implication

Plan approval should not dump raw JSON for every child by default. Instead it should show a generated **bounded approval summary**, e.g.:

```text
Approve plan v17

• Send follow-up email to 24 leads
• Create 3 draft invoices, total <= TT$4,500
• Publish 2 scheduled posts to Instagram
• No refunds / no bank transfers / no contract changes

Higher-impact child details expandable
```

The approved parent fingerprint should bind the actual capability set and bounds behind that summary.

This preserves low-friction product UX while making the authorization meaningful.

---

# 5. Flow quick-confirm — favorable client behavior, server binding still weak

Primary files:

- `apps/web/src/components/key/chat/key-plan-card.tsx`
- `apps/web/src/components/key/chat/use-key-chat-actions.ts`

`KeyPlanCard` renders:

- step description/name;
- risk level;
- expandable exact JSON `step.arguments`.

On Allow/Deny, it passes the **same in-memory**:

```text
step.toolCallId
step.name
step.arguments
```

into `useKeyChatActions.confirmAction()`.

The action then resubmits:

```text
toolCallId
confirmed
toolName
toolArgs
```

to Flow.

## F067 re-analysis — narrowed

**Previous concern:** quick-confirm client may effectively authorize arbitrary caller-supplied action data.

**Current refined conclusion:** the shipped client does display the same action object it later resubmits and server-side Flow re-evaluates governance. This materially narrows the bypass concern.

The remaining architectural weakness is server-side action binding:

> the server accepts reconstructed action identity/args from the confirmation request instead of consuming one immutable pending server-side ActionEnvelope by reference.

This is a binding/integrity weakness, not evidence that the current client intentionally swaps parameters.

### Favorable UX pattern to preserve

The quick-confirm card is close to the desired interaction pattern:

- concise action summary;
- visible risk;
- optional exact details;
- clear Allow/Deny decision.

The target should strengthen the server contract rather than discard this UX.

---

# 6. Cross-surface evidence matrix

| Surface | Object | Significant structured data visible? | Can approve without viewing it? | Exact immutable server binding? |
|---|---|---:|---:|---:|
| KEY Actions list | AiApprovalItem | only in optional SideSheet | YES | NO universal fingerprint |
| KEY Actions SideSheet | AiApprovalItem | inputPayload + affectedEntities | NO if user deliberately opens detail | NO universal fingerprint |
| Team Request detail | ApprovalRequest | payload NOT rendered | YES | NO universal fingerprint |
| AI Plan | AiPlan/AiPlanStep | toolName/inputPayload NOT rendered | YES | NO hierarchical fingerprint |
| KEY quick-confirm | transient Flow confirmation | args expandable | user can choose not to expand but same client object is shown/sent | NO durable server ActionEnvelope |
| Reply approval | AiApprovalItem via messaging | text notification context varies; bare YES response | YES / implicit queue selection | NO exact challenge binding |

This matrix supports one pooled architecture rather than route-local UI fixes.

---

# 7. Standards cross-reference

OWASP Transaction Authorization guidance is directly applicable as a design property:

- identify and acknowledge significant transaction data;
- server-generated/server-controlled authorization data;
- authorization must be unique to the operation;
- material mutation invalidates authorization;
- final execution verifies authorization.

Transferability: **ADOPT / ADAPT**.

KeyFlow-specific translation:

```text
“What You See Is What You Sign”
→ “What You See Is What KEY Executes”
```

The user does not need technical tool names everywhere. The product should present the **material business consequence and bounds**, derived from the exact ActionEnvelope.

---

# 8. New contradiction candidates

## C049 — backend-significant payload vs human-visible approval data

ApprovalRequest and AI Plan carry structured fields that materially affect policy/execution but their approval screens omit those fields.

## C050 — canonical proposal direction vs visible KEY Actions regime

KeyActionProposal is the convergence direction while the primary visible KEY Actions panel directly lists/resolves legacy AiApprovalItem.

## C051 — confirmation detail availability vs authorization-moment summary

AiApprovalItem details can be inspected, but the actual confirmation dialog restates only the title; the UI permits authorization without acknowledging significant fields.

---

# 9. Target Control Presentation primitive

Candidate architecture:

```text
ActionEnvelope
        ↓
ControlPresentation
  actionFingerprint
  capability display name
  business consequence
  significant parameters
  affected resources/entities
  amount/value bounds
  external side effects
  reversibility
  risk/control rationale
  expiry / time sensitivity
        ↓
Channel adapter
  web approval
  plan summary
  KEY quick confirm
  WhatsApp/SMS challenge
        ↓
ControlEvidence
```

This allows every channel to render appropriately without inventing its own interpretation of the action.

A `ControlPresentation` is a candidate semantic contract, not yet a mandate for a new persistence table/service.

---

# 10. Innovation layer

Once exact binding exists, KeyFlow can go beyond conventional approval screens:

### Adaptive significant-data summaries

KEY can explain only the fields that materially changed risk/authority:

```text
“Approve this invoice adjustment?
Amount: TT$2,400 → TT$3,150 (+31%)
Customer: Caribbean Hearing Solutions
Payment terms unchanged
No external payment will be sent.”
```

### Approval-diff UX

If a plan/action changes after review:

```text
“Re-approval required because recipient changed from A to B.”
```

instead of asking the user to re-read everything.

### Explainable friction

```text
“Why am I being asked?”
→ because this is a Tier-3 external financial action and your current policy requires explicit approval above TT$1,000.
```

These innovations depend on exact ActionEnvelope, authority provenance and typed ControlEvidence. They must not precede the security floor.

---

# 11. Next loop

1. pool F085–F089 and C048–C051 without duplicating strengthened historical findings;
2. update F067 status to NARROWED;
3. update invitation finding lifecycle to reflect current reconcileUserId repair;
4. update J15 dossier with frontend evidence matrix;
5. refresh current-state/handoff;
6. assess J15 convergence maturity and whether J6 should now be admitted as the next governance stress test.

Production implementation remains unauthorized.
