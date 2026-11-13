# KeyFlowOS Finding Register — Booking / Temporal Supplement

Status: CANONICAL CONTINUATION OF the KeyFlowOS finding register after `08C-FINDING-REGISTER-CONSEQUENCE-OWNERSHIP-SUPPLEMENT.md`

Implementation baseline: `main@d7c5b86cfa276d75ffa42d5f1707c43704dc9f21`

Canonical sequence continues after F120.

---

## F121 — Booking status mutation can re-emit COMPLETED consequences on same-state/replayed requests

**Status:** VERIFIED CODE-LEVEL / STATE-TRANSITION FINDING

`BookingsService.updateBookingStatus()` validates only that the requested target belongs to a broad status vocabulary, then updates the row by ID. It does not enforce an allowed lifecycle transition graph, reject `COMPLETED -> COMPLETED`, or atomically require an expected source state.

Side effects execute whenever the requested target is COMPLETED, including event emission, CRM timeline write, rebook obligation and auto-invoice helper.

A repeated completion request can therefore recreate lifecycle consequences even when no new business transition occurred.

Target: canonical consequences derive from a newly committed valid transition occurrence, not merely a requested target value.

Affected kernels: K6, K7, K8, K11.
Affected journeys: J4, J6, J18, J23.

---

## F122 — shared ScheduledAgentJob table has competing consumers; CrossModuleAgent can falsely complete other subsystems' jobs

**Status:** VERIFIED CODE-LEVEL / CLOSED-SYSTEM INTERACTION FINDING

Current due-job processors include:

```text
ReviewSolicitationService
  filters review_solicitation

AbandonedCartRecoveryService
  filters abandoned_cart_recovery

CommerceIntegrationService
  filters post_purchase_review_request / post_purchase_reorder_prompt

CrossModuleAgentService
  filters only PENDING + due time
  does not filter jobType
```

CrossModuleAgent recognizes only `quote_followup`, `post_purchase_review_request`, and `post_purchase_reorder_prompt`. Unknown job types log a warning and return without throwing, after which the poller marks the row COMPLETED.

Verified consequence classes:

- `review_solicitation`: can be marked completed without sending its intended email;
- `abandoned_cart_recovery`: can be marked completed without sending recovery email;
- `lead_magnet_enroll`: producer exists, no matching consumer found, but generic poller can mark it completed;
- `post_purchase_*`: recognized by CrossModule and also processable through CommerceIntegration's separate endpoint, creating competing execution paths.

Target: scheduled job type/capability has one explicit owner/router, unknown type fails closed, and executable work requires an atomic claim.

Affected kernels: K5, K7, K8, K9, K11.
Affected journeys: J4, J6, J9, J10, J18, J23.

---

## F123 — due ScheduledAgentJob execution lacks atomic ownership even in correctly filtered consumers

**Status:** VERIFIED CODE-PATTERN / DISTRIBUTED-RELIABILITY FINDING

ReviewSolicitation and AbandonedCartRecovery both use:

```text
findMany PENDING due jobs
→ external effect
→ update COMPLETED
```

without an observed atomic `PENDING -> CLAIMED/SENDING` expected-state transition before the side effect.

Thus fixing F122's routing collision alone does not make multi-instance execution safe.

Positive seam: the model already exposes semantic checkpoint uniqueness through `businessId_entityId_checkpoint` and repository paths use `upsert` against it.

Target distinction:

```text
scheduled-intent uniqueness
!= execution ownership
```

Affected kernels: K7, K9, K11.
Affected journeys: J4, J6, J9, J10, J18, J23.

---

## F124 — ReferralRewardService can double-credit under concurrent duplicate completion events

**Status:** VERIFIED CODE-LEVEL / MONETARY-CONSEQUENCE CONCURRENCY FINDING

ReferralRewardService suppresses sequential replay with mutable `contact.custom.referralRewardEarned`, but two concurrent handlers can both observe it false, read the same reward balance, mutate the referrer balance/earned count, and mark the referred contact rewarded.

No transaction, unique reward-entitlement ledger or expected-state compare-and-set was observed around the two-contact reward operation.

Target:

```text
unique RewardEntitlement
→ atomic claim
→ transactional ledger mutation
→ OutcomeEvidence
```

Mutable contact flags are not a sufficient financial entitlement boundary.

Affected kernels: K6, K7, K8, K10, K11.
Affected journeys: J3, J4, J7, J18.

---

## F125 — ProjectRevenueListener's stated idempotency is non-atomic

**Status:** VERIFIED CODE-LEVEL / STATE-CONCURRENCY FINDING

ProjectRevenueListener selects linked projects where status equals configured source status and then updates by project/business ID without requiring the row still has that source status.

Two concurrent handlers can both select the project, both write the same target state and both emit `project.status_advanced`.

The final state can be correct while transition occurrence/evidence duplicates.

Target: expected-state CAS or canonical project transition owner producing exactly one committed transition occurrence.

Affected kernels: K6, K7, K8, K11.
Affected journeys: J4, J7, J8, J18.

---

## F126 — booking.completed confirms material consequence fragmentation is systemic, not invoice-specific

**Status:** VERIFIED CROSS-JOURNEY / SYSTEMIC FINDING

A second representative canonical event fans out into:

- immediate customer email;
- delayed review solicitation;
- CRM follow-up work;
- referral credit;
- project progression;
- rebook obligation;
- auto-invoice;
- JourneyOrchestrator plan;
- optional AgentTrigger plan;
- outbound webhook;
- projection/intelligence consumers.

Many effects are intentionally different and useful. Their one-time/repeatable/cadence/authority relationships are nevertheless implicit and distributed across services.

Because the same shape was independently observed for `invoice.overdue`, promote the target to a whole-OS invariant:

> Every material consequence of a canonical event occurrence has explicit owner, causal identity, replay semantics, authority and coexistence/cadence rules.

Affected kernels: K3, K5, K6, K7, K8, K9, K10, K11.
Affected journeys: J3, J4, J6, J7, J8, J9, J10, J14, J18, J23.

---

# Pool law

```text
VALID STATE TRANSITION
→ EventOccurrenceId
→ consequence graph
→ semantic scheduled intents
→ explicit worker ownership
→ atomic execution claims
→ effects
→ truthful outcome evidence
```

No production implementation is authorized by this supplement.
