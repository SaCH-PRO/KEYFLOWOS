# KEYFLOWOS — Next Chat Rollover Packet

Status: LIVE CONTINUITY ARTIFACT — CURRENT
Last refreshed: 2026-09-04
Canonical intelligence branch: `docs/keyflow-intelligence-foundation`
Production implementation authorized: **NO**

> Repository continuity is the source of truth. A fresh session must be able to continue without this chat.

## Fresh-chat instruction

```text
Continue KEYFLOWOS from canonical repository intelligence. Do not restart from scratch.

Load AGENTS.md, docs/intelligence/AGENT-CONTINUITY.md, 00-START-HERE.md, 07-CURRENT-STATE.md, CURRENT-HANDOFF.md, CURRENT-STATE.yaml, NEXT-CHAT-ROLLOVER.md, NEXT-CHAT-ROLLOVER.yaml, then the J23/J18 unified L6 artifacts named below. Run the Context Integrity Check first. Production code is read-only. Continue the exact next action from this packet.
```

## Context integrity

```text
Repository:             SaCH-PRO/KEYFLOWOS
Implementation branch:  main
Current main head:       168732d0e2226e11ed033c14fbdf7b3ea5344a41
Code-bearing baseline:  d7c5b86cfa276d75ffa42d5f1707c43704dc9f21
Main delta class:        audit-only
Intelligence branch:     docs/keyflow-intelligence-foundation
Context integrity:       PASS
Implementation:          UNAUTHORIZED
```

## Current frontier

```text
J23 = L5 VALUE-ENGINEERED / ENTERING L6 TARGET-CONVERGENCE
J18 = L5 VALUE-ENGINEERED / ENTERING L6 TARGET-CONVERGENCE
J15 = L4 SEMANTICALLY RECONCILED / ENTERING L5
J6  = ACTIVE STRESS TEST — recovery authority reinjected
K10 = ACTIVE / INITIAL CONVERGENCE

Findings:        F160
Contradictions:  C110
Recommendations: KF-REC-048
```

## Completed unified L6 tranches

1. `docs/intelligence/investigations/J23-J18-L6-UNIFIED-CONVERGENCE-MATRIX.md`
2. `docs/intelligence/investigations/J23-J18-L6-EXACT-FIELD-STATUS-MAPPING.md`
3. `docs/intelligence/investigations/J23-J18-L6-LIVE-ROW-MIGRATION-COMPATIBILITY.md`
4. `docs/intelligence/investigations/J18-TARGET-CONVERGENCE-AND-MIGRATION-MAP.md`
5. `docs/intelligence/kernels/KF-KERNEL-010-FINANCIAL-TRUTH.md`

The exact mapping/migration verdict is now:

```text
CURRENT STATUS COLUMNS CANNOT BE SAFELY NORMALIZED BY ENUM RENAME.
HISTORICAL AMBIGUITY MUST MAP TO UNKNOWN WHEN EVIDENCE IS INSUFFICIENT.
```

Preferred migration direction:

```text
preserve source rows
→ source-specific semantic adapters
→ additive identity/evidence at write boundaries
→ derivative Temporal Work Projection
→ conservative historical classification
→ reader migration
→ writer convergence
→ optional physical cleanup only after consumer proof
```

Unsafe approaches already rejected:

```text
mass status rename/replace
blind universal WorkOccurrence/RecoveryOccurrence backfill
universal DLQ/recovery worker/table before semantic/proof convergence
```

## Critical current mapping facts

- AiPlan/AiPlanStep carry multiple status dialects (`executing/awaiting_approval` and `running/waiting_approval`).
- `AiPlanStep.executing` is written after enqueue, before BullMQ worker execution, so it cannot auto-map to target RUNNING.
- AiExecutionLog `success=false` cannot auto-map to final effect failure; a failed log cannot remain a retry tombstone.
- OutboundDelivery `Sending`, `RetryPending`, and `Failed` require provider/attempt evidence before target classification.
- ScheduledAgentJob `COMPLETED/FAILED` are not sufficient business-outcome truth.
- WebhookEvent only proves occurrence seen/claimed; it does not prove processing applied successfully.
- Payment `FAILED/PENDING/REFUNDED` are not sufficient provider/recovery/consequence truth.
- FinancialTransaction `externalRef` and `reversalOfId` are strong existing K10 repair/reversal identities.
- SocialPost `POSTED` is any-success aggregate across destinations; `deletedAt` is local deletion only.

## Core target laws

```text
Attempt Failure != Logical Work Failure
Provider Success + Local Failure != Provider Failure
Effect Dedupe != Consequence Completeness
Original Outcome != Recovery Outcome
Retry != Reversal != Compensation
Local Delete != External Reversal
Parent Resume != Replay Confirmed Child Success
Failure / Time != New Authority
```

## Exact next action — DO THIS NEXT

Create/converge:

`docs/intelligence/investigations/J23-J18-L6-PROVIDER-CONTRACT-IDEMPOTENCY-RECONCILIATION-MATRIX.md`

Map current primary provider contracts against current KeyFlow seams for:

```text
client idempotency support + retention
provider operation identity
synchronous response semantics
lifecycle webhook/status callback
status/reconciliation lookup
external point-of-no-return
safe retry condition
native reversal/cancel/delete capability
current KeyFlow implementation seam/gap
adopted target property
```

Priority providers/effects:

```text
Stripe payments/refunds/payment links
PayPal orders/captures/refunds
Twilio SMS/WhatsApp send/status
Meta WhatsApp Cloud send/status
Google Calendar create/delete
Gmail/Google mail send
Resend email
WiPay payment/lifecycle/reversal
material social publishing providers
```

Use current primary provider documentation. Adopt properties, not products. Do not claim a provider lacks a feature merely because an initial search failed; mark it unconfirmed until primary evidence is found.

## After provider matrix

```text
exact J15 Clearance recovery-scope + J6 recovery-policy representation
→ Temporal Work Projection recovery materialization/query strategy
→ characterization/concurrency/crash proof inventory
→ backward re-audit active constellation
→ bounded KF-EXEC readiness assessment only if target + migration + proof converge
```

## Chat-length policy

The platform hard cutoff is not a reliable visible value. Do not wait for a guessed threshold.

```text
major tranche
→ persist canonical result
→ refresh CURRENT + ROLLOVER
→ then begin next broad tranche
```

If context-loss/compaction symptoms appear, finish only the current atomic trace, update these files, and move to a new chat.

Invariant:

> **If this chat disappears after the next message, the repository is sufficient to continue without analytical loss.**

## Do not

- modify production code;
- create parallel v2 sources of truth;
- install Temporal/Camunda from findings alone;
- invent historical certainty;
- blindly retry OUTCOME_UNKNOWN;
- treat provider success + local failure as provider failure;
- treat local delete as provider reversal;
- let effect dedupe suppress missing consequence repair;
- replay completed children during parent resume;
- treat failure/time as new authority;
- claim tests/runtime proof unless actually executed.
