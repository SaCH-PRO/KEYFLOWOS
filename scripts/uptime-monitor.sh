#!/usr/bin/env bash
# Self-hosted uptime monitor.
#
# Pings the public health endpoints, validates the JSON body, and pages
# the operator on TWO consecutive failures (so a single transient blip
# does not wake anybody up). Pages again on recovery.
#
# Endpoints probed:
#   GET <BASE_URL>/api/healthz   -> 200, body must contain `"apiReachable":true`
#   GET <BASE_URL>/readyz        -> 200, body must contain `"ok":true`  (under db)
#
# A small JSON state file tracks consecutive-failure counters between
# runs so we can implement "fail twice in a row" semantics from any
# scheduler (cron, GitHub Actions, Replit Scheduled Deployment, etc.).
#
# Usage:
#   BASE_URL=https://app.example.com scripts/uptime-monitor.sh
#
# Optional env:
#   API_BASE                  Override URL for /readyz (defaults to BASE_URL).
#                             Useful when the API is on a different host.
#   STATE_FILE                Where to persist failure counters.
#                             Defaults to /tmp/keyflow-uptime-state.json.
#   SLACK_WEBHOOK_URL         If set, alerts post to this Slack incoming-webhook.
#   ALERT_WEBHOOK_URL         If set, alerts POST a generic JSON payload here.
#                             (Use this for PagerDuty Events v2, Opsgenie, etc.)
#   ALERT_EMAIL               If set AND `mail` is on PATH, alerts also email.
#   FAIL_THRESHOLD            Consecutive failures before paging. Default: 2.
#   PROBE_TIMEOUT_SEC         Per-request timeout. Default: 10.
#   MONITOR_LABEL             Free-form label included in alerts. Default: keyflowos.
#   QUIET                     If "1", only print on state changes / failures.
#
# Exit codes:
#   0  all checks passed (or failed below threshold — no page)
#   1  at least one check is failing AND the failure threshold was crossed
#   2  invalid invocation (missing BASE_URL)

set -uo pipefail

if [ -z "${BASE_URL:-}" ]; then
  echo "[uptime-monitor] ERROR: BASE_URL is required" >&2
  echo "  example: BASE_URL=https://app.example.com $0" >&2
  exit 2
fi

API_BASE="${API_BASE:-$BASE_URL}"
STATE_FILE="${STATE_FILE:-/tmp/keyflow-uptime-state.json}"
FAIL_THRESHOLD="${FAIL_THRESHOLD:-2}"
PROBE_TIMEOUT_SEC="${PROBE_TIMEOUT_SEC:-10}"
MONITOR_LABEL="${MONITOR_LABEL:-keyflowos}"
QUIET="${QUIET:-0}"

WEB_HEALTHZ_URL="${BASE_URL%/}/api/healthz"
API_READYZ_URL="${API_BASE%/}/readyz"

# ---- tiny JSON helpers (no jq dependency) ----------------------------------

# Look for a literal "key":<value> pair in a JSON blob. Tolerates minor
# whitespace. Not a real parser, but the health bodies are small and
# stable so this is good enough — and keeps the script dependency-free.
json_field_equals() {
  local body="$1" key="$2" value="$3"
  printf '%s' "$body" | grep -Eq "\"${key}\"[[:space:]]*:[[:space:]]*${value}([,}[:space:]]|$)"
}

read_state() {
  if [ -f "$STATE_FILE" ]; then
    cat "$STATE_FILE"
  else
    printf '{}'
  fi
}

# Read a numeric counter for a check from the state JSON. Returns 0 when
# missing. Same minimal-parser caveat as above.
get_counter() {
  local state="$1" check="$2"
  local n
  n=$(printf '%s' "$state" | grep -oE "\"${check}\"[[:space:]]*:[[:space:]]*[0-9]+" | grep -oE '[0-9]+$' | tail -n1)
  printf '%s' "${n:-0}"
}

write_state() {
  local web="$1" api="$2"
  local tmp
  tmp=$(mktemp)
  printf '{"web_healthz":%d,"api_readyz":%d,"updatedAt":"%s"}\n' \
    "$web" "$api" "$(date -u +%FT%TZ)" > "$tmp"
  mv "$tmp" "$STATE_FILE"
}

# ---- probes ---------------------------------------------------------------

probe() {
  # $1 = label, $2 = url, $3 = JSON key to assert, $4 = expected literal value
  # echoes "OK <status> <ms>" or "FAIL <status> <ms> <reason>"
  local label="$1" url="$2" key="$3" want="$4"

  local started_ms
  started_ms=$(date +%s%3N 2>/dev/null || python3 -c 'import time; print(int(time.time()*1000))')

  local body status
  body=$(curl -sS -m "$PROBE_TIMEOUT_SEC" -o /tmp/.uptime-body-$$ -w '%{http_code}' "$url" 2>/dev/null) || status="000"
  status="${body:-000}"
  body=$(cat /tmp/.uptime-body-$$ 2>/dev/null || true)
  rm -f /tmp/.uptime-body-$$

  local ended_ms
  ended_ms=$(date +%s%3N 2>/dev/null || python3 -c 'import time; print(int(time.time()*1000))')
  local ms=$(( ended_ms - started_ms ))

  if [ "$status" != "200" ]; then
    printf 'FAIL %s %s http_status=%s' "$status" "$ms" "$status"
    return 1
  fi
  if ! json_field_equals "$body" "$key" "$want"; then
    local snippet
    snippet=$(printf '%s' "$body" | tr -d '\n' | head -c 160)
    printf 'FAIL %s %s body_assert_failed("%s":%s) body=%s' "$status" "$ms" "$key" "$want" "$snippet"
    return 1
  fi
  printf 'OK %s %s' "$status" "$ms"
  return 0
}

# ---- alerting -------------------------------------------------------------

post_slack() {
  local text="$1"
  [ -z "${SLACK_WEBHOOK_URL:-}" ] && return 0
  curl -sS -m 10 -X POST -H 'Content-Type: application/json' \
    --data "$(printf '{"text":%s}' "$(json_string "$text")")" \
    "$SLACK_WEBHOOK_URL" >/dev/null || true
}

post_generic_webhook() {
  local kind="$1" check="$2" detail="$3" text="$4"
  [ -z "${ALERT_WEBHOOK_URL:-}" ] && return 0
  local payload
  payload=$(printf '{"monitor":%s,"event":%s,"check":%s,"detail":%s,"summary":%s,"timestamp":%s}' \
    "$(json_string "$MONITOR_LABEL")" \
    "$(json_string "$kind")" \
    "$(json_string "$check")" \
    "$(json_string "$detail")" \
    "$(json_string "$text")" \
    "$(json_string "$(date -u +%FT%TZ)")")
  curl -sS -m 10 -X POST -H 'Content-Type: application/json' \
    --data "$payload" "$ALERT_WEBHOOK_URL" >/dev/null || true
}

post_email() {
  local subject="$1" body="$2"
  [ -z "${ALERT_EMAIL:-}" ] && return 0
  command -v mail >/dev/null 2>&1 || return 0
  printf '%s\n' "$body" | mail -s "$subject" "$ALERT_EMAIL" || true
}

json_string() {
  # Escape a string for safe embedding in a JSON value. Handles quotes,
  # backslashes, and control characters.
  python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))' <<<"$1"
}

emit_alert() {
  local kind="$1" check="$2" detail="$3"
  local text
  text="[${MONITOR_LABEL}] ${kind} :: ${check} :: ${detail}"
  echo "$text"
  post_slack "$text"
  post_generic_webhook "$kind" "$check" "$detail" "$text"
  post_email "[${MONITOR_LABEL}] ${kind} ${check}" "$text"
}

# ---- main -----------------------------------------------------------------

[ "$QUIET" = "1" ] || {
  echo "[uptime-monitor] $(date -u +%FT%TZ)"
  echo "  web.healthz : $WEB_HEALTHZ_URL"
  echo "  api.readyz  : $API_READYZ_URL"
  echo "  state file  : $STATE_FILE  (threshold=$FAIL_THRESHOLD)"
}

state=$(read_state)
prev_web=$(get_counter "$state" "web_healthz")
prev_api=$(get_counter "$state" "api_readyz")

web_result=$(probe "web.healthz" "$WEB_HEALTHZ_URL" "apiReachable" "true")
web_ok=$?
api_result=$(probe "api.readyz"  "$API_READYZ_URL"  "ok"           "true")
api_ok=$?

if [ "$web_ok" -eq 0 ]; then
  new_web=0
else
  new_web=$(( prev_web + 1 ))
fi
if [ "$api_ok" -eq 0 ]; then
  new_api=0
else
  new_api=$(( prev_api + 1 ))
fi

write_state "$new_web" "$new_api"

paged=0

# web.healthz transitions
if [ "$new_web" -ge "$FAIL_THRESHOLD" ] && [ "$prev_web" -lt "$FAIL_THRESHOLD" ]; then
  emit_alert "DOWN" "web.healthz" "$web_result (consecutive=$new_web)"
  paged=1
elif [ "$new_web" -eq 0 ] && [ "$prev_web" -ge "$FAIL_THRESHOLD" ]; then
  emit_alert "RECOVERED" "web.healthz" "$web_result"
fi

# api.readyz transitions
if [ "$new_api" -ge "$FAIL_THRESHOLD" ] && [ "$prev_api" -lt "$FAIL_THRESHOLD" ]; then
  emit_alert "DOWN" "api.readyz" "$api_result (consecutive=$new_api)"
  paged=1
elif [ "$new_api" -eq 0 ] && [ "$prev_api" -ge "$FAIL_THRESHOLD" ]; then
  emit_alert "RECOVERED" "api.readyz" "$api_result"
fi

[ "$QUIET" = "1" ] && [ "$web_ok" -eq 0 ] && [ "$api_ok" -eq 0 ] || {
  printf '  web.healthz : %s  (consecutive_failures=%d)\n' "$web_result" "$new_web"
  printf '  api.readyz  : %s  (consecutive_failures=%d)\n' "$api_result" "$new_api"
}

if [ "$new_web" -ge "$FAIL_THRESHOLD" ] || [ "$new_api" -ge "$FAIL_THRESHOLD" ]; then
  exit 1
fi
exit 0
