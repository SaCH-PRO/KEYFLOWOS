# KeyFlowOS Current State

Checkpoint: `J20-M001-2026-09-17-01`  
Updated: 2026-09-17  
Status: **CANONICAL HUMAN-READABLE CURRENT PROGRAMME STATE**.

## Position

Completed: J20 activation and [J20 Microtrace 001](investigations/J20-PLAN-SUBSCRIPTION-AI-COST-MICROTRACE-001.md). The new [J20 dossier](journeys/KF-JOURNEY-020-PLAN-SUBSCRIPTION-AI-COST.md) records scope, source facts and continuation.

Now: **J20_SUBSCRIPTION_PAYMENT_ENTITLEMENT_AND_USAGE_LINEAGE_TRACE**. Planned M002 is not created at this checkpoint. J20 remains ACTIVE / NOT CONVERGED.

The programme map remains deliberately frozen at J24-PA. Scheduled owner-halted cycles remain halted. Production source/schema/settings/workflows/assertions stay read-only; no model/provider/subscription/database/runtime test or mutation ran.

## Material J20 findings

1. Subscription state is not payment proof. `activateSubscription` cancels current rows then creates a caller-specified ACTIVE row; `createCheckout` only prepares a local descriptor; `recordManualPayment` activates before the COMPLETED payment row is created. A later payment-row failure can therefore leave an active entitlement without the matching local payment record.

2. The inspected mutation routes are protected by AuthGuard + BusinessGuard but do not add a distinct owner/billing-authority decision. This is a scoped authorization finding, not an unauthenticated-route claim.

3. Plan definitions and actual enforcement differ. The existing source-level enforcement test documents acknowledged unenforced limits at the forensic baseline; it was read, not executed here. AI credits are one centrally enforced positive seam for tracked calls.

4. AI allowance and overage use different populations. `checkCredits` sums only `billable: true`; `getUsageSummary` and the subscription billing dashboard sum all usage before overage math. System/background AI can therefore be excluded from admission while still appearing as customer overage. Static example: limit50, billable40, system30 => admission sees40 while billing summary sees70 and reports20 overage.

5. Successful AI effects can outrun AiUsageLog. Tracked calls return after starting fire-and-forget persistence; after three failed write attempts the call can remain successful with no durable usage row. That can undercount later allowance/overage. The gateway's separate LLM-cost/trace evidence is useful but not automatically reconciled to customer billing.

6. Provider budget caps are soft routing constraints. When every candidate is over budget, the gateway resumes the original candidates and proceeds in degraded mode. No concurrent reservation is established by the inspected recorded-spend check. A hard customer spend cap therefore requires a different contract from advisory routing budgets.

7. Feature credits, model tokens/provider cost, customer overage price/currency and settled financial charge are different units/stages and must retain separate evidence/versioning.

## Status, proof and next action

No new F/C/REC/concept allocation. F228/C178 retains its J8 meaning; next free F229/C179/KF-REC-058.

J20 has 10 local designed cases, zero bindings, NOT_EXECUTED. J9(26), J8(24), J13(44) remain separate. Dedicated journey coverage is now 23/25; J21/J22 remain dossierless. This is presence/coverage, not completion.

Next M002: inspect exact Subscription/SubscriptionPayment/AiUsageLog/LLMCost schema identities and provider subscription callbacks/renewal/cancellation writers; enumerate AI callers bypassing or reusing AiUsageService and actual boolean/numeric entitlement call sites; then run bounded canonical comparison and refine one entitlement/usage/reconciliation target. Preserve all prior contracts/debts, fixed baseline, map pause and owner halt.
