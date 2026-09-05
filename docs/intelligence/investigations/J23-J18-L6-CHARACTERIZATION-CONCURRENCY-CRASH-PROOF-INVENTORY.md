# J23 + J18 — Characterization / Concurrency / Crash Proof Inventory

Status: L6 PROOF SPECIFICATION / NO PRODUCTION IMPLEMENTATION AUTHORIZED
Implementation baseline: `main@d7c5b86cfa276d75ffa42d5f1707c43704dc9f21`
Current audit-only head: `168732d0e2226e11ed033c14fbdf7b3ea5344a41`
Research / inventory date: 2026-09-04
Primary journeys: J23 Temporal Flow, J18 Failure → Recovery
Reinjected journeys: J15 Approval/Governance, J6 Proactive KEY/Autonomy, J14 External Ingress
Primary kernels: K3 Governance, K6 State Transition, K7 Temporal Work, K8 Evidence, K9 External Reality, K10 Financial Truth, K11 Recovery

> This document specifies what must be proven before the J23/J18 target can become an implementation packet. It inventories existing test seams but does **not** claim those tests were executed in this forensic pass.

---

## 1. Proof verdict

The J23/J18 semantic target is materially converged. The current repository already contains useful local characterization tests for authorization, tenant boundaries, invoice state, payment webhook handling, ledger recipes and honest social publication.

However, the highest-risk target properties cross boundaries that the inspected suite does not yet directly prove:

```text
provider point-of-no-return → local crash
attempt failure → durable retry
webhook occurrence → partial application → redelivery
provider outcome → Payment → ledger → invoice consequence convergence
retry backoff → authority revocation
parent resume → child terminality preservation
projection staleness → live revalidation
legacy ambiguity → conservative migration
local deletion → provider reversal truth
```

Therefore:

```text
SEMANTIC TARGET CONVERGED         = YES
MIGRATION DIRECTION CONVERGED     = YES
PROVIDER CONTRACT DIRECTION       = YES
PROOF OBLIGATIONS DEFINED        = YES — THIS ARTIFACT
RUNTIME PROOF EXECUTED            = NO
KF-EXEC PACKET READY              = NO
```

The next analytical gate is the backward re-audit of the active constellation after this proof specification is persisted.

---

## 2. Governing proof laws

```text
TEST EXISTS != BEHAVIOR PROVEN
MOCKED UNIT TEST != CONCURRENCY / TRANSACTION / CRASH PROOF
STATUS != OUTCOME EVIDENCE
WEBHOOK SEEN != WEBHOOK APPLIED
PROVIDER SUCCESS != LOCAL CONSEQUENCE COMPLETENESS
RETRY TRANSPORT != AUTHORITY TO MUTATE
PROJECTION != SOURCE OF TRUTH
PROJECTION SUGGESTION != CLEARANCE
LOCAL DELETE != EXTERNAL REVERSAL
PARENT RE-EXECUTION != CHILD RESUME
AMBIGUOUS HISTORY != CERTAIN HISTORY
```

A proof passes only when its oracle is tied to the authoritative invariant, not merely to a method return value or status string.

---

## 3. Existing characterization seams

The following inventory is based on inspected repository tests and production paths. `EXISTING` means the seam exists; it does **not** mean the target behavior has been executed or proven in this pass.

| Subsystem / target property | Existing seam | What it currently characterizes | What remains unproven for J23/J18 | Target disposition |
|---|---|---|---|---|
| J15 authority ceiling | `apps/server/src/modules/ai/key-identity-and-authority.spec.ts` | authority clamps downward; pre-approved tools cannot outrank role/business authority | recovery-time Clearance, retry scope, revocation during wait, RecoveryEffectId control | KEEP + EXTEND |
| Approval lifecycle | `ai-approvals.service.spec.ts` | list/get/resolve/batch/stats and oversight delegation | historical ControlEvidence vs current Clearance; recovery scope; stale approval after material change | KEEP + NEW RECOVERY TESTS |
| ActionDispatcher / BullMQ retry | no direct dispatcher/queue/plan-executor recovery characterization found in inspected AI test seams | nearby AI specs cover other governance/evidence behavior | F150 failed-idempotency tombstone, same EffectId/new AttemptId, queue retry semantics | NEW |
| Invoice arithmetic/state | `invoice-workflow.service.spec.ts` | balances, refunds, legal status transitions | provider certainty, posting completeness, crash repair | KEEP |
| System actor tenant authority | `system-actor-authority.spec.ts` | explicit business scope required; cross-tenant access refused | cross-domain recovery/projection tenant joins and recovery mutation isolation | KEEP + EXTEND |
| Client/server invoice contract | `invoice-status-contract.spec.ts` | route verb, guard tenant input, validation contract | recovery semantics | KEEP |
| Stripe/PayPal webhook handling | `apps/server/test/payments-webhooks.service.test.ts` | signatures, Payment persistence, duplicate provider Payment prevention, partial payments, refunds, some provider-event dedupe | claim-before-apply crash, ledger consequence completion, synchronous PayPal post-provider crash | STRENGTHEN; ONE LEGACY ASSERTION REQUIRES SEMANTIC REWRITE |
| Webhook replay | same payment webhook suite | current test asserts same `WebhookEvent` id is a total no-op | safe only after first application is complete; unsafe for SEEN/CLAIMED + incomplete consequences | REWRITE SEMANTIC |
| Revenue posting / reversal | `finance-revenue-flow.e2e.test.ts` | in-memory ledger recipes, idempotent externalRef behavior, accrual/cash payment/refund balance effects | real provider→Payment→ledger→invoice chain; crash between each consequence | KEEP + COMPOSE INTO K10 PROOF |
| Payment operation service | no direct `payments.service.spec.ts` or `payments-ops.service.spec.ts` in inspected module directory; lifecycle coverage is mainly under `apps/server/test` | provider webhook behavior exists in separate suite | direct capture/refund crash windows, provider idempotency adoption, executable retry owner | NEW |
| OutboundDelivery execution | `delivery-queue.service.ts` production seam; no direct `delivery-queue.service.spec.ts` found in inspected communications directory | CAS-like local claim exists in code | F159 post-provider local crash, retry replay, per-attempt evidence, replica races | NEW |
| Social publication honesty | `apps/server/test/social.service.test.ts` | refuses fake publication with no connected account; real publish path invoked when connection exists | per-destination outcome, crash after one destination, provider delete/reversal | KEEP + EXTEND |
| Social deletion | current `SocialService.deletePost()` only soft-deletes local row | tenant-scoped local deletion behavior is visible in production path | F160 external artifact survival, provider-native reversal and partial delete outcome | NEW |
| General tenant boundaries | `business.guard.test.ts`, `tenant-membership-boundary.integration.test.ts`, `tenant-scope-extension.integration.test.ts`, attack tests | useful existing tenant-isolation patterns | projection joins, provider ID collisions, recovery-effect tenant binding | KEEP + EXTEND |
| Webhook ingress security | `webhooks.controller.test.ts`, `webhook-ingress-secret-redaction.integration.test.ts` | ingress/controller and secret safety seams | apply-state lifecycle / redelivery repair | KEEP + EXTEND |

### 3.1 Existing test that currently locks a dangerous semantic

`payments-webhooks.service.test.ts` currently contains a test equivalent to:

```text
same WebhookEvent id arrives again
→ dedupe short-circuits before any side effect
→ reconcile call count remains 1
```

That is correct **only** when the first event reached an application-complete state.

It is not safe for:

```text
WebhookEvent occurrence inserted
→ Payment or other consequence begins
→ process crashes
→ provider redelivers same event
```

Under the J14/J18/K10 target the invariant becomes:

```text
DUPLICATE OCCURRENCE + APPLICATION COMPLETE
→ do not repeat completed business/provider effect

DUPLICATE OCCURRENCE + APPLICATION INCOMPLETE
→ resume / repair missing consequences idempotently
```

This is the existing F127/F155 root, not a new finding.

---

## 4. Proof levels

A final implementation packet must label every proof by level.

### P-L0 — deterministic semantic unit

Use for:
- source-status adapters;
- failure-certainty mapping;
- lateness/cancel policy;
- RecoveryScope budget calculation;
- legal next-action derivation;
- projection contradiction classification.

No database/queue/provider claim may be inferred from P-L0.

### P-L1 — persistence integration

Use a real test database/transaction layer where the target depends on:
- uniqueness;
- compare-and-set updates;
- transaction rollback;
- durable state across process recreation;
- financial posting/reversal lineage;
- tenant-scoped queries.

### P-L2 — concurrency / queue integration

Use actual queue/locking semantics appropriate to the implementation seam. For BullMQ claims, retry/stall/attempt behavior must not be “proven” solely with hand-written mocks.

Required capabilities:
- two competing workers;
- deterministic barriers/latches;
- retry/backoff wake;
- cancellation/revocation between attempts;
- restart/reconnect where material.

### P-L3 — provider-contract simulator

A deterministic fake provider endpoint should support:

```text
ACCEPT EFFECT + RETURN SUCCESS
ACCEPT EFFECT + DROP CONNECTION BEFORE RESPONSE
REJECT BEFORE EFFECT
RETURN RETRYABLE ERROR BEFORE EFFECT
DELAY CALLBACK
DUPLICATE CALLBACK
OUT-OF-ORDER CALLBACK
RETURN PROVIDER OPERATION ID
LOOKUP BY PROVIDER OPERATION ID
IDEMPOTENCY-KEY SAME-REQUEST REPLAY
IDEMPOTENCY-KEY PARAMETER CONFLICT
REVERSAL SUCCESS / FAILURE / UNKNOWN
```

The simulator exists to force crash windows that are impractical to reproduce reliably against a live vendor.

### P-L4 — provider sandbox contract checks

Where supported, use vendor sandbox/test modes to verify the adapter interpretation of:
- idempotency key behavior;
- provider operation IDs;
- status lookup;
- webhook lifecycle;
- native cancellation/refund/delete.

P-L4 complements but does not replace deterministic P-L3 crash proof.

### P-L5 — bounded end-to-end journey proof

Exercise the complete KeyFlow path across authority, temporal work, effect, provider evidence, consequences, recovery and projection for selected high-value execution slices.

---

# 5. Exact proof-obligation matrix

## A. External point-of-no-return / uncertainty

### PF-J2318-001 — provider accepted, local persistence crashes

**Roots:** F158, F159, C108, C109  
**Level:** P-L1 + P-L3

Inject failure immediately after provider returns confirmed success but before local effect/outcome persistence.

Required:

```text
provider operation count = 1
failure_certainty = SUCCEEDED_CONFIRMED or provider-success evidence retained
consequence_state = INCOMPLETE
next action = REPAIR / RECONCILE, not repeat provider effect
provider operation identity survives restart where returned
```

Forbidden:
- local generic FAILED implying provider failed;
- a second provider create/send/capture on retry.

### PF-J2318-002 — provider accepted, response lost before provider ID reaches caller

**Roots:** F149 class; provider matrix  
**Level:** P-L3

Two provider capability branches must be proven:

1. provider idempotency supported → same EffectId-bound key safely reused;
2. provider idempotency absent/unconfirmed and provider ID unknown → `OUTCOME_UNKNOWN`, no blind duplicate mutation.

### PF-J2318-003 — provider ID known, terminal result not yet known

**Level:** P-L3

Required:

```text
ProviderOperationId known
→ RECONCILE by lookup/callback
→ no second create operation
```

For Twilio/Resend/calendar/payment providers this must be specialized to provider semantics before implementation.

### PF-J2318-004 — out-of-order provider lifecycle events

**Level:** P-L3

Deliver lifecycle evidence out of chronological order.

Required:
- terminal/stronger evidence cannot regress to a weaker transport state;
- event occurrence remains recorded;
- projection explains disagreement where ordering cannot be resolved safely.

---

## B. Effect identity / retry ownership

### PF-J2318-005 — failed ActionDispatcher attempt must not tombstone BullMQ retry

**Roots:** F150, C100  
**Level:** P-L2

Sequence:

```text
WorkOccurrence W
Effect E
Attempt A1 → retryable failure → failed AiExecutionLog evidence
BullMQ wakes A2
```

Required:

```text
W unchanged
E unchanged
A2 != A1
A2 may execute if RecoveryScope/current validity allows
failed A1 is evidence, not idempotent terminal consumption
```

Forbidden: `findIdempotentExecution()` returning A1 failure as reason to suppress A2.

### PF-J2318-006 — retry identity and provider idempotency binding

**Level:** P-L2 + P-L3

Every same-effect retry must prove:

```text
same WorkOccurrenceId
same EffectId
new AttemptId
same material action fingerprint
same provider idempotency identity where supported
```

Parameter mutation must produce a new action/effect identity or require new Clearance.

### PF-J2318-007 — retry exhaustion produces final failure exactly once

**Level:** P-L2

Required:
- retryable failure remains live while budget exists;
- exhaustion/nonretryable certainty transitions logical work to `FAILED_FINAL_CONFIRMED` once;
- late/stalled queue bookkeeping cannot reopen or regress the terminal state.

---

## C. Parent/child work and concurrency

### PF-J2318-008 — parent resume preserves successful child terminality

**Root:** F157, C107  
**Level:** P-L1 + P-L2

Create parent with children:

```text
child 1 = SUCCEEDED_CONFIRMED
child 2 = AWAITING_CONTROL / RETRYING
```

Resume parent.

Required:
- child 1 provider/effect operation count remains 1;
- only unresolved child becomes eligible;
- parent derives state from durable current children.

### PF-J2318-009 — control wait is suspension, not parent failure

**Roots:** F153, C103  
**Level:** P-L1

Required:
`AWAITING_CONTROL` child keeps parent resumable; it must not be normalized into generic failure merely because executor loop returned.

### PF-J2318-010 — cancellation vs worker claim has one winner

**Level:** P-L1 + P-L2

Force cancellation and claim concurrently.

Required:
- one linearized state wins;
- if cancellation wins before effect point-of-no-return, provider operation count = 0;
- if claim/effect crosses point-of-no-return first, cancellation reports too-late/recovery semantics honestly.

### PF-J2318-011 — competing replicas claim work once

**Level:** P-L1 + P-L2

Run at least two worker/replica claimers against the same due occurrence/delivery/job.

Required: one effective owner; no duplicate provider effect.

### PF-J2318-012 — terminal state cannot regress from late transport bookkeeping

**Level:** P-L1 + P-L2

After source reaches terminal success/cancel/final failure, inject late queue completion/stall/failure callbacks.

Required: logical terminal state stays monotonic unless an explicit new recovery effect changes a separate recovery dimension.

---

## D. Webhook claim / apply / redelivery

### PF-J2318-013 — WebhookEvent inserted, application crashes, same event redelivers

**Roots:** F127, F155  
**Level:** P-L1

Inject crash after occurrence dedupe evidence is durable but before all downstream consequences complete.

Required:

```text
same provider event occurrence is not duplicated
application state remains incomplete/retryable
redelivery or repair worker resumes missing application
already-complete consequences remain idempotent
```

Forbidden: duplicate occurrence is treated as proof that all consequences were already applied.

### PF-J2318-014 — duplicate webhook after complete application is harmless

**Level:** P-L1

This preserves the useful part of the existing replay test.

Required:
- no duplicate Payment/provider effect/ledger posting;
- reconciliation may verify completeness if cheap/necessary but must not create duplicate consequences.

### PF-J2318-015 — duplicate/out-of-order webhook convergence

**Level:** P-L1 + P-L3

Mix duplicate and out-of-order events. Required final state is derived from evidence strength/provider semantics, not arrival order alone.

---

## E. K10 Financial Truth / consequence repair

### PF-J2318-016 — provider payment success → Payment → ledger → invoice, crash between every boundary

**Roots:** F155, F158, K10  
**Level:** P-L1 + P-L3 + selected P-L5

Inject separate failures:

```text
A provider success before Payment persistence
B Payment persisted before ledger posting
C ledger posted before invoice reconciliation
D invoice reconciled before optional downstream event/timeline
```

After recovery, prove:

```text
provider payment effect count = 1
one logical Payment evidence lineage
ledger effect exactly once
invoice/order consequence converged
Financial Truth = CONVERGED
```

### PF-J2318-017 — provider refund success with local consequence gap

**Root:** F155  
**Level:** P-L1 + P-L3 + P-L5

Required final invariant:

```text
provider refund confirmed
+ REFUNDED Payment evidence
+ ledger reversal
+ invoice/order receivable reconciliation
= FINANCIAL_TRUTH_CONVERGED
```

Effect dedupe must suppress duplicate refund creation **without** suppressing missing ledger/invoice repair.

### PF-J2318-018 — financial posting/reversal idempotency

**Level:** P-L1

Reuse current `FinancialTransaction.externalRef` / `reversalOfId` seams where applicable.

Prove replayed consequence repair returns existing posting/reversal rather than double-booking.

### PF-J2318-019 — payment `PENDING` is not executable retry proof

**Root:** F156  
**Level:** P-L0 + P-L1

Setting or observing PENDING alone must not cause a provider retry unless an owned live WorkOccurrence/Effect + allowed RecoveryScope exists.

---

## F. Recovery authority / revocation / budgets

### PF-J2318-020 — authority revoked during retry backoff

**Level:** P-L2

Sequence:

```text
A1 retryable failure
→ RETRYING/backoff
→ authority/delegation revoked
→ A2 wakes
```

Required: A2 performs no material effect. Historical ControlEvidence remains visible; current Clearance denies or routes to control.

### PF-J2318-021 — stale source state invalidates otherwise authorized retry

**Level:** P-L1 + P-L2

Example: invoice paid elsewhere, booking cancelled, campaign stopped, recipient policy changed.

Required: source-state revalidation cancels/supersedes/expires work rather than executing stale effect.

### PF-J2318-022 — reversal/compensation requires current proportional Clearance

**Level:** P-L1

Original Effect E succeeds. Request reversal/compensation R.

Required:

```text
RecoveryEffectId R != E
current RecoveryControlRequirement evaluated
current Clearance bound to R
original Clearance alone insufficient unless explicit bounded parent recovery envelope covers R
```

### PF-J2318-023 — recovery budget clamps; never expands authority

**Level:** P-L0 + P-L1

Vary attempts, elapsed time, money, communication volume, provider spend and affected-resource count.

Required:
- adaptive/budget logic may reduce allowed recovery;
- it cannot infer a broader capability/risk/spend scope from success history or urgency.

### PF-J2318-024 — OUTCOME_UNKNOWN blocks autonomous duplicate effect

**Level:** P-L0 + P-L2 + P-L3

J6 proactive path must choose RECONCILE / WAIT / ESCALATE rather than re-send/re-charge/re-publish while external outcome is unknown.

---

## G. Reversal / delete / multi-destination recovery

### PF-J2318-025 — local social delete cannot masquerade as provider delete

**Root:** F160, C110  
**Level:** P-L1 + P-L3

For an already-published provider artifact:

```text
local deletedAt set
provider artifact still exists
```

Projection/operator result must explicitly show provider artifact remains live; recovery outcome cannot be `RECOVERY_SUCCEEDED_CONFIRMED` for external deletion.

### PF-J2318-026 — provider-native delete/reversal per destination

**Level:** P-L3

For a multi-destination social publish, make one delete succeed and another fail/unsupported.

Required:
- separate RecoveryEffectId/outcome evidence per destination;
- aggregate UI never flattens partial recovery into universal “deleted.”

---

## H. Migration / historical ambiguity

### PF-J2318-027 — ambiguous live-row fixtures stay ambiguous

**Level:** P-L0 + P-L1 migration fixture

Fixture set must include at least:

```text
AiPlanStep.executing written after enqueue, no worker evidence
AiPlanStep.failed with retry evidence possible
OutboundDelivery.Sending with no provider evidence
OutboundDelivery.Failed with provider ID/success evidence conflict
ScheduledAgentJob.FAILED without effect certainty
WebhookEvent existing with unknown application completeness
Payment.FAILED with possible provider success lineage
Payment.REFUNDED without ledger reversal
SocialPost.POSTED with partial destination success
SocialPost.deletedAt with provider artifact still live
```

Required:
- source row remains intact;
- adapter emits `AMBIGUOUS` / `OUTCOME_UNKNOWN` / consequence-incomplete dimensions where evidence is insufficient;
- migration must not invent timestamps/provider outcomes/terminal certainty.

### PF-J2318-028 — adapter version reclassification is explainable

**Level:** P-L0 + P-L1

When semantic adapter rules change, rebuild/reclassify the projection from source evidence.

Required:
- classification version/evidence basis visible;
- no mutation of raw historical truth merely to match the new projection.

---

## I. Temporal Work Projection

### PF-J2318-029 — stale projection cannot authorize mutation

**Level:** P-L1 + P-L5

Materialize an item as recoverable, then mutate authoritative source/authority before operator acts.

Required:

```text
projection may display stale candidate state
operator requests action
→ live source + authority + provider certainty revalidated
→ stale action denied/recomputed
```

Forbidden: projection row acts as write authorization.

### PF-J2318-030 — projection contradiction preservation

**Level:** P-L0 + P-L1

Feed contradictions such as:

```text
LOCAL_FAILED + PROVIDER_SUCCESS
PAYMENT_REFUNDED + LEDGER_NOT_REVERSED
LOCAL_DELETED + PROVIDER_ARTIFACT_LIVE
WEBHOOK_SEEN + APPLICATION_INCOMPLETE
PARENT_FAILED + CHILD_AWAITING_CONTROL
```

Required: projection preserves both evidence branches and derives attention/recovery semantics; it must not collapse them to one cosmetically convenient status.

### PF-J2318-031 — projection rebuild is deterministic and non-authoritative

**Level:** P-L1

Delete/rebuild projection state from canonical sources.

Required:
- same source evidence + adapter version → equivalent semantic result;
- canonical work/payment/provider/domain rows unaffected;
- projection loss does not erase recovery rights/evidence.

### PF-J2318-032 — degraded source behavior fails safe

**Level:** P-L1

Make one source adapter unavailable/stale.

Required:
- projection shows source degradation/staleness;
- mutation requiring unavailable authoritative evidence is denied or routed to safe reconciliation;
- other tenants/sources continue without silent certainty fabrication.

---

## J. Tenant isolation / correlation collisions

### PF-J2318-033 — cross-domain projection tenant isolation

**Level:** P-L1 + P-L5

Create similar/colliding correlation/provider identifiers in tenant A and tenant B.

Required:
- tenant A cannot read, join, display, recover, reverse or infer tenant B work/evidence;
- graph/projection edges remain tenant-bound even where provider IDs are globally shaped strings.

### PF-J2318-034 — recovery mutation tenant binding

**Level:** P-L1

A valid RecoveryEffectId/ProviderOperationId from another business must not become sufficient lookup authority. Business scope is explicit and enforced end-to-end.

---

## K. Innovation safety / anti-normalization proof

The innovation layer must be tested as a constrained derivative control layer, not trusted because it is novel.

### PF-J2318-035 — Recovery Control Twin is derivative

**Level:** P-L0 + P-L1

Required:
- every twin state/action recommendation links to authoritative source/evidence IDs;
- deleting/rebuilding twin state does not delete or alter canonical work/evidence;
- twin cannot grant Clearance.

### PF-J2318-036 — Recovery Authority Re-pricing is explainable and monotone-safe

**Level:** P-L0

Given the same request, vary uncertainty, age, authority revision, source-state divergence and budget consumption.

Required:
- changed recovery disposition is explainable from named inputs;
- uncertainty/risk may narrow autonomy;
- no learned score can silently widen deterministic authority bounds.

### PF-J2318-037 — Attention Gradient affects prioritization, not truth

**Level:** P-L0

Changing attention score may reorder operator work but must not alter:
- failure certainty;
- original/recovery outcome;
- Clearance;
- provider truth;
- financial truth.

### PF-J2318-038 — innovation overlays have kill-switch / downgrade behavior

**Level:** P-L1 + selected P-L5

Disable Recovery Control Twin / adaptive budget recommendation / attention ranking.

Required: deterministic core work, authority, recovery and projection safety remain operable; disabling innovation must not corrupt canonical state.

### PF-J2318-039 — Causal Recovery Horizon never fabricates edges

**Level:** P-L0 + P-L1

Causal descendant/recovery impact display must derive only from durable lineage/evidence. Missing lineage is shown as incomplete/unknown, not guessed into a mutation dependency.

---

# 6. Deterministic fault-injection catalog

The implementation proof harness should expose named injection points rather than rely on timing luck.

```text
FI-01 after worker claim before action execution
FI-02 after ActionDispatcher attempt failure evidence before BullMQ retry wake
FI-03 after provider accepts effect before response
FI-04 after provider success response before provider ID/local outcome persistence
FI-05 after provider ID/outcome persistence before consequence write
FI-06 after WebhookEvent occurrence insert before application
FI-07 after Payment persistence before ledger posting
FI-08 after ledger posting before invoice/order reconciliation
FI-09 after invoice reconciliation before secondary timeline/event emission
FI-10 during retry backoff before next attempt, then revoke/pause authority
FI-11 during cancellation/claim race at deterministic barrier
FI-12 after child 1 success before parent loop reaches child 2
FI-13 after one social destination succeeds before another destination begins/completes
FI-14 after local delete before/without provider reversal
FI-15 between projection materialization and operator mutation request
FI-16 during projection rebuild with one degraded source adapter
```

Every FI point should state whether restart is simulated by:
- re-instantiating service with same durable DB;
- terminating/restarting worker process/container;
- queue reconnection;
- replaying provider callback;
- explicit repair/reconciliation command.

---

# 7. Negative oracles

For safety-critical tests, prove what **must not happen**.

```text
NO duplicate provider create/send/capture/refund for same EffectId
NO failed attempt row consuming future legitimate retry
NO retry after pause/revoke without current Clearance
NO provider re-send when provider success already confirmed
NO WebhookEvent dedupe suppressing missing consequence repair
NO duplicate ledger posting/reversal
NO stale projection authorizing mutation
NO migration certainty upgrade without evidence
NO parent resume replaying successful child
NO local soft delete represented as external reversal success
NO cross-tenant projection join or recovery mutation
NO learned/adaptive innovation component widening authority
NO contradiction flattening into a misleading single status
```

The preferred oracle is a combination of:
- provider operation counter/provider object identity;
- durable source rows;
- effect/attempt/recovery lineage;
- ledger balances and posting IDs;
- invoice/domain state;
- current Clearance evaluation;
- projection evidence references.

---

# 8. K10 composed proof harness

Existing finance tests already provide useful accounting recipe characterization. Do not discard them.

The missing proof is compositional:

```text
Provider simulator
      ↓
ProviderOperationId / webhook evidence
      ↓
Payment evidence
      ↓
RevenuePostingService / FinancialTransaction
      ↓
Invoice/order reconciliation
      ↓
Temporal Work Projection
```

Crash each edge separately, then prove eventual convergence without repeating the provider effect.

Canonical final check:

```text
provider outcome
+ Payment evidence
+ ledger consequence
+ invoice/order reconciliation
= FINANCIAL_TRUTH_CONVERGED
```

The current `finance-revenue-flow.e2e.test.ts` proves useful ledger recipe arithmetic/idempotent posting behavior, but it is not by itself proof of the above provider-to-domain chain because it uses an in-memory harness and directly invokes posting callbacks.

---

# 9. Webhook apply-state proof transition

The implementation packet must not simply “remove dedupe.” It must split two responsibilities:

```text
OCCURRENCE DEDUPE
Did we receive this provider event identity before?

APPLICATION COMPLETENESS
Which consequences of this occurrence are durably complete?
```

Target proof state can be implemented through strengthened existing seams; this artifact does not mandate a new universal event table/schema.

Minimum semantic proof:

```text
SEEN/CLAIMED
→ APPLYING
→ APPLIED
```

or an equivalent existing-domain representation must make it possible to distinguish:
- already fully applied;
- currently/incompletely applied;
- failed application requiring repair.

The exact physical shape remains an execution-packet concern only after backward re-audit.

---

# 10. Concurrency harness requirements

Concurrency tests must be deterministic enough to reproduce races repeatedly.

Preferred pattern:

```text
worker A reaches barrier X
worker B reaches competing operation Y
release both in controlled order
assert source row + provider operation count + evidence lineage
repeat reverse order
```

High-value races:
- claim vs claim;
- claim vs cancel;
- retry wake vs authority revoke;
- webhook apply vs duplicate redelivery;
- consequence repair vs webhook redelivery;
- projection refresh vs operator mutation;
- two repair workers attempting same ledger consequence;
- provider lifecycle callback vs local synchronous-success persistence.

Random stress/property tests may supplement this but cannot replace deterministic race cases.

---

# 11. Migration proof dataset

Before migrating live rows, create a versioned fixture corpus that represents both common and pathological legacy states.

Each fixture should record:

```yaml
source_model: ...
raw_status: ...
companion_fields: ...
provider_evidence: ...
attempt_evidence: ...
domain_evidence: ...
expected_classification:
  work_state: ...
  original_outcome: ...
  failure_certainty: ...
  consequence_state: ...
  recovery_state: ...
classification_confidence: PROVEN|DERIVABLE|AMBIGUOUS|UNRECOVERABLE_UNKNOWN
classification_version: ...
```

Proof must include idempotent repeated backfill/rebuild and adapter-version upgrade behavior.

No production row count/distribution has been measured in this forensic tranche. Execution planning still needs safe read-only row distributions before a live migration packet.

---

# 12. Innovation pressure test — proof as differentiation

The anti-normalization rule applies to testing too. A conventional suite often proves that workers retry and jobs eventually complete. KeyFlowOS needs to prove a stronger capability:

> **The system can explain and safely control work when local truth, provider truth, authority, financial consequences and historical evidence disagree.**

That yields a differentiated proof target:

```text
not merely:
  eventually retry until green

but:
  preserve uncertainty
  identify what actually happened
  preserve exact causal/effect identity
  calculate what remains incomplete
  re-price current recovery authority
  expose contradictions to KEY/operator
  execute only the currently legal/safe next effect
  prove convergence without duplicate external harm
```

This is the proof counterpart to the Recovery Control Twin / contradiction-aware Temporal Work Projection.

Novelty remains constrained by deterministic invariants:
- the twin is derivative;
- attention is prioritization only;
- adaptive recovery budgets cannot widen authority;
- causal horizons cannot invent lineage;
- all innovation overlays must be disableable without losing canonical safety.

---

# 13. Proof gates before a bounded KF-EXEC packet

## G-P0 — characterization preservation

Existing useful tests continue to pass or are intentionally rewritten where the target changes a known unsafe semantic.

Examples:
- invoice math/legal transitions preserved;
- system actor tenant scoping preserved;
- real social publication honesty preserved;
- ledger recipe arithmetic/idempotency preserved.

## G-P1 — identity / retry

PF-005 through PF-012 required for any execution slice involving retries/long-running work.

## G-P2 — external uncertainty

PF-001 through PF-004 and PF-024 required for any provider-mutating slice.

## G-P3 — consequence repair

PF-013 through PF-019 required for webhook/financial/provider consequence slices.

## G-P4 — authority / recovery control

PF-020 through PF-024 required before autonomous or operator-triggered recovery.

## G-P5 — reversal semantics

PF-025/026 required for any external deletion/reversal scope.

## G-P6 — migration compatibility

PF-027/028 plus real read-only row distributions required before data migration.

## G-P7 — projection safety

PF-029 through PF-034 required before operator/KEY recovery actions are sourced from Temporal Work Projection.

## G-P8 — innovation safety

PF-035 through PF-039 required before enabling adaptive/derivative innovation overlays in a production execution slice.

---

# 14. Recommended execution-proof order

When implementation is eventually authorized, do not attempt all proofs at once.

```text
1. preserve/repair characterization tests that lock current semantics
2. establish durable EffectId / AttemptId / failure-certainty proofs
3. prove provider PONR + OUTCOME_UNKNOWN behavior with simulator
4. prove webhook apply completeness and consequence repair
5. compose K10 financial convergence
6. prove recovery Clearance / revoke / budget semantics
7. prove parent-child resume + concurrency linearization
8. prove projection freshness/rebuild/tenant safety
9. prove migration fixtures/backfill classification
10. enable and prove innovation overlays last, against already-safe core
```

This order preserves the project rule:

```text
CORRECTNESS FLOOR
→ CAUSAL / RECOVERY SAFETY
→ KEYFLOW DIFFERENTIATION
```

without collapsing the final architecture back into a conventional retry engine.

---

# 15. Backward re-audit inputs created by this proof inventory

The next constellation audit must ask:

### J1 Business Birth
- can the projection/recovery mesh exist before all integrations are configured without fabricating external certainty?
- are default recovery budgets/authority safe at business creation?

### J25 Human Authority Lifecycle
- do membership/role/delegation changes invalidate recovery authority promptly?
- can stop authority remain usable when execute authority is revoked?

### J2 Governed Action
- is exact action/effect fingerprint preserved through retries and recovery?
- is RecoveryEffectId routed through the same control machinery without parallel approval truth?

### J15 Approval/Governance
- does current Clearance re-evaluation coexist correctly with durable historical ControlEvidence?
- can bounded same-effect retries be expressed without perpetual approval?

### J6 Proactive KEY
- does learning remain advisory under uncertainty/recovery pressure?
- can pause/kill/revoke stop descendants/retries deterministically?

### J14 External Ingress
- does occurrence dedupe remain distinct from application completeness?
- do out-of-order/replayed provider events repair rather than corrupt consequences?

### J23 Temporal Flow
- does every work family preserve occurrence/effect/attempt identity and terminal monotonicity?

### J18 Failure → Recovery
- do failure certainty, recovery action, recovery outcome and consequence state remain independent and composable?

### K3/K6/K7/K8/K9/K10/K11
- does any proof requirement expose an ownership gap or duplicated source of truth across governance, legal transition, temporal work, evidence, provider truth, finance and recovery?

---

# 16. Final verdict

The target has advanced from “architecturally plausible” to **explicitly falsifiable**.

What remains is not generic “add tests.” The proof burden is now exact:

```text
Can KeyFlowOS survive a crash at every meaningful side-effect boundary,
retain uncertainty rather than lie,
prevent duplicate external harm,
repair only missing consequences,
re-evaluate current authority,
keep tenants isolated,
and expose contradictory reality without turning the projection into a second truth source?
```

Until those properties are implemented and the relevant proof gates are actually executed:

```text
J23/J18 semantic target = CONVERGED
J23/J18 runtime proof    = NOT YET ESTABLISHED
KF-EXEC generation       = BLOCKED
```

No production code was modified and no runtime tests were executed in this proof-inventory pass.
