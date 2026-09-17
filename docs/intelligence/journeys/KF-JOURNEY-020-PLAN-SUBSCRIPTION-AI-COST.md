# KF-JOURNEY-020 — Plan / Subscription / AI Cost

Checkpoint: `J20-CONV-2026-09-17-01`  
Status: **PROVISIONALLY TARGET-ALIGNED — NAMED ENTITLEMENT / METERING CORE ONLY**  
Implementation forensic baseline: `8f173bfe79f1418159cf4099ea18b0d60d203ec2`.

Primary kernels: K3, K5, K8, K10, K11. Secondary: K2, K7, K9, K12.  
Production implementation remains read-only / unauthorized. Runtime proof has not been executed.

## A. Definition

J20 follows commercial plan intent through subscription/payment evidence into current entitlements, operation admission, AI/resource usage, provider cost, customer overage and eventual financial settlement.

Prime distinction:

```text
plan display != paid state != entitlement
!= operation admission != effect
!= usage evidence != provider cost
!= customer charge != settlement
```

## B. Completed evidence

- `J20-PLAN-SUBSCRIPTION-AI-COST-MICROTRACE-001.md`
- `J20-PLAN-SUBSCRIPTION-AI-COST-MICROTRACE-002.md`
- `J20-ENTITLEMENT-METERING-CONVERGENCE-REVIEW.md`

M001 established payment/entitlement and billable-basis pressure. M002 traced schema/period/cost/admission lineage and direct AI bypasses. The convergence review selected KF-REC-058.

## C. Selected target contract

```text
Commercial Plan Revision
+ Billing Authority
+ accepted Payment / Provider Evidence
→ EntitlementPeriod
→ EffectiveEntitlement
→ exact operation admission
→ EffectOccurrence
→ UsageEvidence + ProviderCostEvidence
→ frozen billable classification
→ CustomerChargeAssessment
→ K10 financial settlement
→ correction/reconciliation
```

This composes with K2/K3/K5/K8/K9/K10/K11/K12 rather than creating a parallel billing architecture.

## D. Canonical J20 findings

- **F229/C179** — customer allowance and overage use different billable populations.
- **F230/C180** — subscription period identity and AI metering/budget calendar period diverge.
- **F231/C181** — direct gateway/modality paths can bypass AiUsageService admission/metering while ModelGateway budget reads an AiUsageLog population narrower than gateway provider-cost evidence.

Existing ownership is reused for subscription/payment partial commits, settlement evidence, usage-write recovery and soft-vs-hard budget semantics.

## E. Positive seams to preserve

- PLANS / feature declaration;
- Subscription / SubscriptionPayment history;
- frozen AiUsageLog.billable classification;
- AiUsageService pre-effect admission on tracked paths;
- PlanLimitGuard + checkLimit;
- ModelGateway routing/fallback;
- LLMProviderCost + trace evidence;
- K10 financial settlement and correction;
- source-test debt ledgers that prevent silent new unenforced/unpriced declarations.

## F. J20 invariants

1. Displayed plan is not entitlement proof.
2. Active local subscription is not provider settlement proof.
3. Effective entitlement is current, business-scoped and operation-specific.
4. A declared limit is not real enforcement until a write/effect boundary consumes it.
5. Customer allowance and overage use one frozen billable population.
6. System AI cost remains visible but is not customer overage by default.
7. EntitlementPeriod is explicit.
8. Provider budget and customer allowance are different controls.
9. Soft routing budget is not a hard cap.
10. Hard budget requires concurrency-safe pre-effect admission.
11. Direct AI modalities cannot bypass selected admission semantics.
12. Model effect, usage and provider cost have stable correlation.
13. Missing usage/cost evidence is repaired without replaying the model effect.
14. Billing/rate/currency/policy versions needed for historical charge reconstruction are preserved.
15. Subscription/provider callbacks require authenticity and current account/business binding.
16. Billing-control mutations require proportional authority.
17. Dormant plan limits require explicit compatibility/grandfather rollout.

## G. Proof state

J20 designed cases: 20. Runner bindings: 0. Status: **NOT_EXECUTED**.

No provider/customer data, payment gateway, model, DB migration or concurrency test was executed by this programme.

## H. Reopen triggers

Reopen J20 if:

- provider subscription lifecycle contradicts EntitlementPeriod;
- J22 exposes a modality that cannot fit effect/admission/metering identity;
- migration cannot preserve historical billable/charge semantics;
- a later direct caller bypasses selected mandatory admission;
- runtime/concurrency proof falsifies the contract.

## I. Disposition

J20 is sufficiently target-aligned at the named core to move the programme frontier to **J21 Public Customer Experience**.

This is architectural convergence only, not implementation conformance or production completion.
