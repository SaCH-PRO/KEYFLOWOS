# KF-JOURNEY-020 - Plan / Subscription / AI Cost

Checkpoint: `J20-M001-2026-09-17-01`  
Activated: 2026-09-17  
Status: **ACTIVE / FIRST SUBSCRIPTION-ENTITLEMENT-AI-COST TRACE COMPLETED / NOT CONVERGED**  
Intelligence input: `2bc1bf52ca13c0fd4a64375295c783649db9092c`  
Implementation forensic baseline: `8f173bfe79f1418159cf4099ea18b0d60d203ec2`.

Primary kernels: K3 Authority, K10 Financial Truth, K11 Recovery/Reliability, K8 Evidence/Outcome. Secondary: K2/K5/K7/K9/K12. Adjacent journeys include J7/J10/J13/J18/J19/J24 and commercial/public plan surfaces.

Production code/schema/settings/workflows/assertions remain read-only. No subscription write, model call, provider operation or application/database/migration test ran. The programme map remains frozen at J24-PA and scheduled owner-halted cycles remain halted.

## 1. Definition

J20 follows a commercial plan from display and purchase intent through subscription/payment evidence into current entitlements, AI allowance/admission, model attempts, usage/cost evidence, overage classification and eventual settlement.

```text
plan display != paid state != current entitlement
!= credit availability != provider budget
!= model success != usage row != platform cost
!= customer overage != invoiced or settled charge
```

## 2. Completed first trace

[Microtrace 001](../investigations/J20-PLAN-SUBSCRIPTION-AI-COST-MICROTRACE-001.md) is the evidence home. It establishes:

- Active/trial subscription rows drive effective plan; absence/expired trial falls back to FREE.
- Subscription activation/cancel/manual-payment routes use AuthGuard + BusinessGuard at the inspected boundary, without a separate billing/owner authority check.
- `createCheckout` is local checkout preparation, not provider acceptance.
- `recordManualPayment` activates first and writes the COMPLETED payment second, creating a conditional partial-outcome window.
- Declared plan promises are not equivalent to enforced operations; the existing source-test inventory explicitly tracks acknowledged unenforced limits.
- Customer credit admission counts only `billable: true`, while usage/billing overage summaries aggregate all AI usage rows, allowing system AI work to appear as customer overage.
- Successful model calls return before AiUsageLog persistence completes; exhausted logging retries can leave successful work outside allowance/overage accounting.
- ModelGateway provider budget caps are soft routing constraints: if every candidate is over budget, execution continues with degraded routing.
- Product credits, provider-token cost, customer overage value and settled billing are distinct units/stages.

All examples are source-derived, not observed customer billing incidents or executed tests.

## 3. Positive mechanisms to preserve

Keep centralized AiUsageService credit admission for tracked calls; explicit system-vs-billable feature classification; persisted usage/cost observability; rate limits; model routing/fallback visibility; existing plan definitions and resource checkLimit implementation; subscription history/payment records; trial expiry handling; provider budget reporting; and independent trace/cost seams.

Do not solve J20 by hiding system inference cost, treating every plan declaration as instantly enforceable, or making AI responses fail merely because one observability write is unavailable. The target needs reconciliation and truthful state, not a regression in product availability.

## 4. Integration direction

The emerging contract must provide: current billing-authorized actor; accepted commercial/subscription revision; provider/manual payment evidence with truthful certainty; one effective entitlement projection; operation-level enforcement; AI effect/attempt identity; billable-system classification; usage/cost reconciliation; explicit budget mode; period/currency/version-bound customer overage; and financial correction without replaying model effects.

Re-use K3/K5 authority, K10 value/currency/correction, K11 effect/consequence recovery, J13 current external-provider authority and J24 isolated verification. No new subscription engine, generic ledger or AI gateway is selected in M001.

## 5. Status and next action

No canonical IDs allocated. Current range remains through F228/C178/KF-REC-057/KF-CONCEPT-042; next free F229/C179/KF-REC-058.

J20 has ten local designed cases, zero runner bindings, NOT_EXECUTED. Earlier J9/J8/J13 proof inventories remain separate and unchanged. Creating this dossier raises dedicated journey coverage from 22/25 to **23/25**; J21/J22 remain dossierless. Coverage is not application completion.

Next: **J20_SUBSCRIPTION_PAYMENT_ENTITLEMENT_AND_USAGE_LINEAGE_TRACE**, producing `investigations/J20-PLAN-SUBSCRIPTION-AI-COST-MICROTRACE-002.md`. Trace declared schema identity, gateway callback/renewal/cancellation writers, wrapper bypasses and actual entitlement call sites; then perform bounded canonical comparison before any new ID allocation or target convergence decision.
