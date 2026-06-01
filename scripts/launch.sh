#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
#  KeyflowOS — Bulletproof Production Launch Mechanism
# ═══════════════════════════════════════════════════════════════════════════════
#
#  A fail-safe supervisor that ensures every dependency is healthy before
#  the app surface is exposed, monitors children continuously, and restarts
#  them with exponential backoff up to a safety limit.
#
#  Design principles:
#    1. Pre-flight gates — refuse to start if prerequisites are broken.
#    2. Ordered boot     — Postgres → API (health-check) → Web (health-check).
#    3. Continuous health monitoring — poll /readyz every 30 s.
#    4. Auto-restart     — up to MAX_RESTARTS per service, with backoff.
#    5. Fast-fail        — exit non-zero on repeated failure so the platform
#                          (Docker / systemd / any host) re-rolls the deploy.
#    6. Graceful shutdown — SIGTERM propagates to all children.
#
#  Usage:
#    ./scripts/launch.sh              # normal production start
#    ./scripts/launch.sh --no-preflight   # skip pre-flight (emergency)
#    ./scripts/launch.sh --docker-postgres # ensure Postgres container is running
#
# ═══════════════════════════════════════════════════════════════════════════════

set -uo pipefail

# ─── Configuration ───────────────────────────────────────────────────────────
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

API_PORT="${PORT:-3001}"
WEB_PORT="${WEB_PORT:-5000}"
API_HEALTH_URL="http://localhost:${API_PORT}/readyz"
WEB_HEALTH_URL="http://localhost:${WEB_PORT}/api/healthz"
DB_PORT="${DB_PORT:-5432}"

MAX_RESTARTS=5
RESTART_BACKOFF_BASE=3          # seconds; doubles each retry
HEALTH_CHECK_INTERVAL=30        # seconds
HEALTH_CHECK_TIMEOUT=10         # seconds
STARTUP_TIMEOUT=120             # seconds to wait for a service to become healthy

# Colours (disabled when not a TTY)
if [ -t 1 ]; then
  RED='\033[0;31m'; GRN='\033[0;32m'; YEL='\033[1;33m'
  BLU='\033[0;34m'; MAG='\033[0;35m'; CYN='\033[0;36m'
  BOLD='\033[1m';  RST='\033[0m'
else
  RED=''; GRN=''; YEL=''; BLU=''; MAG=''; CYN=''; BOLD=''; RST=''
fi

# ─── State ───────────────────────────────────────────────────────────────────
declare -A RESTART_COUNT
declare -A LAST_EXIT
declare -A PIDS
API_PID=""
WEB_PID=""
SHUTDOWN_IN_PROGRESS=0

# ─── Helpers ─────────────────────────────────────────────────────────────────
log() {
  local lvl="$1"; shift
  local col="$RST"
  case "$lvl" in
    INFO)  col="$GRN" ;;
    WARN)  col="$YEL" ;;
    ERROR) col="$RED" ;;
    BOOT)  col="$CYN$BOLD" ;;
    HEALTH)col="$MAG" ;;
  esac
  printf "${col}[%-5s]${RST} %s\n" "$lvl" "$*" >&2
}

is_port_listening() {
  local port="$1"
  if command -v netstat >/dev/null 2>&1; then
    netstat -ano 2>/dev/null | grep -q ":${port} .*LISTENING"
  elif command -v ss >/dev/null 2>&1; then
    ss -tlnp 2>/dev/null | grep -q ":${port} "
  else
    # Fallback: try to curl it
    curl -sf "http://localhost:${port}" >/dev/null 2>&1
  fi
}

wait_for_url() {
  local url="$1" timeout="${2:-$STARTUP_TIMEOUT}"
  local start=$SECONDS
  while true; do
    if curl -sf "$url" >/dev/null 2>&1; then
      return 0
    fi
    if [ $((SECONDS - start)) -ge "$timeout" ]; then
      return 1
    fi
    sleep 2
  done
}

kill_tree() {
  local pid="$1"
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    # Best-effort: kill the whole process group
    kill -TERM -- -"$pid" 2>/dev/null || true
    sleep 1
    kill -KILL -- -"$pid" 2>/dev/null || true
  fi
}

shutdown() {
  local sig="$1"
  if [ "$SHUTDOWN_IN_PROGRESS" -eq 1 ]; then
    log WARN "Shutdown already in progress…"
    return
  fi
  SHUTDOWN_IN_PROGRESS=1
  log BOOT "Received ${sig} — shutting down gracefully…"

  for svc in api web; do
    local pid_var="${svc^^}_PID"
    local pid="${!pid_var}"
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      log INFO "Stopping ${svc} (pid=${pid})…"
      kill_tree "$pid"
    fi
  done

  log INFO "All children stopped. Exiting."
  exit 0
}

trap 'shutdown TERM' TERM
trap 'shutdown INT'  INT

# ─── 1. Pre-flight ───────────────────────────────────────────────────────────
SKIP_PREFLIGHT=0
DOCKER_POSTGRES=0

for arg in "$@"; do
  case "$arg" in
    --no-preflight)   SKIP_PREFLIGHT=1 ;;
    --docker-postgres) DOCKER_POSTGRES=1 ;;
  esac
done

if [ "$SKIP_PREFLIGHT" -eq 0 ]; then
  log BOOT "Running pre-flight checks…"
  if ! bash "$ROOT_DIR/scripts/preflight.sh"; then
    log ERROR "Pre-flight failed — refusing to start."
    log INFO "Use --no-preflight to bypass (not recommended for production)."
    exit 1
  fi
  log INFO "Pre-flight passed."
else
  log WARN "Pre-flight SKIPPED — launching blind."
fi

# ─── 2. Ensure Postgres is running ───────────────────────────────────────────
if [ "$DOCKER_POSTGRES" -eq 1 ]; then
  log BOOT "Ensuring Postgres container is running…"
  if ! docker ps --format '{{.Names}}' 2>/dev/null | grep -q 'keyflow-postgres'; then
    if docker ps -a --format '{{.Names}}' 2>/dev/null | grep -q 'keyflow-postgres'; then
      log INFO "Starting existing keyflow-postgres container…"
      docker start keyflow-postgres >/dev/null 2>&1
    else
      log INFO "Creating keyflow-postgres container…"
      docker run -d \
        --name keyflow-postgres \
        -e POSTGRES_USER=keyflow \
        -e POSTGRES_PASSWORD=keyflow \
        -e POSTGRES_DB=keyflow \
        -p 5432:5432 \
        postgres:16-alpine \
        >/dev/null 2>&1
    fi
  fi
fi

if ! is_port_listening "$DB_PORT"; then
  log WARN "Postgres not detected on :${DB_PORT}. Waiting up to ${STARTUP_TIMEOUT}s…"
  local db_start=$SECONDS
  while ! is_port_listening "$DB_PORT"; do
    if [ $((SECONDS - db_start)) -ge "$STARTUP_TIMEOUT" ]; then
      log ERROR "Postgres did not become available on :${DB_PORT}. Aborting."
      exit 1
    fi
    sleep 2
  done
  log INFO "Postgres is now listening on :${DB_PORT}."
fi

# ─── 3. Resolve version ──────────────────────────────────────────────────────
if [ -z "${GIT_COMMIT:-}" ]; then
  if [ -s "$ROOT_DIR/.deploy-version" ]; then
    GIT_COMMIT="$(tr -d '[:space:]' < "$ROOT_DIR/.deploy-version")"
  elif command -v git >/dev/null 2>&1 && git -C "$ROOT_DIR" rev-parse HEAD >/dev/null 2>&1; then
    GIT_COMMIT="$(git -C "$ROOT_DIR" rev-parse HEAD)"
  else
    GIT_COMMIT="unknown"
  fi
fi
export GIT_COMMIT
log BOOT "KeyflowOS launch  commit=${GIT_COMMIT:0:12}  api=:${API_PORT}  web=:${WEB_PORT}"

# ─── 4. Service starter with health gate ─────────────────────────────────────
start_api() {
  log BOOT "Starting API on :${API_PORT}…"
  (
    cd "$ROOT_DIR/apps/server"
    exec pnpm exec tsx src/main.ts 2>&1
  ) &
  API_PID=$!
  PIDS[api]=$API_PID
  log INFO "API pid=${API_PID}  — waiting for /readyz…"

  if wait_for_url "$API_HEALTH_URL" "$STARTUP_TIMEOUT"; then
    log INFO "API healthy — ${API_HEALTH_URL} responded."
    return 0
  else
    log ERROR "API failed to become healthy within ${STARTUP_TIMEOUT}s."
    return 1
  fi
}

start_web() {
  log BOOT "Starting Web on :${WEB_PORT}…"
  (
    cd "$ROOT_DIR/apps/web"
    exec pnpm start 2>&1
  ) &
  WEB_PID=$!
  PIDS[web]=$WEB_PID
  log INFO "Web pid=${WEB_PID}  — waiting for /api/healthz…"

  if wait_for_url "$WEB_HEALTH_URL" "$STARTUP_TIMEOUT"; then
    log INFO "Web healthy — ${WEB_HEALTH_URL} responded."
    return 0
  else
    log ERROR "Web failed to become healthy within ${STARTUP_TIMEOUT}s."
    return 1
  fi
}

restart_service() {
  local svc="$1"
  local count="${RESTART_COUNT[$svc]:-0}"
  count=$((count + 1))
  RESTART_COUNT[$svc]=$count

  if [ "$count" -gt "$MAX_RESTARTS" ]; then
    log ERROR "${svc} has crashed ${count} times — MAX_RESTARTS (${MAX_RESTARTS}) exceeded. Aborting launch."
    return 1
  fi

  local backoff=$((RESTART_BACKOFF_BASE * (1 << (count - 1))))
  [ "$backoff" -gt 60 ] && backoff=60
  log WARN "${svc} crashed (exit=${LAST_EXIT[$svc]:-?}). Restarting in ${backoff}s (attempt ${count}/${MAX_RESTARTS})…"
  sleep "$backoff"

  if [ "$svc" = "api" ]; then
    # Kill old API process if still lingering
    if [ -n "$API_PID" ] && kill -0 "$API_PID" 2>/dev/null; then
      kill_tree "$API_PID"
    fi
    if start_api; then
      log INFO "API restarted successfully."
      return 0
    else
      return 1
    fi
  else
    if [ -n "$WEB_PID" ] && kill -0 "$WEB_PID" 2>/dev/null; then
      kill_tree "$WEB_PID"
    fi
    if start_web; then
      log INFO "Web restarted successfully."
      return 0
    else
      return 1
    fi
  fi
}

# ─── 5. Boot sequence ────────────────────────────────────────────────────────
if ! start_api; then
  log ERROR "API failed to start on first attempt. Aborting."
  exit 1
fi

# Brief pause to let API fully settle before web starts
sleep 2

if ! start_web; then
  log ERROR "Web failed to start on first attempt. Aborting."
  kill_tree "$API_PID"
  exit 1
fi

log BOOT "═══════════════════════════════════════════════════════"
log BOOT "  All services UP — entering health-monitoring loop"
log BOOT "═══════════════════════════════════════════════════════"

# ─── 6. Health-monitoring loop ───────────────────────────────────────────────
CONSECUTIVE_API_FAILURES=0
CONSECUTIVE_WEB_FAILURES=0
MAX_CONSECUTIVE_FAILURES=3

while true; do
  sleep "$HEALTH_CHECK_INTERVAL"

  # Check API
  API_HEALTH_OK=0
  if [ -n "$API_PID" ] && kill -0 "$API_PID" 2>/dev/null; then
    if curl -sf --max-time "$HEALTH_CHECK_TIMEOUT" "$API_HEALTH_URL" >/dev/null 2>&1; then
      API_HEALTH_OK=1
      CONSECUTIVE_API_FAILURES=0
    else
      CONSECUTIVE_API_FAILURES=$((CONSECUTIVE_API_FAILURES + 1))
      log HEALTH "API /readyz failed (${CONSECUTIVE_API_FAILURES}/${MAX_CONSECUTIVE_FAILURES})"
    fi
  else
    CONSECUTIVE_API_FAILURES=$((CONSECUTIVE_API_FAILURES + 1))
    log HEALTH "API process not running (${CONSECUTIVE_API_FAILURES}/${MAX_CONSECUTIVE_FAILURES})"
  fi

  # Check Web
  WEB_HEALTH_OK=0
  if [ -n "$WEB_PID" ] && kill -0 "$WEB_PID" 2>/dev/null; then
    if curl -sf --max-time "$HEALTH_CHECK_TIMEOUT" "$WEB_HEALTH_URL" >/dev/null 2>&1; then
      WEB_HEALTH_OK=1
      CONSECUTIVE_WEB_FAILURES=0
    else
      CONSECUTIVE_WEB_FAILURES=$((CONSECUTIVE_WEB_FAILURES + 1))
      log HEALTH "Web /api/healthz failed (${CONSECUTIVE_WEB_FAILURES}/${MAX_CONSECUTIVE_FAILURES})"
    fi
  else
    CONSECUTIVE_WEB_FAILURES=$((CONSECUTIVE_WEB_FAILURES + 1))
    log HEALTH "Web process not running (${CONSECUTIVE_WEB_FAILURES}/${MAX_CONSECUTIVE_FAILURES})"
  fi

  # Decide action
  if [ "$API_HEALTH_OK" -eq 0 ] && [ "$CONSECUTIVE_API_FAILURES" -ge "$MAX_CONSECUTIVE_FAILURES" ]; then
    log ERROR "API deemed unhealthy after ${MAX_CONSECUTIVE_FAILURES} consecutive failures."
    LAST_EXIT[api]="health_timeout"
    if ! restart_service api; then
      log ERROR "API restart failed — aborting launch."
      kill_tree "$WEB_PID"
      exit 1
    fi
    CONSECUTIVE_API_FAILURES=0
  fi

  if [ "$WEB_HEALTH_OK" -eq 0 ] && [ "$CONSECUTIVE_WEB_FAILURES" -ge "$MAX_CONSECUTIVE_FAILURES" ]; then
    log ERROR "Web deemed unhealthy after ${MAX_CONSECUTIVE_FAILURES} consecutive failures."
    LAST_EXIT[web]="health_timeout"
    if ! restart_service web; then
      log ERROR "Web restart failed — aborting launch."
      kill_tree "$API_PID"
      exit 1
    fi
    CONSECUTIVE_WEB_FAILURES=0
  fi
done
