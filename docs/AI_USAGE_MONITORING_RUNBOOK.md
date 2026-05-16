# AI Usage Monitoring Runbook

## Overview

This runbook covers the operational monitoring, alerting, and incident response procedures for the AI usage tracking system in KeyFlowOS.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        AI Services                           │
│  (18 services via trackAndComplete/trackAndStream/...)      │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                    AiUsageService                            │
│  • Rate limiting    • Credit checks    • Usage logging       │
│  • Alert thresholds (50%, 80%, 100%)                         │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│              AiUsageAlertSchedulerService                    │
│  Polls every 5m → dispatches in-app + email notifications    │
└─────────────────────────────────────────────────────────────┘
```

## Endpoints

### Public Health Probes
| Endpoint | Auth | Purpose |
|----------|------|---------|
| `GET /healthz` | None | Process liveness |
| `GET /readyz` | None | DB readiness |

### AI Usage Admin Endpoints (SUPER_ADMIN only)
| Endpoint | Description |
|----------|-------------|
| `GET /api/admin/ai-usage/businesses/:businessId/summary` | Business usage summary |
| `GET /api/admin/ai-usage/businesses/:businessId/history` | Paginated usage logs |
| `GET /api/admin/ai-usage/businesses/:businessId/alerts` | Business alert history |
| `GET /api/admin/ai-usage/platform-summary` | Platform-wide aggregates |
| `GET /api/admin/ai-usage/platform-alerts` | Unnotified alerts across platform |
| `GET /api/admin/ai-usage/health` | AI system health (today's stats + error rate) |

### Business-Facing Endpoints
| Endpoint | Description |
|----------|-------------|
| `GET /ai/businesses/:businessId/ai/provider-stats` | Provider breakdown |
| `GET /ai/businesses/:businessId/ai/provider-health` | Provider health metrics |

## Frontend Dashboard

Navigate to `/admin/ai-usage` (Owner Console → AI Usage).

Shows:
- Platform-wide totals (calls, credits, cost, tokens)
- Unnotified alert banner
- Top features by credits (bar chart)
- Provider distribution (pie chart)
- Top 20 businesses by usage (searchable table)
- Recent alerts table with status badges

## Alert Thresholds

| Threshold | Type | Action |
|-----------|------|--------|
| 50% | `budget_threshold` | In-app notification + email |
| 80% | `budget_threshold` | In-app notification + email |
| 100% | `credit_depleted` | In-app notification + email; AI features blocked |

Unlimited plans (`aiCreditsPerMonth = -1`) do not trigger alerts.

## Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `AI_USAGE_ALERT_SCHEDULER_DISABLED` | `0` | Set to `1` to disable the alert dispatcher |
| `RESEND_API_KEY` | — | Required for system email alerts |
| `EMAIL_FROM_ADDRESS` | — | From address for system emails |

## Common Procedures

### 1. Investigate High AI Costs

1. Open `/admin/ai-usage`
2. Check "Top Features by Credits" chart for unexpected spikes
3. Check "Top Businesses" table for outliers
4. Drill down: `GET /api/admin/ai-usage/businesses/:id/history`
5. Look for specific features or models driving cost

### 2. AI Features Not Responding

1. Check `GET /healthz` and `GET /readyz`
2. Check `GET /api/admin/ai-usage/health` — look at `today.errors` and `errorRate`
3. Check server logs for `ModelGatewayService` errors
4. Verify OpenAI API key / quota status
5. Check provider health: `GET /ai/businesses/:id/ai/provider-health`

### 3. Credits Depleted for a Business

1. Business receives in-app notification + email at 100%
2. AI features return `403 Forbidden` with credit limit message
3. Options:
   - Wait for plan reset (monthly)
   - Business upgrades plan via billing
   - Manual override: adjust `aiCreditsPerMonth` in plan config (not recommended)

### 4. Alert Scheduler Not Dispatching

1. Check env: `AI_USAGE_ALERT_SCHEDULER_DISABLED` should not be `1`
2. Check server logs for `AiUsageAlertSchedulerService`
3. Verify `NotificationsService` and `SystemEmailService` are available in app context
4. Query DB: `SELECT COUNT(*) FROM ai_usage_alerts WHERE notified = false;`
5. Manual dispatch: trigger scheduler `tick()` via debugging or restart server

### 5. Add New AI Feature Cost

1. Add entry to `AI_CREDIT_COSTS` in `apps/server/src/modules/subscriptions/plans.ts`
2. Use `trackAndComplete()` / `trackAndStream()` / `trackEmbedding()` / `trackVision()` / `trackAudio()` in service
3. Ensure feature key matches `AI_CREDIT_COSTS` key

## Metrics to Watch

| Metric | Healthy | Warning | Critical |
|--------|---------|---------|----------|
| Daily error rate | < 1% | 1–10% | > 10% |
| Unnotified alerts | 0 | 1–10 | > 50 |
| Avg latency | < 500ms | 500ms–2s | > 2s |
| Fallback rate | < 5% | 5–20% | > 20% |

## Database Queries

### Monthly usage by business
```sql
SELECT business_id,
       SUM(credits_used) AS credits,
       SUM(estimated_cost) AS cost,
       COUNT(*) AS calls
FROM ai_usage_logs
WHERE created_at >= date_trunc('month', now())
GROUP BY business_id
ORDER BY credits DESC
LIMIT 20;
```

### Unnotified alerts
```sql
SELECT * FROM ai_usage_alerts
WHERE notified = false
ORDER BY triggered_at DESC;
```

### Feature breakdown
```sql
SELECT feature,
       SUM(credits_used) AS credits,
       COUNT(*) AS calls
FROM ai_usage_logs
WHERE created_at >= date_trunc('month', now())
GROUP BY feature
ORDER BY credits DESC;
```

### Daily error trend
```sql
SELECT date(created_at) AS day,
       COUNT(*) FILTER (WHERE error_code IS NOT NULL) AS errors,
       COUNT(*) AS total
FROM ai_usage_logs
WHERE created_at >= now() - interval '7 days'
GROUP BY day
ORDER BY day;
```

## Incident Response: AI Billing Spike

1. **Detect**: Monitor `/api/admin/ai-usage/platform-summary` for unexpected cost increases
2. **Identify**: Drill down to business + feature causing the spike
3. **Contain**: If abuse suspected, temporarily block business AI access (update plan or feature flag)
4. **Resolve**: Fix root cause (buggy loop, misconfigured automation, etc.)
5. **Document**: Add incident notes to runbook

## Related Files

| File | Purpose |
|------|---------|
| `apps/server/src/modules/ai/ai-usage.service.ts` | Core tracking + wrappers |
| `apps/server/src/modules/ai/ai-usage-admin.controller.ts` | Admin REST API |
| `apps/server/src/modules/ai/ai-usage-alert-scheduler.service.ts` | Alert dispatcher |
| `apps/server/src/modules/subscriptions/plans.ts` | Credit costs + plan limits |
| `apps/web/src/app/admin/ai-usage/page.tsx` | Frontend dashboard |
| `packages/db/prisma/schema.prisma` | `AiUsageLog` + `AiUsageAlert` schema |
