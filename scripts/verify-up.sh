#!/usr/bin/env bash
# Non-mutating launch verifier. HTTP 200 alone is not a readiness proof.
# Usage: API_BASE=https://api.example.com WEB_BASE=https://app.example.com bash scripts/verify-up.sh
# Or: BASE_URL=https://app.example.com bash scripts/verify-up.sh
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_BASE="${API_BASE:-${BASE_URL:-http://localhost:3001}}"
WEB_BASE="${WEB_BASE:-${BASE_URL:-http://localhost:5000}}"
SAME_HOST=false
if [ -n "${BASE_URL:-}" ]; then SAME_HOST=true; fi

PASS=0
FAIL=0
RESULTS=()
BODY_FILE="$(mktemp)" || exit 2
ERR_FILE="$(mktemp)" || { rm -f "$BODY_FILE"; exit 2; }
trap 'rm -f "$BODY_FILE" "$ERR_FILE"' EXIT

probe() {
  local label="$1"
  local url="$2"
  local expected_status="${3:-200}"
  local started_ms ended_ms latency_ms body_status transport_ok=1 error_reason=""
  started_ms=$(date +%s%3N 2>/dev/null || node -e 'process.stdout.write(String(Date.now()))')
  if ! body_status=$(curl -sS -o "$BODY_FILE" -w '%{http_code}' --max-time 10 "$url" 2>"$ERR_FILE"); then
    transport_ok=0
  fi
  ended_ms=$(date +%s%3N 2>/dev/null || node -e 'process.stdout.write(String(Date.now()))')
  latency_ms=$(( ended_ms - started_ms ))

  if [ "$transport_ok" -eq 1 ] && [ "$body_status" = "$expected_status" ]; then
    if [ "$label" != 'web.root' ]; then
      # The existing API/web contracts return JSON. Reject HTTP 200 when the
      # response is missing, degraded, malformed or contains a failed DB check.
      if ! error_reason=$(node "$SCRIPT_DIR/verify-up-body.mjs" "$label" "$BODY_FILE" 2>&1); then
        RESULTS+=("FAIL  ${label}  ${body_status}  ${latency_ms}ms  ${url}  ::  ${error_reason}")
        FAIL=$((FAIL + 1))
        return 1
      fi
    fi
    RESULTS+=("PASS  ${label}  ${body_status}  ${latency_ms}ms  ${url}")
    PASS=$((PASS + 1))
    return 0
  fi

  if [ "$transport_ok" -eq 0 ]; then
    error_reason="curl_transport_failure"
  else
    error_reason="unexpected_http_status"
  fi
  RESULTS+=("FAIL  ${label}  ${body_status:-000}  ${latency_ms}ms  ${url}  ::  ${error_reason}")
  FAIL=$((FAIL + 1))
  return 1
}

echo '=== verify:up ==='
echo "API_BASE: ${API_BASE}"
echo "WEB_BASE: ${WEB_BASE}"
echo
if [ "$SAME_HOST" = false ]; then
  probe 'api.healthz' "${API_BASE%/}/healthz" 200
  probe 'api.readyz' "${API_BASE%/}/readyz" 200
fi
probe 'web.healthz' "${WEB_BASE%/}/api/healthz" 200
probe 'web.root' "${WEB_BASE%/}/" 200

echo
printf '%-50s %s\n' 'CHECK' 'RESULT'
printf '%-50s %s\n' '-----' '------'
for line in "${RESULTS[@]}"; do printf '%s\n' "$line"; done
echo
echo "Passed: ${PASS}    Failed: ${FAIL}"
if [ "$FAIL" -gt 0 ]; then exit 1; fi
exit 0
