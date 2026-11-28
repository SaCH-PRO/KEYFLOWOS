# Availability Service Level Objectives (SLOs)

**Status:** Proposed baseline (`99.5%`) — the target number belongs to the owner; once confirmed or updated by owner ruling, record the final value here and in `SLO_TARGET_PCT` if different from `99.5`.

## Probed Endpoints

Production availability is measured by `.github/workflows/uptime-monitor.yml` running `scripts/uptime-monitor.sh` every 5 minutes against the two public health probes:

| Check | Endpoint | Good probe definition | Window | Availability objective | Monthly error budget |
|---|---|---|---|---|---|
| `web.healthz` | `GET /api/healthz` | HTTP `200` with `"apiReachable":true` | Rolling 30 days (UTC) | `99.5%` (proposed; owner's value) | `0.5%` (~3h 36m / 30 days) |
| `api.readyz` | `GET /readyz` | HTTP `200` with `"ok":true` | Rolling 30 days (UTC) | `99.5%` (proposed; owner's value) | `0.5%` (~3h 36m / 30 days) |

## Computation & Error Budget

For each probed endpoint, `scripts/uptime-monitor.sh` maintains a bounded per-UTC-day `{ "good": N, "total": M }` tally for the last 30 UTC calendar days (`today - 29 days` through `today`) inside its existing JSON state file (`STATE_FILE`). Older days are pruned on every run so the state file stays strictly bounded.

Over the rolling 30-day window (`G = sum(good)`, `T = sum(total)`, `F = T - G`):

- **30-day availability:** `availability_30d = (G / T) * 100%`
- **Allowed error fraction:** `allowed_error = 1 - (SLO_TARGET_PCT / 100)` (`0.005` at `99.5%`)
- **Observed error fraction:** `observed_error = F / T`
- **Remaining error budget:** `error_budget_remaining = max(0, (allowed_error - observed_error) / allowed_error) * 100%`

## Alerting Policy

- Each run prints `availability_30d` and `error_budget_remaining` for both `web.healthz` and `api.readyz`.
- When an endpoint's rolling 30-day error budget transitions from healthy (`budget_exhausted: false`) to exhausted (`availability < SLO_TARGET_PCT` with at least `SLO_MIN_SAMPLES` probes, default `2`), `scripts/uptime-monitor.sh` emits **one** `SLO_BUDGET_EXHAUSTED` alert through the existing configured notification channels (`SLACK_WEBHOOK_URL`, `ALERT_WEBHOOK_URL`, `ALERT_EMAIL`).
- Subsequent runs while the budget remains exhausted do not re-page; a fresh alert fires only if the budget recovers and later exhausts again.
- Consecutive-failure `DOWN` / `RECOVERED` paging (`FAIL_THRESHOLD`, default `2`) and exit codes (`0` / `1` / `2`) remain unchanged.

## Explicit Non-Goals (Out of Scope)

- Latency and error-rate SLOs (require APM / OTLP telemetry).
- Automatic release freezes, deploy blocks, or KEY autonomy changes based on error-budget state (changing human authority over releases or KEY requires an explicit owner ruling).
