# J20 — Plan / Subscription / AI Cost: Microtrace 002

Checkpoint: `J20-M002-2026-09-17-01`  
Date: 2026-09-17  
Implementation forensic baseline: `8f173bfe79f1418159cf4099ea18b0d60d203ec2`  
Intelligence input: `f11d43676737ea300539e59c26f7481a6930a585`  
Result: **SUBSCRIPTION / ENTITLEMENT / USAGE / PROVIDER-COST LINEAGE TRACED; J20 READY FOR BOUNDED CONVERGENCE REVIEW**.

Production code/schema/settings/workflows/assertions remain read-only. No model, provider, subscription, database, boot, concurrency or migration execution was performed. Source tests were read only. Programme-map refresh remains paused by user instruction.

## 1. Scope

M002 closes the named lineage questions left by M001:

1. exact Subscription / SubscriptionPayment / AiUsageLog / LLMProviderCost schema identity and period/currency semantics;
2. provider subscription lifecycle writer discovery at the fixed baseline;
3. AI paths that reuse or bypass AiUsageService admission/metering;
4. actual plan-limit enforcement seams;
5. bounded canonical comparison before allocation.

This is a named-source static trace. It is not deployed-data, provider, migration or runtime proof.

## 2. Subscription and payment identities

### Subscription

The schema stores:

```text
Subscription
  id
  businessId
  plan
  status
  currency
  priceMonthly
  trialEndsAt
  currentPeriodStart
  currentPeriodEnd
  cancelledAt
  gateway
  gatewaySubId
  gatewayCustomerId
```

The only declared index is `(businessId,status)`. There is no schema uniqueness constraint on an active subscription per business or on `gatewaySubId`.

`activateSubscription()` cancels existing ACTIVE/TRIALING rows and then creates a new ACTIVE row. Those operations are not in one inspected transaction and the schema does not independently fence concurrent ACTIVE creation. This remains a migration/concurrency proof debt rather than a new canonical allocation in this tranche.

### SubscriptionPayment

The schema stores:

```text
subscriptionId
businessId
amount Float
currency
method
status
reference
gateway
gatewayTxnId
periodStart
periodEnd
createdAt
```

There is no inspected uniqueness constraint on `gatewayTxnId`, `reference`, or a payment occurrence identity.

M001 already established that `recordManualPayment()` activates the subscription before it writes the COMPLETED payment row. M002 therefore retains the existing K10/K11 consequence-completeness ownership rather than allocating another generic partial-commit finding.

## 3. Provider subscription lifecycle writer discovery

Repository search at the fixed baseline found `SubscriptionsService` consumers in its controller, plan guard, AI usage, CRM/bookings/commerce limit paths and tests. Searches for `gatewaySubId`, `SubscriptionPayment` writers, subscription renewal/cancellation callback handling and subscription-provider lifecycle events did not establish a separate provider webhook/callback owner that reconciles ACTIVE / PAST_DUE / renewal / cancellation from an external subscription provider.

This is deliberately classified as:

```text
SEARCH-SCOPED NOT ESTABLISHED
!= EXHAUSTIVE PROOF THAT NO PROVIDER LIFECYCLE INTEGRATION EXISTS
```

The target therefore requires provider/manual evidence adapters before external commercial state can be called settled.

## 4. AI billing period is not the subscription period

`Subscription` carries `currentPeriodStart/currentPeriodEnd`.

But:

- `AiUsageService.checkCredits()` starts at the first day of the current calendar month;
- `AiUsageService.getUsageSummary()` uses the current calendar month;
- `SubscriptionsService.getBillingDashboard()` uses the current calendar month;
- `ModelGatewayService.getCurrentMonthSpend()` and budget status use the current calendar month.

Therefore a business whose paid subscription starts mid-month can have a commercial subscription period such as:

```text
2026-09-17 -> 2026-10-17
```

while AI allowance/overage/budget accounting uses:

```text
2026-09-01 -> 2026-09-30
then resets 2026-10-01
```

No inspected contract binds allowance reset, customer overage, provider budget and subscription renewal to the same period identity.

This is a distinct semantic root, not merely a display bug.

## 5. Customer allowance and overage use different populations

M001's contradiction is confirmed against the schema's frozen `billable` field.

`checkCredits()` aggregates:

```text
businessId
+ current calendar month
+ billable = true
```

`getUsageSummary()` and `getBillingDashboard()` aggregate all AiUsageLog rows for the same month before calculating credits used and overage.

The schema comment explicitly says `billable` is stored so historical invoices do not change when feature classification changes. That strengthens, rather than weakens, the requirement that customer overage consume the frozen billable population.

The existing integration source test verifies system work is recorded but excluded from the allowance. It does not make the all-row overage calculation correct.

## 6. ModelGateway provider-cost evidence and budget admission use different ledgers

`ModelGatewayService` records buffered and streaming model cost through:

```text
recordCostFromResponse / recordCostFromStream
→ LLMCostService.recordCost()
→ LLMProviderCost
```

The model gateway also emits Langfuse trace evidence before the LLMProviderCost write.

However `ModelGatewayService.getCurrentMonthSpend()`, which drives `getBudgetStatus()` and budget candidate filtering, aggregates **AiUsageLog.estimatedCost**, not `LLMProviderCost.totalCost`.

This matters because direct callers of `ModelGatewayService.complete()/streamComplete()` do not automatically traverse AiUsageService.

Named direct gateway callers found in the fixed-baseline search include examples such as:

- call-task script generation;
- Genome chat;
- multiple Key Cortex services;
- Business Genesis / market-strategy generation;
- Key Cortex query pipeline streaming.

Those calls can therefore create provider/model effects and LLMProviderCost evidence while lacking the AiUsageLog row that the gateway itself later uses as its budget-spend population.

Canonical distinction:

```text
PROVIDER COST EVIDENCE
!= CUSTOMER USAGE LEDGER
!= PROVIDER BUDGET RESERVATION / ADMISSION
```

A provider budget cannot be called complete if its spend basis omits valid gateway effects.

## 7. AiUsageService is not a universal pre-effect admission boundary

AiUsageService has a strong local seam:

```text
track*
→ rate limit
→ assertCreditsFor()
→ ModelGateway / direct modality call
→ persistUsageLog()
```

But repository search shows multiple direct ModelGateway callers.

There is also a voice-specific split:

- `OpenAiVoiceProvider` uses `AiUsageService.trackAudio()`, which performs pre-effect credit admission;
- `KeyCortexVoiceService` performs the OpenAI TTS call directly, then calls `trackAudioUsage()` after the effect. `trackAudioUsage()` writes usage but does not call `assertCreditsFor()`;
- `RealtimeBridgeService` opens an OpenAI realtime WebSocket directly; its J20 metering/admission lineage is not established by this trace and is reinjected into J22.

Thus:

```text
USAGE LOGGED AFTER EFFECT
!= EFFECT WAS ADMITTED BEFORE EXECUTION
```

and:

```text
MODEL GATEWAY USED
!= CUSTOMER CREDIT ADMISSION APPLIED
```

## 8. Actual plan entitlement enforcement

The existing `plan-limit-enforcement.spec.ts` source remains valuable evidence, not an executed result in this programme.

At its recorded baseline it identifies six of twenty-five declared plan limits as actually enforced and maintains a debt ledger for the rest. `SubscriptionsService.checkLimit()` implements more resources than have call sites.

Positive current seams include:

- AiUsageService credit admission for tracked billable AI;
- PlanLimitGuard + `@RequirePlanLimit`;
- direct public booking `checkLimit`;
- selected commerce/bookings/CRM/automation route enforcement.

Target migration cannot simply turn every dormant limit on: legacy businesses may already exceed unenforced declarations. Enforcement activation requires explicit transition/grandfather policy and compatibility proof.

## 9. Canonical comparison

### Reused existing ownership

The following M001/M002 pressures are specializations of existing architecture and do not get new IDs:

- local ACTIVE subscription before matching payment row -> K10 / KF-REC-052 + K11 / KF-REC-048;
- provider/manual settlement evidence distinction -> K9/K10/J13;
- fire-and-forget usage persistence loss -> K8/K11 consequence/evidence completeness;
- soft provider routing budget vs hard spend authority -> K3/K10/K11;
- dormant advertised plan limits -> J20 migration/readiness debt + K5 capability admission.

### Genuinely distinct J20 roots

Three roots survive comparison:

1. customer allowance and overage calculate from different frozen billable populations;
2. subscription commercial period and AI allowance/overage/budget period are not the same identity;
3. direct gateway / modality paths can bypass the AiUsageService admission+usage ledger while provider-cost evidence is recorded elsewhere, and ModelGateway budget admission itself reads the incomplete AiUsageLog population.

These are allocated as F229-F231 / C179-C181 in the J20 supplements.

## 10. Proof pressure

M002 adds designed proof requirements; no runner binding or runtime execution occurred.

- J20-X11: system/nonbillable usage is visible in platform cost but never customer overage.
- J20-X12: allowance, overage and creditsRemaining reconcile to the same frozen billable population.
- J20-X13: a mid-period activation does not silently receive a second full allowance on calendar-month rollover unless the commercial policy explicitly says so.
- J20-X14: renewal/change/cancel preserves an explicit EntitlementPeriod identity.
- J20-X15: direct ModelGateway caller cannot evade the selected customer-admission policy.
- J20-X16: every provider model effect contributes to provider-budget spend even if customer usage persistence fails.
- J20-X17: LLMProviderCost and AiUsageLog can reconcile by stable effect/attempt identity without replaying the model.
- J20-X18: audio/realtime modalities use the same declared admission/metering contract or are explicitly classified non-billable/system.
- J20-X19: simultaneous model admissions cannot exceed a hard reserved customer/provider budget where hard mode is selected.
- J20-X20: legacy businesses above a newly activated plan limit follow explicit grandfather/transition policy rather than accidental rejection.

J20 now has 20 local designed cases total, zero bindings, NOT_EXECUTED.

## 11. Next

Proceed to the bounded J20 convergence review and select one entitlement/metering contract without inventing a new subscription engine, model gateway or financial ledger.
