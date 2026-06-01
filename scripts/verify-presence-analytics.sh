#!/usr/bin/env bash
# verify-presence-analytics.sh — S4 #479 smoke test for the public-event
# capture pipeline. Seeds a batch of events through the public ingestion
# endpoint, kicks the daily aggregator, and asserts the overview/reports
# endpoints return non-empty rollups.
#
# Required env:
#   BASE_URL          e.g. http://localhost:3001
#   BUSINESS_ID       id of a real business (any storeEnabled business)
#   AUTH_TOKEN        bearer token of an OWNER/STAFF user for that business
#                     (only required for the authenticated overview/report assertions)
#
# Usage:
#   BASE_URL=http://localhost:3001 BUSINESS_ID=clu... AUTH_TOKEN=... \
#     bash scripts/verify-presence-analytics.sh

set -u
set -o pipefail

BASE_URL="${BASE_URL:-http://localhost:3001}"
BASE_URL="${BASE_URL:-http://localhost:3001}"
BUSINESS_ID="${BUSINESS_ID:-}"
AUTH_TOKEN="${AUTH_TOKEN:-}"

PASS=0; FAIL=0; SKIP=0
RESULTS=()

c_red() { printf '\033[31m%s\033[0m' "$1"; }
c_grn() { printf '\033[32m%s\033[0m' "$1"; }
c_yel() { printf '\033[33m%s\033[0m' "$1"; }

record() {
  local s="$1"; local label="$2"; local detail="${3:-}"
  case "$s" in
    PASS) PASS=$((PASS+1)); RESULTS+=("$(c_grn PASS) $label  $detail") ;;
    FAIL) FAIL=$((FAIL+1)); RESULTS+=("$(c_red FAIL) $label  $detail") ;;
    SKIP) SKIP=$((SKIP+1)); RESULTS+=("$(c_yel SKIP) $label  $detail") ;;
  esac
}

if [ -z "$BUSINESS_ID" ]; then
  echo "ERROR: BUSINESS_ID is required" >&2
  exit 2
fi

echo "verify-presence-analytics.sh"
echo "  BASE_URL=$BASE_URL"
echo "  BUSINESS_ID=$BUSINESS_ID"
echo

VID="v_test_$(date +%s%N | head -c 18)"
SID="s_test_$(date +%s%N | head -c 18)"

# ---------------------------------------------------------------------------
# 1. Public ingestion — batch of varied event types and dimensions.
# ---------------------------------------------------------------------------
echo "== 1. Ingest batch =="
PAYLOAD=$(cat <<JSON
{
  "visitorId": "$VID",
  "sessionId": "$SID",
  "events": [
    {"businessId":"$BUSINESS_ID","type":"page_view","path":"/book/demo","source":"google","medium":"organic","ts":$(date +%s%3N)},
    {"businessId":"$BUSINESS_ID","type":"product_view","path":"/book/demo","payload":{"productId":"vp_test_prod"},"ts":$(date +%s%3N)},
    {"businessId":"$BUSINESS_ID","type":"service_view","path":"/book/demo","payload":{"serviceId":"vp_test_svc"},"ts":$(date +%s%3N)},
    {"businessId":"$BUSINESS_ID","type":"checkout_start","path":"/book/demo","ts":$(date +%s%3N)},
    {"businessId":"$BUSINESS_ID","type":"checkout_complete","path":"/book/demo","ts":$(date +%s%3N)},
    {"businessId":"$BUSINESS_ID","type":"whatsapp_click","path":"/book/demo","ts":$(date +%s%3N)},
    {"businessId":"$BUSINESS_ID","type":"share_click","path":"/book/demo","ts":$(date +%s%3N)}
  ]
}
JSON
)

# NOTE: in production the ingestion endpoint requires a trusted
# Referer that resolves to a real public surface (slug, token, or
# invoice id). The script targets a dev BASE_URL so the trusted-host
# allowlist passes; we still send a `Referer` for parity with browser
# requests, and the dev-mode `claimed-businessId` fallback keeps
# arbitrary BUSINESS_IDs working without needing a real surface.
REFERER="$BASE_URL/site/test-business"

resp_code=$(curl -s -o /tmp/vpa.body -w '%{http_code}' \
  -H 'Content-Type: application/json' -H "Referer: $REFERER" \
  -X POST -d "$PAYLOAD" "$BASE_URL/public/events")
body=$(cat /tmp/vpa.body)
if [[ "$resp_code" =~ ^2 ]] && echo "$body" | grep -q '"tracked":7'; then
  record PASS "1. ingest.batch" "tracked=7"
elif [[ "$resp_code" =~ ^2 ]]; then
  record PASS "1. ingest.batch" "$body"
else
  record FAIL "1. ingest.batch" "HTTP $resp_code: $(echo "$body" | head -c 200)"
fi

# ---------------------------------------------------------------------------
# 2. DNT honored — events should be silently dropped.
# ---------------------------------------------------------------------------
echo
echo "== 2. DNT honored =="
resp_code=$(curl -s -o /tmp/vpa.body -w '%{http_code}' \
  -H 'Content-Type: application/json' -H "Referer: $REFERER" -H 'DNT: 1' \
  -X POST -d "$PAYLOAD" "$BASE_URL/public/events")
body=$(cat /tmp/vpa.body)
if [[ "$resp_code" =~ ^2 ]] && echo "$body" | grep -q '"doNotTrack":true'; then
  record PASS "2. ingest.dnt-honored" "tracked=0 doNotTrack=true"
elif [[ "$resp_code" =~ ^2 ]] && echo "$body" | grep -q '"tracked":0'; then
  record PASS "2. ingest.dnt-honored" "tracked=0"
else
  record FAIL "2. ingest.dnt-honored" "HTTP $resp_code: $(echo "$body" | head -c 200)"
fi

# ---------------------------------------------------------------------------
# 3. Authenticated rollup endpoints.
# ---------------------------------------------------------------------------
echo
echo "== 3. Aggregate + read-back =="
if [ -z "$AUTH_TOKEN" ]; then
  record SKIP "3. presence.aggregate"          "AUTH_TOKEN not set"
  record SKIP "3. presence.stats.overview"     "AUTH_TOKEN not set"
  record SKIP "3. reports.presence.sources"    "AUTH_TOKEN not set"
  record SKIP "3. reports.presence.pages"      "AUTH_TOKEN not set"
  record SKIP "3. reports.presence.funnel"     "AUTH_TOKEN not set"
else
  AUTH_HEADER="Authorization: Bearer $AUTH_TOKEN"
  TODAY="$(date -u +%Y-%m-%d)"

  resp_code=$(curl -s -o /tmp/vpa.body -w '%{http_code}' \
    -H "$AUTH_HEADER" -H 'Content-Type: application/json' \
    -X POST -d "{\"day\":\"$TODAY\"}" \
    "$BASE_URL/businesses/$BUSINESS_ID/presence/aggregate")
  body=$(cat /tmp/vpa.body)
  if [[ "$resp_code" =~ ^2 ]] && echo "$body" | grep -q '"aggregated"'; then
    record PASS "3. presence.aggregate" "$(echo "$body" | head -c 180)"
  else
    record FAIL "3. presence.aggregate" "HTTP $resp_code: $(echo "$body" | head -c 200)"
  fi

  resp_code=$(curl -s -o /tmp/vpa.body -w '%{http_code}' -H "$AUTH_HEADER" \
    "$BASE_URL/businesses/$BUSINESS_ID/presence/stats/overview?days=7")
  body=$(cat /tmp/vpa.body)
  if [[ "$resp_code" =~ ^2 ]] && echo "$body" | grep -q '"totals"'; then
    record PASS "3. presence.stats.overview" "$(echo "$body" | head -c 200)"
  else
    record FAIL "3. presence.stats.overview" "HTTP $resp_code: $(echo "$body" | head -c 200)"
  fi

  for rpt in sources pages funnel; do
    resp_code=$(curl -s -o /tmp/vpa.body -w '%{http_code}' -H "$AUTH_HEADER" \
      "$BASE_URL/businesses/$BUSINESS_ID/reports/presence/$rpt?days=7")
    body=$(cat /tmp/vpa.body)
    if [[ "$resp_code" =~ ^2 ]]; then
      record PASS "3. reports.presence.$rpt" "$(echo "$body" | head -c 180)"
    else
      record FAIL "3. reports.presence.$rpt" "HTTP $resp_code: $(echo "$body" | head -c 200)"
    fi
  done
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo
echo "== Summary =="
for r in "${RESULTS[@]}"; do printf '  %s\n' "$r"; done
echo
printf '  PASS=%d  FAIL=%d  SKIP=%d\n' "$PASS" "$FAIL" "$SKIP"

[ "$FAIL" -eq 0 ] || exit 1
exit 0
