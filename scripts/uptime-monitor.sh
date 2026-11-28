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
# scheduler (cron, GitHub Actions, etc.).
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
#   SLO_TARGET_PCT            Rolling availability objective (%). Default: 99.5.
#   SLO_WINDOW_DAYS           Rolling SLO window in UTC days. Default: 30.
#   SLO_MIN_SAMPLES           Minimum probes in window before budget exhaustion alerts. Default: 2.
#   UPTIME_NOW_UTC            Optional ISO-8601 UTC timestamp override (testing).
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
SLO_TARGET_PCT="${SLO_TARGET_PCT:-99.5}"
SLO_WINDOW_DAYS="${SLO_WINDOW_DAYS:-30}"
SLO_MIN_SAMPLES="${SLO_MIN_SAMPLES:-2}"
QUIET="${QUIET:-0}"

WEB_HEALTHZ_URL="${BASE_URL%/}/api/healthz"
API_READYZ_URL="${API_BASE%/}/readyz"

now_utc() {
  if [ -n "${UPTIME_NOW_UTC:-}" ]; then
    printf '%s' "$UPTIME_NOW_UTC"
  else
    date -u +%FT%TZ
  fi
}

# ---- tiny JSON helpers -----------------------------------------------------

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

# Update consecutive-failure counters and rolling per-day SLO tallies in the
# same JSON state file, pruning days outside the rolling window. Writes
# atomically via a temp file and prints one tab-separated summary line per
# check: <check>\t<avail_pct>\t<budget_rem_pct>\t<good>\t<total>\t<alert_flag>\t<eff_target>
update_state_and_slo() {
  local state_file="$1" new_web="$2" new_api="$3" web_ok="$4" api_ok="$5" now_iso="$6"
  python3 - "$state_file" "$new_web" "$new_api" "$web_ok" "$api_ok" "$now_iso" \
    "$SLO_TARGET_PCT" "$SLO_WINDOW_DAYS" "$SLO_MIN_SAMPLES" <<'PY'
import datetime as dt
import json
import os
import re
import sys
import tempfile

(
    state_file,
    new_web_s,
    new_api_s,
    web_ok_s,
    api_ok_s,
    now_iso,
    target_pct_s,
    window_days_s,
    min_samples_s,
) = sys.argv[1:10]

new_web = int(new_web_s)
new_api = int(new_api_s)
web_passed = int(web_ok_s) == 0
api_passed = int(api_ok_s) == 0

try:
    target_pct = float(target_pct_s)
    if not (0.0 < target_pct < 100.0):
        target_pct = 99.5
except ValueError:
    target_pct = 99.5

target_label = f"{target_pct:g}"

try:
    window_days = min(3650, max(1, int(window_days_s)))
except ValueError:
    window_days = 30

try:
    min_samples = max(1, int(min_samples_s))
except ValueError:
    min_samples = 2

DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}\Z")
MAX_STATE_BYTES = 1024 * 1024

def parse_today(raw_iso: str) -> dt.date:
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})", raw_iso.strip())
    if m:
        try:
            return dt.date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        except ValueError:
            pass
    return dt.datetime.now(dt.timezone.utc).date()

today = parse_today(now_iso)
today_key = today.isoformat()
cutoff = today - dt.timedelta(days=window_days - 1)

existing = {}
if os.path.isfile(state_file):
    try:
        if os.path.getsize(state_file) <= MAX_STATE_BYTES:
            with open(state_file, "r", encoding="utf-8") as fh:
                parsed = json.load(fh)
                if isinstance(parsed, dict):
                    existing = parsed
    except Exception:
        existing = {}

slo_in = existing.get("slo")
if not isinstance(slo_in, dict):
    slo_in = {}

slo_out = {}
allowed_error = 1.0 - (target_pct / 100.0)

def process_check(key: str, passed: bool):
    entry = slo_in.get(key)
    if not isinstance(entry, dict):
        entry = {}
    raw_days = entry.get("days")
    days = {}
    if isinstance(raw_days, dict):
        for d_key, counts in raw_days.items():
            if not isinstance(d_key, str) or not DATE_RE.match(d_key):
                continue
            try:
                d_val = dt.date.fromisoformat(d_key)
            except ValueError:
                continue
            if d_val < cutoff or d_val > today:
                continue
            if not isinstance(counts, dict):
                continue
            g = counts.get("good", 0)
            t = counts.get("total", 0)
            if isinstance(g, bool) or isinstance(t, bool):
                continue
            if not isinstance(g, int) or not isinstance(t, int):
                continue
            if g < 0 or t < 0 or g > t:
                continue
            days[d_key] = {"good": g, "total": t}

    cur = days.get(today_key, {"good": 0, "total": 0})
    cur["total"] += 1
    if passed:
        cur["good"] += 1
    days[today_key] = cur

    # Keep sorted keys strictly bounded to window_days.
    sorted_keys = sorted(days.keys())[-window_days:]
    bounded_days = {k: days[k] for k in sorted_keys}

    total_good = sum(v["good"] for v in bounded_days.values())
    total_probes = sum(v["total"] for v in bounded_days.values())

    if total_probes > 0:
        avail_ratio = total_good / total_probes
        avail_pct = avail_ratio * 100.0
        obs_error = (total_probes - total_good) / total_probes
        budget_rem = max(0.0, (allowed_error - obs_error) / allowed_error) * 100.0
    else:
        avail_pct = 100.0
        budget_rem = 100.0

    prev_exhausted = entry.get("budget_exhausted") is True
    now_exhausted = (total_probes >= min_samples) and (avail_pct + 1e-12 < target_pct)
    should_alert = (not prev_exhausted) and now_exhausted

    slo_out[key] = {
        "days": bounded_days,
        "budget_exhausted": now_exhausted,
    }
    return f"{key}\t{avail_pct:.2f}\t{budget_rem:.2f}\t{total_good}\t{total_probes}\t{1 if should_alert else 0}\t{target_label}"

web_line = process_check("web_healthz", web_passed)
api_line = process_check("api_readyz", api_passed)

out_state = {
    "web_healthz": new_web,
    "api_readyz": new_api,
    "slo": slo_out,
    "updatedAt": now_iso,
}

state_dir = os.path.dirname(os.path.abspath(state_file)) or "/tmp"
os.makedirs(state_dir, exist_ok=True)
fd, tmp_path = tempfile.mkstemp(prefix=".uptime-state-", dir=state_dir)
try:
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        json.dump(out_state, fh, separators=(",", ":"))
        fh.write("\n")
    os.replace(tmp_path, state_file)
except Exception:
    try:
        os.unlink(tmp_path)
    except OSError:
        pass
    raise

print(web_line)
print(api_line)
PY
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
    "$(json_string "$(now_utc)")")
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

RUN_TS="$(now_utc)"

[ "$QUIET" = "1" ] || {
  echo "[uptime-monitor] $RUN_TS"
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

if ! slo_summary=$(update_state_and_slo "$STATE_FILE" "$new_web" "$new_api" "$web_ok" "$api_ok" "$RUN_TS"); then
  echo "[uptime-monitor] WARN: failed to update state/SLO ledger at $STATE_FILE" >&2
  slo_summary=""
fi

eff_target="99.5"
web_avail="100.00" web_budget="100.00" web_good="0" web_total="0" web_slo_alert="0"
api_avail="100.00" api_budget="100.00" api_good="0" api_total="0" api_slo_alert="0"
while IFS=$'\t' read -r s_key s_avail s_budget s_good s_total s_alert s_target; do
  if [ -n "$s_target" ]; then eff_target="$s_target"; fi
  if [ "$s_key" = "web_healthz" ]; then
    web_avail="$s_avail" web_budget="$s_budget" web_good="$s_good" web_total="$s_total" web_slo_alert="$s_alert"
  elif [ "$s_key" = "api_readyz" ]; then
    api_avail="$s_avail" api_budget="$s_budget" api_good="$s_good" api_total="$s_total" api_slo_alert="$s_alert"
  fi
done <<< "$slo_summary"

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

# SLO error-budget exhaustion transitions (one alert per transition)
if [ "$web_slo_alert" = "1" ]; then
  emit_alert "SLO_BUDGET_EXHAUSTED" "web.healthz" "availability_30d=${web_avail}% error_budget_remaining=${web_budget}% (good=${web_good}/total=${web_total}, target=${eff_target}%)"
fi
if [ "$api_slo_alert" = "1" ]; then
  emit_alert "SLO_BUDGET_EXHAUSTED" "api.readyz" "availability_30d=${api_avail}% error_budget_remaining=${api_budget}% (good=${api_good}/total=${api_total}, target=${eff_target}%)"
fi

[ "$QUIET" = "1" ] && [ "$web_ok" -eq 0 ] && [ "$api_ok" -eq 0 ] || {
  printf '  web.healthz : %s  (consecutive_failures=%d)\n' "$web_result" "$new_web"
  printf '  api.readyz  : %s  (consecutive_failures=%d)\n' "$api_result" "$new_api"
  printf '  web.healthz availability_30d=%s%% error_budget_remaining=%s%% (good=%s/total=%s, target=%s%%)\n' \
    "$web_avail" "$web_budget" "$web_good" "$web_total" "$eff_target"
  printf '  api.readyz availability_30d=%s%% error_budget_remaining=%s%% (good=%s/total=%s, target=%s%%)\n' \
    "$api_avail" "$api_budget" "$api_good" "$api_total" "$eff_target"
}

if [ "$new_web" -ge "$FAIL_THRESHOLD" ] || [ "$new_api" -ge "$FAIL_THRESHOLD" ]; then
  exit 1
fi
exit 0
