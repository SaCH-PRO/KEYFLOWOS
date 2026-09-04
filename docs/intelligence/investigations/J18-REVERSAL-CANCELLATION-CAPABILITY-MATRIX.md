# J18 — Reversal / Cancellation Capability Matrix

Status: ACTIVE FORENSIC SYNTHESIS / TARGET-CONVERGENCE INPUT
Implementation baseline: `main@d7c5b86cfa276d75ffa42d5f1707c43704dc9f21`
Current audit-only head: `168732d0e2226e11ed033c14fbdf7b3ea5344a41`
Primary journey: J18 Failure → Recovery
Primary kernels: K11 Recovery/Reliability, K9 Integration/External Reality, K8 Evidence/Outcome
Secondary kernels: K10 Financial Truth, K7 Temporal/Workflow, K6 State Transition, K3 Governance

> This matrix answers what “undo/recovery” can actually mean per effect family. It does not assume reversibility and does not authorize production implementation.

---

## 1. Classification

```text
CANCEL
  prevent not-yet-effective work

VOID
  domain-native cancellation of a local obligation/document

REVERSAL
  provider/domain-native inverse of a completed effect

COMPENSATION
  new business effect that offsets/mitigates the original

MITIGATION_ONLY
  no inverse effect; annotate/follow up while preserving original outcome
```

A UI verb such as `delete`, `undo`, `retry`, `cancel`, or `recall` is not sufficient evidence of which class actually occurred.

---

## 2. Current capability matrix

| Effect family | Current reversal/cancel seam | External inverse exists in inspected code? | Current local evidence | Target classification | Notes |
|---|---|---:|---|---|---|
| Stripe captured payment | `refundCharge` | YES | provider refund ID + Payment path | REVERSAL | provider-native idempotency should bind to RecoveryEffectId; F155 consequence convergence still applies |
| PayPal captured payment | `refundCharge` | YES | provider refund ID + Payment path | REVERSAL | same; preserve capture/refund lineage |
| WiPay payment | current `PaymentsOps` declares refunds unsupported | NOT OBSERVED | local payment/callback state | RECOVERY_UNAVAILABLE / provider-specific manual process until proven | later lifecycle ingress also limited by existing F134 |
| Stripe Payment Link | `revokePaymentLink` sets provider link inactive | YES | provider operation, no new payment effect | CANCEL / VOID-like provider deactivation | applies before later customer payment effect |
| PayPal payment link/order | connector throws unsupported for revoke | NO current generic revoke seam observed | provider order ID | RECOVERY_UNAVAILABLE or provider-specific expiration/cancel semantics | do not fake local cancellation as provider cancellation |
| Booking before service completion | `BookingStatus.CANCELLED` | domain-local | Booking status/events | CANCEL | later external consequences may require separate recovery effects |
| Completed booking/service | ordinary reschedule/cancel is blocked or semantically insufficient | no generic inverse | Booking state | COMPENSATION / business remediation | completed service cannot be made “not happened” |
| Invoice before settlement where workflow permits | `InvoiceWorkflow` → `VOID` | domain-local | invoice + ledger workflow evidence | VOID | paid/settled invoices require refund/credit/reversal semantics instead |
| Payment refund bookkeeping | `markPaymentRefunded()` | local financial inverse | Payment + ledger reversal + invoice reconciliation | REVERSAL of local financial posting | positive seam to preserve |
| Google Calendar event | Google Calendar connector/service includes provider HTTP DELETE | YES | local CalendarEvent + provider event ID where linked | REVERSAL/CANCEL depending event timing | current provider seam proves external inverse is possible |
| Sent external email/WhatsApp/message | no general unsend seam observed | generally NO in current implementation | local message/delivery history | MITIGATION_ONLY | Saga “recall” must not imply external effect undone; F152 |
| OutboundDelivery published content/message | generic delivery fabric has no inverse operation | provider-specific | delivery/result evidence | provider-specific REVERSAL or MITIGATION_ONLY | retry fabric must not masquerade as reversal |
| Published social post | `SocialService.deletePost()` only soft-deletes local `SocialPost` | NO delete call in `SocialPublishingService` | local `deletedAt`; publishResults/external IDs retained on row | LOCAL DELETE / external effect unchanged | candidate F160 / C110 |
| CRM contact/deal/task created in error | soft delete / task delete handlers | domain-local | deleted/status evidence | VOID/CANCEL of local object | not equivalent to external provider reversal |

---

## 3. F160 candidate — Social post delete vs provider truth

Current live surface:

```text
DELETE /social/businesses/:businessId/posts/:postId
→ SocialService.deletePost()
→ SocialPost.deletedAt = now
→ emit social_post.deleted
```

`SocialService.publishPost()` can previously have called provider publishers and persisted:

```text
status = POSTED
publishResults = provider results
externalPostId / externalUrl
```

But `deletePost()` does not call `SocialPublishingService` or any provider publisher.

`SocialPublishingService` exposes publish/list operations in the inspected implementation; no delete/unpublish operation was found.

The current web social surface removes the post from local UI and displays “Post deleted.”

Thus for a previously published post:

```text
local SocialPost = deleted/hidden
provider post = still published unless independently removed outside this path
```

Target law:

```text
LOCAL DELETE
!= PROVIDER DELETE
```

A user-facing delete operation must either:

1. execute/confirm provider deletion for each published destination;
2. clearly represent “remove from KeyFlow only”; or
3. record provider-deletion recovery work/outcome separately.

Multi-platform publication makes this destination-specific: each provider artifact can have a different reversal result.

---

## 4. Positive design patterns

### Stripe checkout lineage-before-effect

Before creating a Stripe checkout session, KeyFlow embeds `invoiceId` and `businessId` in provider-owned metadata and `client_reference_id`.

A later signed `checkout.session.completed` webhook can reconstruct the local business consequence from provider evidence even if no Payment row existed at checkout creation time.

Adopted property:

> Bind recoverable local lineage into provider-owned operation metadata before crossing the external point of no return whenever the provider supports it.

This contrasts with F158's PayPal direct-capture catch path, where the synthetic failure row loses order/capture lineage needed for fallback repair.

### Google Calendar provider-native delete

The current Google Calendar connector/calendar service includes HTTP DELETE against the provider event resource. This proves that external reversal should use the provider seam when the original effect was provider-backed, rather than merely changing a local calendar row.

### Financial local reversal

`CommerceService.markPaymentRefunded()` couples local refund state with ledger reversal and invoice reconciliation, providing a stronger model for consequence completeness.

---

## 5. Recovery authority implications

Capability classes differ materially:

```text
RETRY same EffectId
  may be continuation authority when policy explicitly permits

CANCEL not-yet-effective work
  may be covered by standing stop/revoke authority

VOID local obligation
  new domain mutation; authority depends on impact

REVERSAL completed external/financial effect
  new RecoveryEffectId; normally requires current authority and proportional control

COMPENSATION
  always a new business effect and must be governed as such

MITIGATION_ONLY
  still a new effect if it sends/changes anything externally
```

Original action approval does not automatically authorize a later refund, provider delete, apology message, or other compensating effect.

---

## 6. Target provider/destination evidence

For reversible multi-destination effects, recovery evidence should be per provider artifact:

```yaml
original_effect_id: ...
destinations:
  - provider: facebook
    provider_operation_id: ...
    original_outcome: published
    recovery_effect_id: ...
    recovery_action: delete
    recovery_outcome: confirmed|failed|unknown|unavailable
  - provider: linkedin
    provider_operation_id: ...
    original_outcome: published
    recovery_effect_id: ...
    recovery_action: delete
    recovery_outcome: ...
```

A single local `deletedAt` or `compensated` flag cannot represent heterogeneous external recovery outcomes.

---

## 7. Matrix verdict

```text
ONE GENERIC “UNDO” SEMANTIC      = NO
ONE RECOVERY ACTION TAXONOMY     = YES
PER-EFFECT / PER-DESTINATION OUTCOME = YES
PROVIDER-NATIVE REVERSAL WHERE AVAILABLE = YES
LOCAL-ONLY DELETE AS EXTERNAL REVERSAL = NO
```

No universal reversal adapter is justified yet. Extend current provider/domain seams behind the Recovery Contract only where material effects need them.

No runtime tests were executed in this forensic pass.
