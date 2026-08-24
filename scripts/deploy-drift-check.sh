#!/usr/bin/env bash
# Deploy drift check — is production running current code?
#
# Production deploys are manual (scripts/deploy.sh). Nothing watches whether a
# deploy was FORGOTTEN. deploy.sh's own postmortem is exactly this failure:
# prod sat 221 commits / 11 days behind main, carrying a proven exploit,
# "because nobody could remember how" to deploy. This is the missing alarm.
#
# It runs where both halves are available — a GitHub Actions runner reaches
# production (unlike the egress-restricted cloud cycle) AND can ask the GitHub
# API how far prod's deployed commit is behind main. No local git history is
# needed (the compare is computed server-side), and no cloud egress allowlist:
# the audit cycle reads THIS workflow's run conclusion for its commit-drift
# check (success = current, failure = drifted).
#
# Signals, in order:
#   status == identical / ahead_by == 0  -> current, exit 0
#   status == diverged                   -> prod on a commit NOT in main, ALERT
#   days behind > DRIFT_DAYS             -> stale by age, ALERT   (primary)
#   ahead_by  > DRIFT_COMMITS            -> stale by count, ALERT (backstop)
#   otherwise (behind but within limits) -> report, exit 0
#
# Age is the primary signal because commit count is noisy during active
# development; a busy day can put main 50 commits ahead the same afternoon.
#
# Required env:
#   API_BASE   prod base, e.g. https://keyflowos.com   (probes $API_BASE/api/healthz)
#   REPO       owner/repo, e.g. SaCH-PRO/KEYFLOWOS
#   GH_TOKEN   token for `gh api` (github.token in Actions)
# Optional env:
#   MAIN_REF          default "main"
#   DRIFT_DAYS        alert if behind more than this many days. Default 7.
#   DRIFT_COMMITS     alert if behind more than this many commits. Default 200.
#   ALERT_WEBHOOK_URL generic JSON webhook (PagerDuty/Opsgenie/etc.).
#   SLACK_WEBHOOK_URL Slack incoming webhook.
#   MONITOR_LABEL     label in alerts. Default keyflowos.
#
# Exit codes:
#   0  prod current, or behind within thresholds (no alert)
#   1  drift threshold crossed (alerted) — the run conclusion the audit reads
#   2  invalid invocation (missing API_BASE / REPO)
#   3  could not determine (prod unreachable or compare failed) — inconclusive,
#      NOT counted as drift (prod-down is the uptime monitor's job)

set -uo pipefail

: "${API_BASE:?API_BASE is required (prod base URL)}" 2>/dev/null || { echo "[drift] ERROR: API_BASE required" >&2; exit 2; }
: "${REPO:?REPO is required (owner/repo)}" 2>/dev/null || { echo "[drift] ERROR: REPO required" >&2; exit 2; }
MAIN_REF="${MAIN_REF:-main}"
DRIFT_DAYS="${DRIFT_DAYS:-7}"
DRIFT_COMMITS="${DRIFT_COMMITS:-200}"
MONITOR_LABEL="${MONITOR_LABEL:-keyflowos}"

json_string() { python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))' <<<"$1"; }

alert() {
  local detail="$1"
  echo "::warning title=deploy-drift::${detail}"
  echo "[drift] ALERT: ${detail}"
  if [ -n "${SLACK_WEBHOOK_URL:-}" ]; then
    curl -sS -m 10 -X POST -H 'Content-Type: application/json' \
      --data "$(printf '{"text":%s}' "$(json_string "[${MONITOR_LABEL}] DEPLOY DRIFT :: ${detail}")")" \
      "$SLACK_WEBHOOK_URL" >/dev/null || true
  fi
  if [ -n "${ALERT_WEBHOOK_URL:-}" ]; then
    curl -sS -m 10 -X POST -H 'Content-Type: application/json' \
      --data "$(printf '{"monitor":%s,"event":"DEPLOY_DRIFT","detail":%s,"timestamp":%s}' \
        "$(json_string "$MONITOR_LABEL")" "$(json_string "$detail")" "$(json_string "$(date -u +%FT%TZ)")")" \
      "$ALERT_WEBHOOK_URL" >/dev/null || true
  fi
}

# ---- prod's deployed commit ----
health=$(curl -sS -m 10 "${API_BASE%/}/api/healthz" 2>/dev/null || true)
prod_commit=$(printf '%s' "$health" | grep -oE '"commit":"[^"]+"' | head -n1 | cut -d'"' -f4)
if [ -z "$prod_commit" ] || [ "$prod_commit" = "unknown" ]; then
  echo "[drift] INCONCLUSIVE: could not read prod commit from ${API_BASE%/}/api/healthz" >&2
  exit 3
fi

# ---- how far behind main (server-side compare, no local history needed) ----
row=$(gh api "repos/${REPO}/compare/${prod_commit}...${MAIN_REF}" \
  --jq '[.status, (.ahead_by|tostring), (.commits[0].commit.committer.date // "")] | @tsv' 2>/dev/null || true)
if [ -z "$row" ]; then
  echo "[drift] INCONCLUSIVE: compare ${prod_commit}...${MAIN_REF} failed (unknown commit? API error?)" >&2
  exit 3
fi
IFS=$'\t' read -r status ahead_by first_date <<<"$row"

echo "[drift] prod=${prod_commit} status=${status} ahead_by=${ahead_by} first_missing=${first_date:-none}"

if [ "$status" = "identical" ] || [ "${ahead_by:-0}" = "0" ]; then
  echo "[drift] prod is current with ${MAIN_REF}."
  exit 0
fi

if [ "$status" = "diverged" ]; then
  alert "prod commit ${prod_commit} is NOT an ancestor of ${MAIN_REF} (diverged) — deployed code is not on the mainline"
  exit 1
fi

days_behind=0
if [ -n "${first_date:-}" ]; then
  then_epoch=$(date -u -d "$first_date" +%s 2>/dev/null || echo 0)
  now_epoch=$(date -u +%s)
  [ "$then_epoch" -gt 0 ] && days_behind=$(( (now_epoch - then_epoch) / 86400 ))
fi
echo "[drift] behind by ${ahead_by} commit(s), ~${days_behind} day(s)."

if [ "$days_behind" -gt "$DRIFT_DAYS" ]; then
  alert "prod is ~${days_behind}d behind ${MAIN_REF} (${ahead_by} commits, oldest ${first_date}) — a deploy has been missed for over ${DRIFT_DAYS}d"
  exit 1
fi
if [ "${ahead_by:-0}" -gt "$DRIFT_COMMITS" ]; then
  alert "prod is ${ahead_by} commits behind ${MAIN_REF} (over ${DRIFT_COMMITS}) — deploy backlog"
  exit 1
fi

echo "[drift] behind but within thresholds (<=${DRIFT_DAYS}d, <=${DRIFT_COMMITS} commits) — no alert."
exit 0
