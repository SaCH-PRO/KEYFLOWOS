# KeyFlowOS Contradiction Register — Plan / Subscription / AI Metering Supplement

Status: CANONICAL CONTINUATION AFTER C178  
Implementation evidence baseline: `main@8f173bfe79f1418159cf4099ea18b0d60d203ec2`.

## C179 — customer allowance excludes nonbillable system AI while current customer overage includes it

```text
checkCredits:
  billable = true

getUsageSummary / billing dashboard:
  all AiUsageLog rows
  -> overage
```

One commercial concept therefore uses two incompatible populations.

Related finding: F229.

## C180 — subscription period identity exists while AI metering and provider-budget windows silently use calendar month

```text
Subscription.currentPeriodStart/currentPeriodEnd
!=
first-day-of-month usage/budget reset
```

without an explicit policy mapping.

Related finding: F230.

## C181 — ModelGateway records provider cost outside AiUsageLog while budget admission reads AiUsageLog and direct gateway callers can bypass AiUsageService

```text
gateway effect
→ LLMProviderCost

budget spend
→ AiUsageLog.estimatedCost

some gateway callers
→ no AiUsageService admission / no automatic AiUsageLog
```

The gateway's provider-budget control can therefore reason over a narrower population than the gateway's own provider effects.

Related finding: F231.

No production implementation or runtime proof is authorized by this supplement.
