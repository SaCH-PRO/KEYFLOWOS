# J20 - Plan, Subscription and AI Cost: Microtrace 001

Checkpoint: `J20-M001-2026-09-17-01`  
Date: 2026-09-17  
Intelligence input: `2bc1bf52ca13c0fd4a64375295c783649db9092c`  
Implementation forensic baseline: `8f173bfe79f1418159cf4099ea18b0d60d203ec2`  
Result: **J20 ACTIVATED; FIRST SUBSCRIPTION / ENTITLEMENT / AI-USAGE / COST TRACE COMPLETE; NOT CONVERGED**.

Production source, schema, settings, workflows and assertions remain read-only. No subscription mutation, model call, provider operation, database test, boot, concurrency or migration test ran. The programme map remains frozen at J24-PA by user instruction; scheduled truth/audit/burndown/reflect cycles remain halted.

## 1. Question and bounded scope

J20 asks whether KeyFlowOS can truthfully carry commercial plan state into current feature permission, AI admission, actual model execution, usage evidence and customer/platform cost without confusing any of them.

```text
displayed plan != paid subscription != current entitlement
!= AI credit admission != provider budget admission
!= successful model effect != usage log != customer overage
!= provider cost != invoice != settled payment
```

This trace covers SubscriptionsService/controller, plan/feature definitions and enforcement debt, AiUsageService and ModelGateway cost/budget seams, plus the declared subscription/usage records needed for those paths. It is not a full payment-gateway webhook, every AI caller, every entitlement surface or deployed-data audit.

## 2. Subscription state is an entitlement input, not payment proof

SubscriptionsService.getActiveSubscription selects the newest ACTIVE/TRIALING row. If none exists it returns an effective FREE plan even without a stored free subscription. An expired trial is changed to EXPIRED during this read and the result falls back to FREE. These are concrete current-state semantics, not proof of external billing status.

activateSubscription first cancels existing ACTIVE/TRIALING rows, then creates a new ACTIVE row using caller-supplied plan/currency/gateway/gatewaySubId. In the inspected method there is no provider receipt verification or shared transaction around cancelling the old subscription and creating the new one.

The controller exposes trial, activate, cancel, checkout and record-payment under AuthGuard + BusinessGuard. No owner/billing-role decorator or service-level billing-authority decision is present in the inspected routes. This establishes a business-member authorization boundary, not an unauthenticated route and not proof of what BusinessGuard itself considers membership.

createCheckout validates a plan/gateway and returns a `checkoutReady: true` descriptor; it does not perform an external checkout in the inspected method. Therefore that response is purchase intent/preparation, not provider acceptance or an active subscription.

recordManualPayment calls activateSubscription first, then creates SubscriptionPayment(COMPLETED). If the later payment-row create fails, the new ACTIVE subscription can already exist while no matching payment record was persisted. Conversely, a successfully stored manual payment is a local assertion based on the caller-supplied method/reference/notes, not independently verified bank/provider settlement in this method. This is a conditional local partial-outcome sequence, not an observed customer incident.

## 3. Declared plan promises and effective enforcement are different coordinates

PLANS and FEATURE_REGISTRY describe tier limits/booleans. SubscriptionsService.checkLimit implements many counters. The existing source-level `plan-limit-enforcement.spec.ts` explicitly documents a measured enforcement inventory at that baseline: six of twenty-five declared limits were found enforced, while nineteen remained acknowledged unenforced debt; twelve of the missing numeric resources already had checkLimit implementations but no caller.

This test source was read, not executed in this tranche. Its value is architectural: a marketed tier definition does not itself constrain a write path. J20 therefore treats **declared plan**, **effective entitlement decision**, and **enforced operation** separately. Turning on a dormant limit also has migration/blast-radius consequences for existing businesses already above it; it is not safe to make every declaration hard-enforced blindly.

AI credits are a positive seam: the source test specifically identifies aiCreditsPerMonth as enforced, and AiUsageService centralizes credit admission for its tracked wrappers. That does not establish that every AI-producing path funnels through those wrappers.

## 4. Customer AI allowance and system AI cost currently disagree in the billing summary

`assertCreditsFor` explicitly skips non-billable system features. `checkCredits` computes allowance consumption from AiUsageLog with `billable: true`. This correctly protects customers from product housekeeping exhausting their user allowance.

But `getUsageSummary` aggregates **all** AiUsageLog credits for `creditsUsed`, by-feature totals and overage math; it does not filter `billable: true`. It then computes:

```text
overageCredits = max(0, creditsUsed - plan.aiCreditsPerMonth)
overageCost = overageCredits * configured overage rate
```

So system/background work that is excluded from admission/allowance can still increase displayed overage and reduce displayed creditsRemaining. SubscriptionsService.getBillingDashboard independently performs the same all-log aggregate before overage calculation. This is a concrete cross-method contradiction: the customer can be allowed based on billable usage while the billing views charge/display overage from billable + system usage.

Static example: plan allowance 50; user-billable work 40; system work 30. `checkCredits` sees 40 and allows another normal 1-credit request. The usage/billing summary sees 70 and reports 20 overage credits. This is source arithmetic, not an executed invoice or proof money was collected.

Provider/API `estimatedCost` remains useful as platform cost visibility and should include system work. The fix is not to hide system cost; it is to maintain separate customer-allowance/overage and platform-cost bases.

## 5. Successful AI effects can outrun usage persistence

AiUsageService performs the model/gateway call and then invokes `persistUsageLog(...).catch(...)` without awaiting it before returning the successful result. persistUsageLog retries its row write up to three times, then logs a critical error and gives up. This is an intentional availability seam, but it means a successful model effect can exist without a durable AiUsageLog row.

Because monthly allowance, overage display and several summaries are derived from AiUsageLog, a failed usage write can undercount customer allowance consumption and provider-cost visibility. The next call can therefore be admitted as if the missing successful call had not consumed its feature credits. This does not imply the provider was necessarily billed exactly as the local estimate; it establishes missing local usage evidence after a successful application result.

The gateway separately writes LLM cost through LLMCostService after a completed response, also asynchronously/catch-logged. It also emits a trace before the cost write. These are useful independent evidence seams; they are not automatically reconciled to AiUsageLog, subscription overage or a customer invoice.

## 6. Provider budget caps are currently routing preferences, not hard spending reservations

ModelGatewayService evaluates per-business budget caps against current-month recorded spend and filters candidate providers. If every candidate is over budget, both buffered and streaming paths deliberately fall back to the original candidate list and continue, logging that routing is degraded.

Therefore a configured provider/overall budget cap is not a hard stop. It can steer routing while options remain, but cannot be described as guaranteed spend admission. There is also no reservation in the inspected path for concurrent in-flight calls: checks use recorded month-to-date spend, then the model executes, with cost written later.

This is not automatically wrong—soft budgets can be a valid product mode. J20 requires the mode to be explicit. A user-facing `budget cap` presented as a hard maximum must have atomic/fenced reservation and current-price semantics; an advisory optimization budget must be labelled advisory and never substituted for customer credit entitlement.

## 7. Price, credit and cost are separate units

AI_CREDIT_COSTS assigns product credits by feature; ModelGateway estimates provider USD cost by actual provider/model tokens; subscriptions price plans and overage in subscription currency. These are different value layers.

A feature credit is not a token and not a provider dollar. A quality retry can increase tokens/provider estimated cost while the logical feature charge remains one declared creditCost; that can be intentional if credits price a logical product action. Conversely, fallback pricing for an undeclared feature (`|| 1`) is an acknowledged decision-debt pattern in source, not proof that one credit equals its real provider cost.

The selected target must therefore retain: product credit policy/version, billable/system classification, actual attempt/provider/model/token evidence, provider cost estimate/source/version, customer overage price/currency, and invoice/settlement reference separately.

## 8. Preliminary ownership and candidate requirements

Existing owners should be reused rather than replaced:

- K2/K3/K5: current actor, billing/admin authority and exact operation class for subscription mutations.
- K10 / REC052: monetary stage, currency, pricing/valuation evidence and correction.
- K11 / REC048: subscription/payment partial outcomes, model-attempt uncertainty and consequence repair.
- J13/K9: current external-provider authority where provider credentials or external subscription callbacks are involved.
- J24/K12: isolated verification, independent acceptance and reversible rollout.
- J19: retention/disposition for detailed usage/trace evidence.

Working requirements, not final contract: one authoritative entitlement projection from accepted commercial state; owner/billing-authority admission for material subscription mutations; payment/provider evidence distinct from plan activation; durable AI attempt/usage identity; separate customer-billable and system-cost pools; explicit hard-vs-advisory budgets; period/version/currency-bound overage; and reconciliation from successful model effects to usage/cost/billing without manufacturing provider effects during repair.

No new F/C/REC/concept ID is allocated in this first trace. F228/C178 retains J8 time-billing meaning; next free remains F229/C179/KF-REC-058.

## 9. Local proof designs — NOT_EXECUTED

| Case | Required isolated characterization / eventual acceptance |
|---|---|
| J20-X01 | Business member without billing authority cannot activate/cancel/record-payment; authorized billing actor can. |
| J20-X02 | Manual-payment persistence failure after activation cannot leave an unexplained paid entitlement; repair/reconciliation preserves old/new subscription history. |
| J20-X03 | Checkout-ready intent, provider acceptance, active subscription and settled payment remain distinguishable under retries and webhook replay. |
| J20-X04 | Billable40 + system30 on limit50 admits normal credit correctly and reports customer overage0 while still reporting full platform AI cost. |
| J20-X05 | Successful AI effect with failed AiUsageLog persistence is reconciled to one usage occurrence without replaying the model or double charging credits. |
| J20-X06 | Concurrent calls near a hard budget either reserve safely or the configured budget is explicitly advisory; no UI or API calls a soft routing preference a guaranteed cap. |
| J20-X07 | Feature credit, token/provider cost and customer overage value preserve distinct units, versions and currency; fallback/model retry does not silently change the billed basis. |
| J20-X08 | Turning on a formerly unenforced plan limit uses explicit migration/grandfather/transition policy rather than unexpectedly rejecting existing businesses. |
| J20-X09 | Trial expiry, cancellation, provider callback and stale cached/displayed plan resolve to one current entitlement revision without relying on UI state. |
| J20-X10 | Shadow pricing/entitlement changes compare historical usage without model calls, subscription writes or customer charges. |

Ten J20 local cases, zero bindings, NOT_EXECUTED. Prior J9(26), J8(24) and J13(44) inventories remain separate and unchanged.

## 10. Exact next action

Next: **J20_SUBSCRIPTION_PAYMENT_ENTITLEMENT_AND_USAGE_LINEAGE_TRACE**.

Produce `J20-PLAN-SUBSCRIPTION-AI-COST-MICROTRACE-002.md`.

1. Trace Subscription/SubscriptionPayment/AiUsageLog/LLMCost declared schema identity, indexes and period/currency fields, plus actual payment-gateway subscription callbacks/renewal/cancellation writers.
2. Enumerate actual AI entrypoints that bypass or reuse AiUsageService wrappers, and distinguish completed, failed, fallback and streamed attempts from usage/cost rows. Inspect entitlement callers for boolean and numeric plan features rather than trusting the source test inventory alone.
3. Compare surviving subscription-authority, billable-basis, missing-usage and hard-budget candidates against current canonical homes before allocation. Refine one entitlement/usage/reconciliation target and migration requirements. Do not execute model calls or billing operations.

J20 remains NOT CONVERGED. Keep production read-only, baseline fixed, owner cycles halted and programme map frozen until explicitly requested.

## 11. Source manifest and integrity limits

Pinned implementation baseline `8f173bfe79f1418159cf4099ea18b0d60d203ec2`:

- `apps/server/src/modules/subscriptions/subscriptions.service.ts` — active/trial state, mutation, limits, checkout, manual payment and billing-dashboard paths.
- `apps/server/src/modules/subscriptions/subscriptions.controller.ts` — complete declared route guards and subscription mutation surfaces.
- `apps/server/src/modules/subscriptions/plans.ts` — plan/feature registry, AI credit pricing, system/billable classification and overage constants.
- `apps/server/src/modules/subscriptions/plan-limit-enforcement.spec.ts` — source-level enforcement debt inventory, read only / not executed.
- `apps/server/src/modules/ai/ai-usage.service.ts` — credit admission, summaries, tracked wrappers, async usage persistence and billing summary.
- `apps/server/src/modules/ai/model-gateway.service.ts` — provider/model routing, recorded cost, budget filtering/degraded continuation and stream behavior.
- `apps/server/src/modules/key-connector/ai-gateway/ai-gateway.service.ts` — inspected as adjacent AI-routing source; current methods are placeholder execution and are not treated as the primary model-spend path.

The code-search default branch was used only for path discovery; factual conclusions above come from explicit reads pinned to the forensic baseline. Source comments referring to prior production measurements are historical source text, not measurements independently reproduced here. No provider pricing, current external API behavior, customer record or secret was inspected. Context integrity: live intelligence branch matched J9-POA input; prior J9/J8/J13/J24 contracts, map pause and owner halt are preserved.
