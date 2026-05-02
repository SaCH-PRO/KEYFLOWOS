#!/usr/bin/env bash
# Production foreground supervisor for the autoscale deployment.
#
# Starts the API (NestJS via tsx) and the web app (Next.js) as child
# processes, wires SIGTERM/SIGINT through to both, and exits non-zero
# the moment either child dies. This way the platform health check
# correctly observes a crash and re-rolls the deployment, instead of
# leaving a half-broken stack running because one process is still up.
#
# We intentionally use `tsx src/main.ts` for the server (matching dev)
# because the server's workspace deps (`@keyflow/db`, `@keyflow/api`)
# export TypeScript source — `node dist/...` cannot resolve them.
# See AUDIT_REPORT.md §9.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

LOG_PREFIX_API="[server]"
LOG_PREFIX_WEB="[web]   "

API_PORT="${PORT:-3001}"
WEB_PORT="${WEB_PORT:-5000}"

# --- resolve the release version (git SHA) and export it to children ---------
# Order of precedence:
#   1. GIT_COMMIT already set in the env (CI / platform override)
#   2. .deploy-version file written by the build step (see .replit)
#   3. live `git rev-parse HEAD` (only works when .git is present)
#   4. "unknown" (last resort — health endpoints will surface this)
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
echo "[start-prod] release version GIT_COMMIT=${GIT_COMMIT:0:12}"

# --- start the API in the background, prefixed-line logged --------------------
(
  cd apps/server
  exec pnpm exec tsx src/main.ts 2>&1 | sed -u "s/^/${LOG_PREFIX_API} /"
) &
API_PID=$!

# --- start the web app in the background, prefixed-line logged ----------------
(
  cd apps/web
  exec pnpm start 2>&1 | sed -u "s/^/${LOG_PREFIX_WEB} /"
) &
WEB_PID=$!

echo "[start-prod] api pid=${API_PID} on :${API_PORT}, web pid=${WEB_PID} on :${WEB_PORT}"

shutdown() {
  echo "[start-prod] received signal, propagating to children…"
  trap - TERM INT
  # Send SIGTERM to the entire process groups (best-effort).
  kill -TERM "$API_PID" "$WEB_PID" 2>/dev/null || true
  wait "$API_PID" 2>/dev/null || true
  wait "$WEB_PID" 2>/dev/null || true
  exit 0
}

trap shutdown TERM INT

# Wait for whichever child exits first. If either dies, we exit non-zero
# so the platform restarts the deploy instead of running half-broken.
set +e
wait -n "$API_PID" "$WEB_PID"
EXIT_CODE=$?
set -e

if kill -0 "$API_PID" 2>/dev/null; then
  echo "[start-prod] web app exited (${EXIT_CODE}); shutting down API…"
  kill -TERM "$API_PID" 2>/dev/null || true
  wait "$API_PID" 2>/dev/null || true
fi
if kill -0 "$WEB_PID" 2>/dev/null; then
  echo "[start-prod] API exited (${EXIT_CODE}); shutting down web app…"
  kill -TERM "$WEB_PID" 2>/dev/null || true
  wait "$WEB_PID" 2>/dev/null || true
fi

echo "[start-prod] one child died (exit=${EXIT_CODE}); exiting non-zero so the deploy can roll back."
exit "${EXIT_CODE:-1}"
