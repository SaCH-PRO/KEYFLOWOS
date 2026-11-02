#!/usr/bin/env bash
# One-command, non-mutating launch verifier (V1-20-SEC-VERIFY-UP, port of #188).
#
# Hits /healthz and /readyz on the API plus /api/healthz and / on the web app,
# prints a pass/fail table and exits non-zero if any check fails.
#
# HTTP 200 alone is not a readiness proof: the web /api/healthz answers 200
# with status "degraded" when the API is unreachable. Every JSON probe body is
# checked by scripts/verify-up-body.mjs (api.healthz status ok; api.readyz
# status ready and db.ok true; web.healthz status ok, apiReachable true and
# env ok). A malformed body, an unexpected status or a curl transport failure
# fails closed with a named reason; response bodies are never printed.
# A probe passes only on the module's positive `valid_health_body` verdict:
# its exit status alone is not a pass. Only reason tokens from a fixed
# allow-list reach the table; any other verifier output is reported as
# health_verifier_failed.
#
# Usage:
#   bash scripts/verify-up.sh                                 # local dev defaults
#   API_BASE=https://api.example.com WEB_BASE=https://app.example.com bash scripts/verify-up.sh
#   BASE_URL=https://app.example.com bash scripts/verify-up.sh  # web + api on one origin
#
# With BASE_URL the web app and API share one origin, so only the web app's
# /api/healthz (which itself probes the API's /readyz) and / are checked.
#
# Specs: pnpm test:verify-up (scripts/tests/verify-up-*.spec.mjs).
set -uo pipefail

# Physical path (-P): a symlinked checkout must not change which file runs.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
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

# Maps the body verifier's stderr to a fixed reason token. Anything outside
# the allow-list (a crash, a stack trace, body text) becomes
# health_verifier_failed, so no response text can reach the table.
verifier_reason() {
  local raw
  raw="$(head -n 1 "$ERR_FILE" 2>/dev/null)"
  case "$raw" in
    unknown_probe|invalid_json|not_an_object|health_body_unhealthy|body_unreadable|health_verifier_usage_error)
      printf '%s' "$raw" ;;
    *)
      printf '%s' 'health_verifier_failed' ;;
  esac
}

probe() {
  local label="$1"
  local url="$2"
  local expected_status="${3:-200}"
  local started_ms ended_ms latency_ms body_status transport_ok=1 error_reason="" verdict verifier_exit
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
      verifier_exit=0
      verdict=$(node "$SCRIPT_DIR/verify-up-body.mjs" "$label" "$BODY_FILE" 2>"$ERR_FILE") || verifier_exit=$?
      if [ "$verifier_exit" -ne 0 ]; then
        error_reason="$(verifier_reason)"
      elif [ "$verdict" != 'valid_health_body' ]; then
        # Exit 0 without the verdict means the body was never checked.
        error_reason='health_verifier_no_verdict'
      fi
      if [ -n "$error_reason" ]; then
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
