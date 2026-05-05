#!/usr/bin/env bash
# verify-calendar-projection.sh
#
# End-to-end smoke test for the event-driven calendar projection.
#
# For each source module the C3 listeners cover, the script:
#   1. Creates a fresh source row via the running API (so source-module
#      events fire through the real EventEmitter2 bus).
#   2. Waits briefly for the async @OnEvent listeners to settle.
#   3. Asserts a CalendarEvent row was projected (or — for delete/cancel
#      paths — that the projection was soft-removed, never hard-deleted).
#
# Usage:
#   API_URL=http://localhost:3001 \
#   AUTH_TOKEN=<jwt> \
#   BUSINESS_ID=biz_123 \
#   CONTACT_ID=cnt_456 \
#   DATABASE_URL=postgres://... \
#   scripts/verify-calendar-projection.sh
#
# Optional: SERVICE_ID, STAFF_ID for the booking path. If omitted, the
# booking step is skipped.
set -euo pipefail

API_URL="${API_URL:-http://localhost:3001}"
DB_URL="${DATABASE_URL:?DATABASE_URL must be set}"
AUTH_TOKEN="${AUTH_TOKEN:?AUTH_TOKEN must be set}"
BUSINESS_ID="${BUSINESS_ID:?BUSINESS_ID must be set}"
CONTACT_ID="${CONTACT_ID:?CONTACT_ID must be set}"
SERVICE_ID="${SERVICE_ID:-}"
STAFF_ID="${STAFF_ID:-}"
SETTLE_MS="${SETTLE_MS:-1500}"

PSQL=(psql "$DB_URL" -At -v ON_ERROR_STOP=1)
HDR=(-H "Authorization: Bearer $AUTH_TOKEN" -H "Content-Type: application/json" -H "x-business-id: $BUSINESS_ID")

settle() { sleep "$(awk "BEGIN { print $SETTLE_MS/1000 }")"; }

count_active() {
  local source_type="$1" source_id="$2"
  "${PSQL[@]}" -c "SELECT COUNT(*) FROM \"CalendarEvent\" WHERE \"businessId\"='$BUSINESS_ID' AND \"sourceType\"='$source_type' AND \"sourceId\"='$source_id' AND \"deletedAt\" IS NULL;"
}

count_any() {
  local source_type="$1" source_id="$2"
  "${PSQL[@]}" -c "SELECT COUNT(*) FROM \"CalendarEvent\" WHERE \"businessId\"='$BUSINESS_ID' AND \"sourceType\"='$source_type' AND \"sourceId\"='$source_id';"
}

assert_present() {
  local label="$1" source_type="$2" source_id="$3" expected_type="$4" expected_module="$5"
  local row; row=$("${PSQL[@]}" -F'|' -c "SELECT type, module FROM \"CalendarEvent\" WHERE \"businessId\"='$BUSINESS_ID' AND \"sourceType\"='$source_type' AND \"sourceId\"='$source_id' AND \"deletedAt\" IS NULL LIMIT 1;")
  if [[ -z "$row" ]]; then
    echo "FAIL [$label]: expected projection ($source_type=$source_id), found 0" >&2; exit 2
  fi
  local got_type got_module
  got_type="${row%%|*}"; got_module="${row##*|}"
  if [[ -n "$expected_type" && "$got_type" != "$expected_type" ]]; then
    echo "FAIL [$label]: expected type=$expected_type got=$got_type ($source_type=$source_id)" >&2; exit 2
  fi
  if [[ -n "$expected_module" && "$got_module" != "$expected_module" ]]; then
    echo "FAIL [$label]: expected module=$expected_module got=$got_module ($source_type=$source_id)" >&2; exit 2
  fi
  echo "OK   [$label]: projected ($source_type=$source_id type=$got_type module=$got_module)"
}

assert_soft_removed() {
  local label="$1" source_type="$2" source_id="$3"
  local active total; active=$(count_active "$source_type" "$source_id"); total=$(count_any "$source_type" "$source_id")
  if [[ "${active:-0}" -ne 0 ]]; then
    echo "FAIL [$label]: expected soft-removed projection but $active still active" >&2; exit 2
  fi
  if [[ "${total:-0}" -lt 1 ]]; then
    echo "FAIL [$label]: projection row missing entirely (hard delete?)" >&2; exit 2
  fi
  echo "OK   [$label]: soft-removed ($source_type=$source_id)"
}

assert_status() {
  local label="$1" source_type="$2" source_id="$3" expected="$4"
  local got; got=$("${PSQL[@]}" -c "SELECT status FROM \"CalendarEvent\" WHERE \"businessId\"='$BUSINESS_ID' AND \"sourceType\"='$source_type' AND \"sourceId\"='$source_id' AND \"deletedAt\" IS NULL LIMIT 1;")
  if [[ "$got" != "$expected" ]]; then
    echo "FAIL [$label]: expected status=$expected got=$got ($source_type=$source_id)" >&2; exit 2
  fi
  echo "OK   [$label]: status=$expected ($source_type=$source_id)"
}

api() {
  local method="$1" path="$2" body="${3:-}"
  if [[ -n "$body" ]]; then
    curl -fsS -X "$method" "${HDR[@]}" -d "$body" "$API_URL$path"
  else
    curl -fsS -X "$method" "${HDR[@]}" "$API_URL$path"
  fi
}

echo "==> Calendar projection smoke test (business=$BUSINESS_ID)"

# ---------- 1. Contact task ----------
TASK_DUE=$(date -u -d "+1 day" +"%Y-%m-%dT%H:%M:%SZ")
TASK=$(api POST "/crm/businesses/$BUSINESS_ID/contacts/$CONTACT_ID/tasks" "{\"title\":\"smoke task\",\"dueDate\":\"$TASK_DUE\",\"priority\":\"NORMAL\"}")
TASK_ID=$(echo "$TASK" | jq -r '.id')
settle
assert_present "contact_task.created" "contact_task" "$TASK_ID" "CONTACT_TASK" "CRM"
api PATCH "/crm/businesses/$BUSINESS_ID/tasks/$TASK_ID" "{\"dueDate\":\"$(date -u -d "+3 day" +"%Y-%m-%dT%H:%M:%SZ")\"}" >/dev/null
settle
assert_present "contact_task.rescheduled" "contact_task" "$TASK_ID" "CONTACT_TASK" "CRM"
api POST "/crm/businesses/$BUSINESS_ID/tasks/$TASK_ID/complete" "" >/dev/null
settle
assert_status "contact_task.completed" "contact_task" "$TASK_ID" "COMPLETED"

# ---------- 2. Contact next action ----------
api POST "/crm/businesses/$BUSINESS_ID/contacts/$CONTACT_ID/next-action/snooze" "{\"days\":3}" >/dev/null
settle
assert_present "contact.next_action_set" "activity" "next_action:$CONTACT_ID" "FOLLOW_UP" "CRM"
api POST "/crm/businesses/$BUSINESS_ID/contacts/$CONTACT_ID/next-action/complete" "" >/dev/null
settle
assert_soft_removed "contact.next_action_cleared" "activity" "next_action:$CONTACT_ID"

# ---------- 3. Social post ----------
SCHED=$(date -u -d "+2 day" +"%Y-%m-%dT%H:%M:%SZ")
POST=$(api POST "/social/businesses/$BUSINESS_ID/posts" "{\"content\":\"smoke post\",\"mediaUrls\":[],\"scheduledAt\":\"$SCHED\"}")
POST_ID=$(echo "$POST" | jq -r '.id')
settle
assert_present "social_post.created" "social_post" "$POST_ID" "CONTENT_POST" "MARKETING"
api DELETE "/social/businesses/$BUSINESS_ID/posts/$POST_ID" "" >/dev/null
settle
assert_soft_removed "social_post.deleted" "social_post" "$POST_ID"

# ---------- 4. Email campaign ----------
CAMP=$(api POST "/businesses/$BUSINESS_ID/campaigns" "{\"name\":\"smoke camp\",\"subject\":\"hi\",\"body\":\"hi\"}")
CAMP_ID=$(echo "$CAMP" | jq -r '.id')
SCHED2=$(date -u -d "+5 day" +"%Y-%m-%dT%H:%M:%SZ")
api POST "/businesses/$BUSINESS_ID/campaigns/$CAMP_ID/schedule" "{\"scheduledAt\":\"$SCHED2\"}" >/dev/null
settle
assert_present "email_campaign.scheduled" "email_campaign" "$CAMP_ID" "EMAIL_CAMPAIGN" "MARKETING"
api DELETE "/businesses/$BUSINESS_ID/campaigns/$CAMP_ID" "" >/dev/null
settle
assert_soft_removed "email_campaign.deleted" "email_campaign" "$CAMP_ID"

# ---------- 5. Invoice (create + due_date_changed) ----------
DUE=$(date -u -d "+7 day" +"%Y-%m-%dT%H:%M:%SZ")
INV=$(api POST "/commerce/businesses/$BUSINESS_ID/invoices" "{\"contactId\":\"$CONTACT_ID\",\"dueDate\":\"$DUE\",\"items\":[{\"description\":\"smoke\",\"quantity\":1,\"unitPrice\":100}]}")
INV_ID=$(echo "$INV" | jq -r '.id')
settle
assert_present "invoice.created" "invoice" "$INV_ID" "INVOICE_DUE" "REVENUE"
NEW_DUE=$(date -u -d "+14 day" +"%Y-%m-%dT%H:%M:%SZ")
api PATCH "/commerce/businesses/$BUSINESS_ID/invoices/$INV_ID" "{\"dueDate\":\"$NEW_DUE\"}" >/dev/null
settle
assert_present "invoice.due_date_changed" "invoice" "$INV_ID" "INVOICE_DUE" "REVENUE"

# ---------- 6. Quote (create + expiry_changed + delete) ----------
EXP=$(date -u -d "+10 day" +"%Y-%m-%dT%H:%M:%SZ")
Q=$(api POST "/commerce/businesses/$BUSINESS_ID/quotes" "{\"contactId\":\"$CONTACT_ID\",\"expiryDate\":\"$EXP\",\"items\":[{\"description\":\"smoke\",\"quantity\":1,\"unitPrice\":50}]}")
Q_ID=$(echo "$Q" | jq -r '.id')
settle
assert_present "quote.created" "quote" "$Q_ID" "QUOTE_EXPIRY" "REVENUE"
api PATCH "/commerce/businesses/$BUSINESS_ID/quotes/$Q_ID" "{\"expiryDate\":\"$(date -u -d "+20 day" +"%Y-%m-%dT%H:%M:%SZ")\"}" >/dev/null
settle
assert_present "quote.expiry_changed" "quote" "$Q_ID" "QUOTE_EXPIRY" "REVENUE"
api DELETE "/commerce/businesses/$BUSINESS_ID/quotes/$Q_ID" "" >/dev/null
settle
assert_soft_removed "quote.deleted" "quote" "$Q_ID"

# ---------- 7. Project + project_task ----------
P=$(api POST "/projects/businesses/$BUSINESS_ID" "{\"name\":\"smoke proj\",\"dueDate\":\"$(date -u -d "+30 day" +"%Y-%m-%dT%H:%M:%SZ")\"}")
P_ID=$(echo "$P" | jq -r '.id')
settle
assert_present "project.created" "project" "$P_ID" "PROJECT_TASK" "PROJECTS"
PT=$(api POST "/projects/businesses/$BUSINESS_ID/projects/$P_ID/tasks" "{\"title\":\"smoke pt\",\"dueDate\":\"$(date -u -d "+5 day" +"%Y-%m-%dT%H:%M:%SZ")\"}")
PT_ID=$(echo "$PT" | jq -r '.id')
settle
assert_present "project_task.created" "project_task" "$PT_ID" "PROJECT_TASK" "PROJECTS"
api PATCH "/projects/businesses/$BUSINESS_ID/tasks/$PT_ID" "{\"isCompleted\":true}" >/dev/null
settle
assert_status "project_task.completed" "project_task" "$PT_ID" "COMPLETED"
api DELETE "/projects/businesses/$BUSINESS_ID/projects/$P_ID" "" >/dev/null
settle
assert_soft_removed "project.deleted" "project" "$P_ID"

# ---------- 8. Booking (optional — needs SERVICE_ID) ----------
if [[ -n "$SERVICE_ID" ]]; then
  START=$(date -u -d "+2 day" +"%Y-%m-%dT%H:%M:%SZ")
  BODY="{\"contactId\":\"$CONTACT_ID\",\"serviceId\":\"$SERVICE_ID\",\"startTime\":\"$START\""
  if [[ -n "$STAFF_ID" ]]; then BODY+=",\"staffId\":\"$STAFF_ID\""; fi
  BODY+="}"
  B=$(api POST "/bookings/businesses/$BUSINESS_ID" "$BODY")
  B_ID=$(echo "$B" | jq -r '.id')
  settle
  assert_present "booking.created" "booking" "$B_ID" "BOOKING" "BOOKINGS"
  api POST "/bookings/businesses/$BUSINESS_ID/bookings/$B_ID/status" '{"status":"CANCELLED"}' >/dev/null
  settle
  assert_status "booking.cancelled" "booking" "$B_ID" "CANCELLED"
else
  echo "SKIP booking: SERVICE_ID not set"
fi

echo "==> Smoke test passed."
