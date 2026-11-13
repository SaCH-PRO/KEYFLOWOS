# J20 — Entitlement, Metering & Cost Convergence Review

Checkpoint: `J20-CONV-2026-09-17-01`  
Date: 2026-09-17  
Input: J20 M001 + M002 and whole-system re-audit `WSR-2026-09-17-01`  
Disposition: **PROVISIONALLY TARGET-ALIGNED — NAMED ENTITLEMENT / METERING CORE ONLY; IMPLEMENTATION AND RUNTIME PROOF OPEN**.

## 1. Decision

J20 does not need a parallel billing engine.

The selected target is:

```text
Commercial Plan Revision
+ current Billing Authority
+ Payment / Provider Evidence
→ EntitlementPeriod
→ EffectiveEntitlement projection
→ operation-level admission
→ AI / resource EffectOccurrence
→ UsageEvidence + ProviderCostEvidence
→ billable classification fixed at occurrence
→ period/currency/version-bound CustomerChargeAssessment
→ K10 invoice/payment/ledger settlement
→ correction/reconciliation without replaying the original effect
```

This becomes **KF-REC-058 — Subscription Entitlement, Metering & Cost Reconciliation Contract**.

## 2. Ownership boundaries

### Commercial plan

Owns what is offered:

- plan identity/version;
- declared limits/features;
- price/currency;
- transition/grandfather policy.

It does not prove payment or current entitlement.

### Subscription / payment evidence

Owns commercial lifecycle evidence:

- trial;
- accepted provider/manual evidence;
- current period;
- cancellation/past-due/expiry;
- payment occurrence and certainty.

A local ACTIVE row alone is not provider settlement proof.

### Effective entitlement

Answers:

> What may this business consume now under the accepted commercial state?

It is a projection from accepted commercial evidence, not a second payment ledger.

### Operation admission

The exact operation consumes the effective entitlement before material effect where the entitlement is load-bearing.

A UI-hidden feature is not equivalent to server-side admission.

### AI occurrence / usage / provider cost

One logical AI effect needs stable correlation across:

- customer-facing feature;
- model/provider attempt(s);
- provider cost evidence;
- customer usage classification;
- fallback/stream/modalities;
- retries where applicable.

AiUsageLog and LLMProviderCost may remain separate specialized records, but they require reconciliation identity.

### Customer charge

Customer allowance/overage uses the **frozen billable population** and an explicit EntitlementPeriod.

Provider cost includes system/nonbillable work and is not customer overage.

### Financial settlement

Invoice/payment/ledger/currency/reversal remain K10/KF-REC-052. J20 does not create another financial truth.

## 3. Canonical laws

1. Displayed plan != accepted subscription != payment settlement != effective entitlement.
2. Entitlement is evaluated for the current business and operation.
3. A declared limit is not enforced until an operation admission boundary consumes it.
4. Customer allowance and customer overage use one frozen billable population.
5. System/nonbillable AI remains visible in platform/provider cost.
6. EntitlementPeriod is explicit; calendar month is not silently substituted for a subscription period.
7. Provider budget and customer allowance are different controls.
8. Soft routing budget is not a hard spend cap.
9. A hard budget requires admission/reservation or another concurrency-safe fence before effect.
10. Model effect identity survives usage/cost persistence failure.
11. Usage/cost reconciliation repairs evidence; it does not replay a completed model effect.
12. Direct gateway/modalities cannot bypass a load-bearing admission contract.
13. AI/provider cost and customer charge retain their own currencies/units/versioning.
14. Subscription/provider callbacks authenticate origin but still require current account/business binding.
15. Activation/cancel/renewal/migration preserve history and do not revive superseded entitlement.
16. Legacy unenforced plan promises require explicit rollout/grandfather policy before becoming hard gates.

## 4. New allocations

### F229 / C179

Customer allowance admission uses `billable=true`, while current overage/credits-remaining summaries aggregate all AiUsageLog rows. One customer charge concept therefore uses two populations.

### F230 / C180

Commercial Subscription carries `currentPeriodStart/currentPeriodEnd`, while AI allowance/overage/provider-budget windows use calendar-month boundaries. Period identity can diverge from the paid entitlement period.

### F231 / C181

Direct ModelGateway/modality callers can bypass AiUsageService pre-effect admission and AiUsageLog creation, while ModelGateway provider-budget spend reads AiUsageLog even though gateway provider-cost evidence is written to LLMProviderCost. The admission/metering population is therefore not universal for gateway effects.

## 5. Backward re-audit

### K3 / J2 / J15

Billing-authority and hard-budget mutation require effective authority proportional to the commercial/financial consequence. A plan or budget setting is control-plane state, not mere business membership.

### K5

Feature/operation identity must bind entitlement admission. Plan limits should resolve against real capabilities/resources rather than UI labels.

### K8

Usage evidence and provider-cost evidence are evidence records; either can be incomplete. Reconciliation must preserve uncertainty and provenance.

### K9 / J13 / J14

Provider subscription callbacks require provider authenticity plus account/business binding. Provider event receipt is not entitlement transition completion.

### K10 / J7

Customer charge, invoice, payment and accounting settlement remain layered financial truth. No overage projection may silently become ledger truth.

### K11 / J18

Missing usage/cost evidence after a successful model effect is a repair problem, not permission to replay the model call.

### K12 / J24

Migrations must preserve historical billable classification, period identity and prior charges; proof must use isolated resources and required-case admission.

### J22

Voice/realtime modalities are a mandatory consumer stress test for F231/KF-REC-058.

No backward edge falsifies the selected contract.

## 6. Migration direction

Preferred reuse:

- keep PLANS / feature registry as declaration layer;
- keep Subscription + SubscriptionPayment, but add/fence missing lifecycle identities only where migration evidence supports it;
- strengthen existing PlanLimitGuard/checkLimit or a capability-level equivalent rather than create parallel guards;
- keep AiUsageService as a strong adapter but stop assuming it is universal;
- keep ModelGateway and LLMProviderCost;
- introduce stable correlation/reconciliation between model effect, usage and provider cost;
- change customer overage to the frozen billable basis;
- make entitlement/billing period explicit;
- classify budgets as SOFT_ROUTING or HARD_ADMISSION;
- activate dormant limits only through explicit compatibility/grandfather rules.

## 7. Proof / readiness debts

- deployed subscription/provider lifecycle conformance not established;
- final schema/index/transaction migration not selected;
- direct AI caller inventory is named but not proven exhaustive;
- J22 realtime/audio metering remains open;
- no concurrency test for active-subscription uniqueness or hard-budget reservation;
- no executed reconciliation test between AiUsageLog and LLMProviderCost;
- no customer/provider billing runtime proof;
- no migration/backfill proof.

## 8. Convergence disposition

```text
J20 = PROVISIONALLY_TARGET_ALIGNED_NAMED_ENTITLEMENT_METERING_CORE_ONLY
```

This is enough to move the programme frontier to J21 while retaining J20 reopen triggers:

- provider lifecycle semantics contradict the selected EntitlementPeriod;
- a later AI path cannot be reconciled to occurrence/admission identity;
- migration cannot preserve historical billable/charge semantics;
- runtime/concurrency tests falsify the selected contract;
- J21/J22 exposes an entitlement meaning not covered by the contract.

Production implementation remains unauthorized.
