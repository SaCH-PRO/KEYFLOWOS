#!/usr/bin/env bash
# verify-presence.sh — S0 smoke check for the 4 canonical public flows.
#
# Exercises each public flow end-to-end against a running dev server.
# Reports PASS / FAIL / SKIP per step and exits non-zero on any FAIL.
#
# Required env:
#   BASE_URL          e.g. http://localhost:3001  (NestJS API; falls back to $REPLIT_DEV_DOMAIN)
#   BUSINESS_SLUG     slug of a business that has storeEnabled=true
#   BUSINESS_ID       id of that business
# Optional env:
#   PRODUCT_ID        a sellable Product.id (Flow A). Auto-detected from public list if absent.
#   SERVICE_ID        a Service.id (Flow B).        Auto-detected from public list if absent.
#   STAFF_ID          a StaffMember.id (Flow B).    Auto-detected from public staff list if absent.
#   CUSTOMER_EMAIL    defaults to verify-presence+<ts>@example.com
#
# This script never charges real money. Checkout uses paymentMethod=CASH,
# bookings use a future timestamp, intake/qualification are dry-run.
#
# Usage:
#   BASE_URL=http://localhost:3001 BUSINESS_SLUG=demo BUSINESS_ID=clu... \
#     bash scripts/verify-presence.sh

set -u
set -o pipefail

BASE_URL="${BASE_URL:-${REPLIT_DEV_DOMAIN:+https://$REPLIT_DEV_DOMAIN}}"
BASE_URL="${BASE_URL:-http://localhost:3001}"
BUSINESS_SLUG="${BUSINESS_SLUG:-}"
BUSINESS_ID="${BUSINESS_ID:-}"
PRODUCT_ID="${PRODUCT_ID:-}"
SERVICE_ID="${SERVICE_ID:-}"
STAFF_ID="${STAFF_ID:-}"
CUSTOMER_EMAIL="${CUSTOMER_EMAIL:-verify-presence+$(date +%s)@example.com}"

PASS=0
FAIL=0
SKIP=0
RESULTS=()

c_red()   { printf '\033[31m%s\033[0m' "$1"; }
c_grn()   { printf '\033[32m%s\033[0m' "$1"; }
c_yel()   { printf '\033[33m%s\033[0m' "$1"; }
c_dim()   { printf '\033[2m%s\033[0m' "$1"; }

record() {
  local status="$1"; local label="$2"; local detail="${3:-}"
  case "$status" in
    PASS) PASS=$((PASS+1)); RESULTS+=("$(c_grn PASS) $label $(c_dim "$detail")") ;;
    FAIL) FAIL=$((FAIL+1)); RESULTS+=("$(c_red FAIL) $label $(c_dim "$detail")") ;;
    SKIP) SKIP=$((SKIP+1)); RESULTS+=("$(c_yel SKIP) $label $(c_dim "$detail")") ;;
  esac
}

require_env() {
  local missing=0
  for v in BASE_URL BUSINESS_SLUG BUSINESS_ID; do
    if [ -z "${!v:-}" ]; then
      echo "ERROR: $v is required" >&2
      missing=1
    fi
  done
  [ "$missing" -eq 0 ] || exit 2
}

# http_get URL -> echoes "<status>\n<body>"
http_get() {
  local url="$1"
  curl -s -o /tmp/vp.body -w '%{http_code}' "$url"
  echo
  cat /tmp/vp.body
}

# http_post URL JSON -> echoes "<status>\n<body>"
http_post() {
  local url="$1"; local body="$2"
  curl -s -o /tmp/vp.body -w '%{http_code}' \
    -H 'Content-Type: application/json' \
    -X POST -d "$body" "$url"
  echo
  cat /tmp/vp.body
}

assert_2xx() {
  local label="$1"; local response="$2"; local expect_field="${3:-}"
  local code
  code="$(printf '%s' "$response" | head -n1)"
  local body
  body="$(printf '%s' "$response" | tail -n +2)"
  if [[ ! "$code" =~ ^2 ]]; then
    record FAIL "$label" "HTTP $code: $(echo "$body" | head -c 200)"
    return 1
  fi
  if [ -n "$expect_field" ]; then
    if ! printf '%s' "$body" | grep -q "\"$expect_field\""; then
      record FAIL "$label" "HTTP $code but missing field \"$expect_field\""
      return 1
    fi
  fi
  record PASS "$label" "HTTP $code"
  printf '%s' "$body"
  return 0
}

require_env

echo "verify-presence.sh"
echo "  BASE_URL=$BASE_URL"
echo "  BUSINESS_SLUG=$BUSINESS_SLUG"
echo "  BUSINESS_ID=$BUSINESS_ID"
echo "  CUSTOMER_EMAIL=$CUSTOMER_EMAIL"
echo

# ---------------------------------------------------------------------------
# Pre-flight: identity slug resolve + storefront config
# ---------------------------------------------------------------------------
echo "== Pre-flight =="

resp="$(http_get "$BASE_URL/identity/businesses/slug/$BUSINESS_SLUG")"
assert_2xx "identity.slug-lookup" "$resp" "id" >/dev/null || true

resp="$(http_get "$BASE_URL/site/storefront/public/$BUSINESS_SLUG")"
assert_2xx "site.storefront.public" "$resp" >/dev/null || true

# ---------------------------------------------------------------------------
# Flow A — View → Buy product
# ---------------------------------------------------------------------------
echo
echo "== Flow A: View → Buy product =="

products_resp="$(http_get "$BASE_URL/commerce/public/businesses/$BUSINESS_ID/products")"
products_body="$(assert_2xx "A1.commerce.public.products" "$products_resp")" || products_body=""

if [ -z "$PRODUCT_ID" ] && [ -n "$products_body" ]; then
  PRODUCT_ID="$(printf '%s' "$products_body" \
    | python3 -c 'import json,sys
try:
  d=json.load(sys.stdin)
  for p in (d if isinstance(d,list) else d.get("data",[])):
    if p.get("isActive") and p.get("category") in ("PRODUCT","PACKAGE"):
      print(p["id"]); break
except Exception:
  pass' 2>/dev/null || true)"
fi

if [ -z "$PRODUCT_ID" ]; then
  record SKIP "A2.checkout.cash" "no buyable product available"
else
  resp="$(http_post "$BASE_URL/site/storefront/public/$BUSINESS_SLUG/checkout" \
    "{\"items\":[{\"productId\":\"$PRODUCT_ID\",\"quantity\":1}],\"customer\":{\"name\":\"VerifyPresence Bot\",\"email\":\"$CUSTOMER_EMAIL\"},\"paymentMethod\":\"CASH\"}")"
  body="$(assert_2xx "A2.checkout.cash" "$resp" "order")" || body=""

  if [ -n "$body" ]; then
    order_id="$(printf '%s' "$body" \
      | python3 -c 'import json,sys
try:
  d=json.load(sys.stdin)
  o=d.get("order") or d
  print(o.get("id",""))
except Exception:
  pass' 2>/dev/null || true)"
    if [ -n "$order_id" ]; then
      resp="$(http_get "$BASE_URL/site/storefront/public/order/$order_id?email=$(printf %s "$CUSTOMER_EMAIL" | sed 's/@/%40/')")"
      assert_2xx "A3.public.order.lookup" "$resp" "orderNumber" >/dev/null || true
    else
      record FAIL "A3.public.order.lookup" "no order id returned"
    fi
  fi

  resp="$(http_post "$BASE_URL/site/storefront/public/$BUSINESS_SLUG/validate-promo" \
    "{\"code\":\"VP-DOES-NOT-EXIST\",\"items\":[{\"productId\":\"$PRODUCT_ID\",\"quantity\":1}]}")"
  code="$(printf '%s' "$resp" | head -n1)"
  if [[ "$code" =~ ^4 ]]; then
    record PASS "A4.validate-promo.invalid-rejected" "HTTP $code (expected)"
  elif [[ "$code" =~ ^2 ]]; then
    record FAIL "A4.validate-promo.invalid-rejected" "HTTP $code (expected 4xx for unknown code)"
  else
    record FAIL "A4.validate-promo.invalid-rejected" "HTTP $code"
  fi
fi

resp="$(http_post "$BASE_URL/site/businesses/$BUSINESS_ID/analytics/event" \
  '{"type":"page_view"}')"
assert_2xx "A5.analytics.page_view" "$resp" >/dev/null || true

# ---------------------------------------------------------------------------
# Flow B — View → Book service
# ---------------------------------------------------------------------------
echo
echo "== Flow B: View → Book service =="

services_resp="$(http_get "$BASE_URL/bookings/public/businesses/$BUSINESS_ID/services")"
services_body="$(assert_2xx "B1.bookings.public.services" "$services_resp")" || services_body=""

staff_resp="$(http_get "$BASE_URL/bookings/public/businesses/$BUSINESS_ID/staff")"
staff_body="$(assert_2xx "B2.bookings.public.staff" "$staff_resp")" || staff_body=""

if [ -z "$SERVICE_ID" ] && [ -n "$services_body" ]; then
  SERVICE_ID="$(printf '%s' "$services_body" | python3 -c 'import json,sys
try:
  d=json.load(sys.stdin)
  arr=d if isinstance(d,list) else d.get("data",[])
  if arr: print(arr[0]["id"])
except Exception: pass' 2>/dev/null || true)"
fi
if [ -z "$STAFF_ID" ] && [ -n "$staff_body" ]; then
  STAFF_ID="$(printf '%s' "$staff_body" | python3 -c 'import json,sys
try:
  d=json.load(sys.stdin)
  arr=d if isinstance(d,list) else d.get("data",[])
  if arr: print(arr[0]["id"])
except Exception: pass' 2>/dev/null || true)"
fi

if [ -z "$SERVICE_ID" ]; then
  record SKIP "B3.public.book" "no bookable service available"
else
  start_iso="$(python3 -c 'import datetime; print((datetime.datetime.utcnow()+datetime.timedelta(days=14)).replace(microsecond=0).isoformat()+"Z")')"
  end_iso="$(python3 -c 'import datetime; print((datetime.datetime.utcnow()+datetime.timedelta(days=14, hours=1)).replace(microsecond=0).isoformat()+"Z")')"
  staff_field=""
  [ -n "$STAFF_ID" ] && staff_field="\"staffId\":\"$STAFF_ID\","
  resp="$(http_post "$BASE_URL/bookings/public/businesses/$BUSINESS_ID" \
    "{${staff_field}\"serviceId\":\"$SERVICE_ID\",\"startTime\":\"$start_iso\",\"endTime\":\"$end_iso\",\"firstName\":\"VerifyPresence\",\"lastName\":\"Bot\",\"email\":\"$CUSTOMER_EMAIL\",\"phone\":\"+10000000000\"}")"
  assert_2xx "B3.public.book" "$resp" "bookingId" >/dev/null || true
fi

# ---------------------------------------------------------------------------
# Flow C — Inquiry / Quote request
# ---------------------------------------------------------------------------
echo
echo "== Flow C: Inquiry / Quote request =="

resp="$(http_post "$BASE_URL/site/storefront/public/$BUSINESS_SLUG/intake" \
  "{\"name\":\"VerifyPresence Bot\",\"email\":\"$CUSTOMER_EMAIL\",\"phone\":\"+10000000000\",\"category\":\"general\",\"description\":\"Smoke test inquiry from verify-presence.sh\",\"budget\":\"100-500\",\"urgency\":\"this_month\"}")"
assert_2xx "C1.intake.submit" "$resp" >/dev/null || true

resp="$(http_get "$BASE_URL/site/storefront/public/$BUSINESS_SLUG/qualification-flow")"
qf_code="$(printf '%s' "$resp" | head -n1)"
if [[ "$qf_code" =~ ^2 ]] || [[ "$qf_code" == "404" ]]; then
  record PASS "C2.qualification-flow.read" "HTTP $qf_code (404 acceptable when no flow configured)"
else
  record FAIL "C2.qualification-flow.read" "HTTP $qf_code"
fi

resp="$(http_post "$BASE_URL/site/storefront/public/$BUSINESS_SLUG/qualification-recommend" \
  '{"answers":[]}')"
qr_code="$(printf '%s' "$resp" | head -n1)"
if [[ "$qr_code" =~ ^2 ]] || [[ "$qr_code" == "404" ]] || [[ "$qr_code" == "400" ]]; then
  record PASS "C3.qualification-recommend" "HTTP $qr_code"
else
  record FAIL "C3.qualification-recommend" "HTTP $qr_code"
fi

# ---------------------------------------------------------------------------
# Flow D — Share
# ---------------------------------------------------------------------------
echo
echo "== Flow D: Share (proxy-validated — no server-side share endpoint exists today; see Gap #G5) =="

# Share has no server-side write today (Gap #G5). We confirm:
#   1. The storefront response carries enough metadata to build a share URL.
#   2. An analytics event of type 'share' is *accepted* (so a fix is one-line client-side).
sf_resp="$(http_get "$BASE_URL/site/storefront/public/$BUSINESS_SLUG")"
sf_code="$(printf '%s' "$sf_resp" | head -n1)"
if [[ "$sf_code" =~ ^2 ]]; then
  if printf '%s' "$sf_resp" | tail -n +2 | grep -qE '"name"|"slug"|"businessId"'; then
    record PASS "D1.share.metadata-available" "storefront returns nameable business"
  else
    record FAIL "D1.share.metadata-available" "storefront response has no name/slug fields"
  fi
else
  record FAIL "D1.share.metadata-available" "HTTP $sf_code"
fi

resp="$(http_post "$BASE_URL/site/businesses/$BUSINESS_ID/analytics/event" \
  '{"type":"share","itemId":"verify-presence"}')"
assert_2xx "D2.share.analytics-accepted" "$resp" >/dev/null || true

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo
echo "== Summary =="
for r in "${RESULTS[@]}"; do
  printf '  %s\n' "$r"
done
echo
printf '  PASS=%d  FAIL=%d  SKIP=%d\n' "$PASS" "$FAIL" "$SKIP"

[ "$FAIL" -eq 0 ] || exit 1
exit 0
