# KeyFlowOS Finding Register — Plan / Subscription / AI Metering Supplement

Status: CANONICAL CONTINUATION AFTER F228  
Implementation evidence baseline: `main@8f173bfe79f1418159cf4099ea18b0d60d203ec2`  
Production implementation: READ-ONLY / NOT AUTHORIZED.

## F229 — customer AI allowance and customer overage use different frozen billable populations

`AiUsageService.checkCredits()` aggregates current-month AiUsageLog with `billable=true`.

`AiUsageService.getUsageSummary()` and `SubscriptionsService.getBillingDashboard()` aggregate all current-month AiUsageLog rows before computing credits used / credits remaining / overage.

The schema deliberately stores `billable` at occurrence time so later classification changes cannot rewrite historical customer billing.

Therefore:

```text
ALLOWANCE POPULATION = BILLABLE USAGE
while
OVERAGE POPULATION = BILLABLE + SYSTEM/NONBILLABLE USAGE
```

System work can be excluded from admission but still increase displayed customer overage.

This is distinct from K10 gross/net financial projection findings: the mismatch exists before invoicing/settlement, in the customer usage basis itself.

Affected: J20, K8, K10, K5. Related contradiction: C179.

## F230 — AI allowance/overage/budget windows use calendar months rather than the declared subscription period identity

`Subscription` carries `currentPeriodStart/currentPeriodEnd`.

AI credit admission, usage summary, billing dashboard and ModelGateway current-month spend all start at the first day of the calendar month.

A mid-month subscription can therefore have one paid period while its AI allowance/overage/budget resets on another boundary.

```text
ENTITLEMENT PERIOD
!=
CALENDAR-MONTH METERING WINDOW
```

unless explicitly made equivalent by product policy.

Affected: J20, K7, K8, K10. Related contradiction: C180.

## F231 — direct gateway/modality callers can bypass AiUsageService admission and the budget population is not the provider-cost ledger

Multiple named services call `ModelGatewayService.complete()/streamComplete()` directly rather than through AiUsageService.

ModelGateway records provider cost into `LLMProviderCost` via LLMCostService, but its budget-spend calculation aggregates `AiUsageLog.estimatedCost`.

A direct gateway effect can therefore have provider-cost evidence while being absent from the AiUsageLog population used for customer credit admission and gateway budget accounting.

Voice adds a concrete specialization: one OpenAI voice provider uses pre-effect `trackAudio()`, while KeyCortexVoice performs TTS directly and only calls `trackAudioUsage()` after the effect; realtime WebSocket metering remains J22 pressure.

Canonical law:

```text
MODEL EFFECT
→ must have declared admission semantics
→ must have stable usage/cost correlation
```

and:

```text
PROVIDER COST LEDGER
!= CUSTOMER USAGE LEDGER
but budget admission cannot silently omit valid provider effects
```

Affected: J20, J22, K5, K8, K10, K11. Related contradiction: C181.

No runtime incident is claimed by these static findings.
