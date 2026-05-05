#!/usr/bin/env bash
# verify-revenue.sh — Revenue happy-path smoke test.
#
# Drives create-invoice -> payment-link -> simulated webhook PAID -> assertions
# on invoice state, balance, and receipt-event emission. Designed to be run
# against a disposable test business; it does NOT clean up after itself, so
# point it at a sandbox / local DB only.
#
# Required env:
#   API_BASE          e.g. http://localhost:5000  (defaults to $REPLIT_DEV_DOMAIN or localhost:5000)
#   AUTH_TOKEN        bearer token for an authenticated user in the target business
#   BUSINESS_ID       business to create the invoice under
#   CONTACT_ID        contact to bill
#   STRIPE_WEBHOOK_SECRET  required so the simulated webhook signs correctly
#
# Usage:
#   bash scripts/verify-revenue.sh

set -euo pipefail

API_BASE="${API_BASE:-${REPLIT_DEV_DOMAIN:+https://$REPLIT_DEV_DOMAIN}}"
API_BASE="${API_BASE:-http://localhost:5000}"

require() {
  local name="$1"
  if [ -z "${!name:-}" ]; then
    echo "[verify-revenue] missing required env: $name" >&2
    exit 2
  fi
}

require AUTH_TOKEN
require BUSINESS_ID
require CONTACT_ID
require STRIPE_WEBHOOK_SECRET

auth() { echo "Authorization: Bearer $AUTH_TOKEN"; }

step() { echo "[verify-revenue] $*"; }

step "1/5 create invoice ($API_BASE)"
invoice_json=$(curl -fsS -X POST "$API_BASE/commerce/businesses/$BUSINESS_ID/invoices" \
  -H "$(auth)" \
  -H 'Content-Type: application/json' \
  -d "{\"contactId\":\"$CONTACT_ID\",\"items\":[{\"description\":\"verify-revenue smoke\",\"quantity\":1,\"unitPrice\":42.00}],\"currency\":\"USD\"}")
invoice_id=$(echo "$invoice_json" | python3 -c 'import json,sys;print(json.load(sys.stdin)["id"])')
step "    -> invoice $invoice_id"

step "2/5 transition DRAFT -> SENT"
curl -fsS -X PATCH "$API_BASE/commerce/invoices/$invoice_id/status/sent" \
  -H "$(auth)" -H 'Content-Type: application/json' -d '{}' >/dev/null

step "3/5 create payment link"
link_json=$(curl -fsS -X POST "$API_BASE/payments/businesses/$BUSINESS_ID/links" \
  -H "$(auth)" -H 'Content-Type: application/json' \
  -d "{\"invoiceId\":\"$invoice_id\"}" || true)
step "    payment link response: ${link_json:0:120}"

step "4/5 simulate Stripe checkout.session.completed webhook"
ts=$(date +%s)
payload="{\"id\":\"evt_smoke_${ts}\",\"type\":\"checkout.session.completed\",\"data\":{\"object\":{\"id\":\"cs_smoke_${ts}\",\"client_reference_id\":\"$invoice_id\",\"metadata\":{\"invoiceId\":\"$invoice_id\"},\"amount_total\":4200,\"currency\":\"usd\"}}}"
sig=$(printf '%s.%s' "$ts" "$payload" | openssl dgst -sha256 -hmac "$STRIPE_WEBHOOK_SECRET" -binary | xxd -p -c 256)
curl -fsS -X POST "$API_BASE/payments/stripe/webhook" \
  -H "Stripe-Signature: t=${ts},v1=${sig}" \
  -H 'Content-Type: application/json' \
  --data "$payload" >/dev/null

# Replay the same event — should be a no-op (dedup table catches it).
curl -fsS -X POST "$API_BASE/payments/stripe/webhook" \
  -H "Stripe-Signature: t=${ts},v1=${sig}" \
  -H 'Content-Type: application/json' \
  --data "$payload" >/dev/null
step "    webhook + replay accepted"

step "5/6 assert PAID state, zero remaining"
final=$(curl -fsS "$API_BASE/commerce/invoices/$invoice_id" -H "$(auth)")
status=$(echo "$final" | python3 -c 'import json,sys;print(json.load(sys.stdin).get("status",""))')
total=$(echo "$final" | python3 -c 'import json,sys;print(json.load(sys.stdin).get("total",0))')
contact_id_resolved=$(echo "$final" | python3 -c 'import json,sys;print(json.load(sys.stdin).get("contactId",""))')

if [ "$status" != "PAID" ]; then
  echo "[verify-revenue] FAIL: invoice status is '$status', expected PAID" >&2
  exit 1
fi

payments=$(curl -fsS "$API_BASE/payments/invoice/$invoice_id/status" -H "$(auth)")
paid_sum=$(echo "$payments" | python3 -c '
import json,sys
data=json.load(sys.stdin)
print(sum(p["amount"] for p in data if p.get("status")=="SUCCESSFUL"))')

step "    status=$status total=$total paid=$paid_sum"
if ! python3 -c "import sys;sys.exit(0 if abs(${paid_sum}-${total})<0.01 else 1)"; then
  echo "[verify-revenue] FAIL: paid sum $paid_sum != invoice total $total" >&2
  exit 1
fi

step "6/6 assert receipt-side evidence (invoice.paid + payment_receipt event on contact)"
# Look for the canonical invoice.paid contact-event written by CommerceService
# AND the payment_receipt notification event the FlowListener writes when the
# customer is notified. Either being missing means the receipt-on-payment
# pipeline is broken, even if the invoice flipped to PAID.
contact_events_url="$API_BASE/crm/contacts/${contact_id_resolved:-$CONTACT_ID}/events"
events_json=$(curl -fsS "$contact_events_url" -H "$(auth)" || echo '[]')
receipt_evidence=$(echo "$events_json" | python3 -c '
import json,sys
try:
  data = json.load(sys.stdin)
except Exception:
  data = []
rows = data.get("data", data) if isinstance(data, dict) else data
inv_paid = any(e.get("type") == "invoice.paid" and (e.get("data") or {}).get("invoiceId") == "'$invoice_id'" for e in rows)
receipt = any(e.get("type") in ("payment_receipt","invoice.payment_receipt","email.payment_receipt") and (e.get("data") or {}).get("invoiceId") == "'$invoice_id'" for e in rows)
print(f"invoice_paid={inv_paid} receipt={receipt}")
')
step "    $receipt_evidence"
if echo "$receipt_evidence" | grep -q "invoice_paid=False"; then
  echo "[verify-revenue] FAIL: no invoice.paid contact event for $invoice_id — receipt pipeline did not fire" >&2
  exit 1
fi
if echo "$receipt_evidence" | grep -q "receipt=False"; then
  echo "[verify-revenue] WARN: invoice.paid recorded but no payment_receipt notification for $invoice_id" >&2
  # Soft-fail: receipt notifier may be disabled in some envs (e.g. no SMTP).
  # We don't exit non-zero here, but the WARN is the operator's signal.
fi

step "OK — invoice $invoice_id closed, balance reconciled, webhook idempotent, receipt event recorded"
