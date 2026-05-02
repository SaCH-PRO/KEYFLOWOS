#!/usr/bin/env bash
# One-command launch verifier.
#
# Hits /healthz, /readyz on the API plus /api/healthz and / on the web app
# and prints a clean pass/fail table. Exits non-zero if any check fails.
#
# Usage:
#   scripts/verify-up.sh                                # local dev defaults
#   API_BASE=https://api.example.com WEB_BASE=https://app.example.com scripts/verify-up.sh
#   BASE_URL=https://app.example.com scripts/verify-up.sh   # web + api on same host
#
# When BASE_URL is set, the web app and API are assumed to share the same
# origin and we only probe the web app's /api/healthz (which itself probes
# the API's /readyz internally).

set -uo pipefail

# Defaults (dev)
API_BASE="${API_BASE:-${BASE_URL:-http://localhost:3001}}"
WEB_BASE="${WEB_BASE:-${BASE_URL:-http://localhost:5000}}"

# When BASE_URL is set we assume the web app proxies the API, so don't try
# to hit the bare API host directly.
SAME_HOST=false
if [ -n "${BASE_URL:-}" ]; then
  SAME_HOST=true
fi

PASS=0
FAIL=0
RESULTS=()

probe() {
  local label="$1"
  local url="$2"
  local expected_status="${3:-200}"

  local started_ms
  started_ms=$(date +%s%3N 2>/dev/null || python3 -c 'import time; print(int(time.time()*1000))')

  local body_status
  body_status=$(curl -sS -o /tmp/.verify-up-body -w '%{http_code}' --max-time 10 "$url" 2>/tmp/.verify-up-err || echo "000")

  local ended_ms
  ended_ms=$(date +%s%3N 2>/dev/null || python3 -c 'import time; print(int(time.time()*1000))')
  local latency_ms=$(( ended_ms - started_ms ))

  if [ "$body_status" = "$expected_status" ]; then
    RESULTS+=("PASS  ${label}  ${body_status}  ${latency_ms}ms  ${url}")
    PASS=$((PASS + 1))
    return 0
  else
    local err
    err=$(head -c 200 /tmp/.verify-up-body 2>/dev/null | tr -d '\n' | head -c 120)
    if [ -z "$err" ]; then
      err=$(head -c 120 /tmp/.verify-up-err 2>/dev/null | tr -d '\n')
    fi
    RESULTS+=("FAIL  ${label}  ${body_status}  ${latency_ms}ms  ${url}  ::  ${err}")
    FAIL=$((FAIL + 1))
    return 1
  fi
}

echo "=== verify:up ==="
echo "API_BASE: ${API_BASE}"
echo "WEB_BASE: ${WEB_BASE}"
echo

if [ "$SAME_HOST" = "false" ]; then
  probe "api.healthz" "${API_BASE%/}/healthz" 200
  probe "api.readyz"  "${API_BASE%/}/readyz"  200
fi

probe "web.healthz" "${WEB_BASE%/}/api/healthz" 200
probe "web.root"    "${WEB_BASE%/}/"           200

echo
printf '%-50s %s\n' "CHECK" "RESULT"
printf '%-50s %s\n' "-----" "------"
for line in "${RESULTS[@]}"; do
  printf '%s\n' "$line"
done

echo
echo "Passed: ${PASS}    Failed: ${FAIL}"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
exit 0
