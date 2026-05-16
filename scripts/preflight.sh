#!/usr/bin/env bash
# KeyflowOS Pre-Flight Launch Readiness Checker
#
# Validates every prerequisite before the app attempts to boot.
# Exits 0 if ready, exits 1 with a detailed failure report if not.
#
# Usage:
#   scripts/preflight.sh              # local dev check
#   STRICT=1 scripts/preflight.sh     # also warn about optional config

set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "═══════════════════════════════════════════════════════════════"
echo "  KeyflowOS Pre-Flight Readiness Check"
echo "═══════════════════════════════════════════════════════════════"
echo ""

PASS=0
WARN=0
FAIL=0
CHECKS=()

pass() {
  PASS=$((PASS + 1))
  CHECKS+=("  ✅  $1")
}

warn() {
  WARN=$((WARN + 1))
  CHECKS+=("  ⚠️   $1")
}

fail() {
  FAIL=$((FAIL + 1))
  CHECKS+=("  ❌  $1")
}

# ─── 1. Node.js ───────────────────────────────────────────────────────────
if command -v node >/dev/null 2>&1; then
  NODE_V=$(node --version 2>/dev/null)
  NODE_MAJOR=$(echo "$NODE_V" | sed 's/v//;s/\..*//')
  if [ "$NODE_MAJOR" -ge 20 ] 2>/dev/null; then
    pass "Node.js $NODE_V (≥20 required)"
  else
    fail "Node.js $NODE_V (≥20 required)"
  fi
else
  fail "Node.js not found in PATH"
fi

# ─── 2. pnpm ──────────────────────────────────────────────────────────────
if command -v pnpm >/dev/null 2>&1; then
  pass "pnpm $(pnpm --version 2>/dev/null)"
else
  fail "pnpm not found in PATH"
fi

# ─── 3. PostgreSQL ────────────────────────────────────────────────────────
DB_PORT=5432
if command -v pg_isready >/dev/null 2>&1; then
  if pg_isready -q -h localhost -p "$DB_PORT" 2>/dev/null; then
    pass "PostgreSQL responding on :$DB_PORT"
  else
    if command -v docker >/dev/null 2>&1; then
      if docker ps --format '{{.Names}}' 2>/dev/null | grep -q 'postgres\|keyflow-postgres'; then
        warn "PostgreSQL container exists but not ready on :$DB_PORT yet"
      else
        fail "PostgreSQL not running on :$DB_PORT (no container found)"
      fi
    else
      fail "PostgreSQL not running on :$DB_PORT"
    fi
  fi
else
  # Fallback: netstat check
  if netstat -ano 2>/dev/null | grep ":$DB_PORT" | grep -q LISTENING; then
    pass "PostgreSQL listening on :$DB_PORT"
  else
    fail "PostgreSQL not listening on :$DB_PORT"
  fi
fi

# ─── 4. Port availability ─────────────────────────────────────────────────
for PORT in 3001 5000; do
  if netstat -ano 2>/dev/null | grep ":$PORT " | grep -q LISTENING; then
    warn "Port $PORT already in use (will try to use it anyway)"
  else
    pass "Port $PORT is free"
  fi
done

# ─── 5. .env exists ───────────────────────────────────────────────────────
if [ -f "$ROOT_DIR/.env" ]; then
  pass ".env file exists"
else
  fail ".env file missing (cp .env.example .env and configure)"
fi

# ─── 6. Required env vars ─────────────────────────────────────────────────
REQUIRED_VARS=(
  "DATABASE_URL:postgresql"
  "DIRECT_URL:postgresql"
)
OPTIONAL_BUT_RECOMMENDED=(
  "SUPABASE_SERVICE_ROLE_KEY"
  "SUPABASE_JWT_SECRET"
  "STRIPE_SECRET_KEY"
  "STRIPE_WEBHOOK_SECRET"
  "S3_BUCKET"
)

for item in "${REQUIRED_VARS[@]}"; do
  VAR="${item%%:*}"
  PATTERN="${item##*:}"
  VAL=$(grep -E "^${VAR}=" "$ROOT_DIR/.env" 2>/dev/null | head -1 | cut -d= -f2- || true)
  if [ -n "$VAL" ] && echo "$VAL" | grep -q "$PATTERN"; then
    pass "$VAR is set"
  else
    fail "$VAR is missing or invalid"
  fi
done

# ─── 7. Check for placeholder values ──────────────────────────────────────
if grep -q 'your-project.supabase.co\|your-supabase-anon-key\|your-supabase-' "$ROOT_DIR/.env" 2>/dev/null; then
  warn "Supabase placeholders still in .env (auth will show 'server_misconfigured')"
else
  pass "No Supabase placeholders detected"
fi

if grep -q 'your-stripe\|sk_test_placeholder\|sk_live_placeholder' "$ROOT_DIR/.env" 2>/dev/null; then
  warn "Stripe placeholders still in .env (payments won't process)"
else
  pass "No Stripe placeholders detected"
fi

# ─── 8. Database connectivity ─────────────────────────────────────────────
if [ -f "$ROOT_DIR/.env" ]; then
  DB_URL=$(grep -E '^DATABASE_URL=' "$ROOT_DIR/.env" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' || true)
  if [ -n "$DB_URL" ]; then
    # Extract DB name
    DB_NAME=$(echo "$DB_URL" | sed 's/.*\/\([^?]*\).*/\1/')
    if command -v psql >/dev/null 2>&1; then
      DB_USER=$(echo "$DB_URL" | sed 's/.*:\/\/\([^:]*\):.*/\1/')
      if psql "$DB_URL" -c 'SELECT 1' >/dev/null 2>&1; then
        pass "Database '$DB_NAME' is reachable"
      else
        fail "Database '$DB_NAME' is NOT reachable (check credentials/container)"
      fi
    else
      warn "psql not available — cannot verify DB connectivity"
    fi
  fi
fi

# ─── 9. Prisma schema vs DB ───────────────────────────────────────────────
if [ -f "$ROOT_DIR/packages/db/prisma/schema.prisma" ]; then
  if [ -f "$ROOT_DIR/node_modules/.pnpm/@prisma+client@*/node_modules/@prisma/client/schema.prisma" 2>/dev/null ] || \
     [ -d "$ROOT_DIR/node_modules/@prisma/client" ] 2>/dev/null; then
    pass "Prisma client appears generated"
  else
    warn "Prisma client may need regeneration (run: pnpm db:generate)"
  fi
else
  fail "Prisma schema not found"
fi

# ─── 10. Disk space ───────────────────────────────────────────────────────
if command -v df >/dev/null 2>&1; then
  AVAIL_GB=$(df -BG "$ROOT_DIR" 2>/dev/null | tail -1 | awk '{print $4}' | tr -d 'G')
  if [ "${AVAIL_GB:-0}" -ge 1 ] 2>/dev/null; then
    pass "Disk space: ${AVAIL_GB}GB available"
  else
    warn "Low disk space: ${AVAIL_GB}GB available"
  fi
fi

# ─── 11. Optional but recommended ─────────────────────────────────────────
if [ "${STRICT:-0}" = "1" ]; then
  for VAR in "${OPTIONAL_BUT_RECOMMENDED[@]}"; do
    VAL=$(grep -E "^${VAR}=" "$ROOT_DIR/.env" 2>/dev/null | head -1 | cut -d= -f2- || true)
    if [ -n "$VAL" ]; then
      pass "$VAR is set (strict mode)"
    else
      warn "$VAR is not set (strict mode)"
    fi
  done
fi

# ─── Report ───────────────────────────────────────────────────────────────
echo ""
echo "───────────────────────────────────────────────────────────────"
echo "  Results:  $PASS passed  |  $WARN warnings  |  $FAIL failures"
echo "───────────────────────────────────────────────────────────────"
echo ""

for c in "${CHECKS[@]}"; do
  echo "$c"
done

echo ""

if [ "$FAIL" -gt 0 ]; then
  echo "❌  LAUNCH BLOCKED — fix $FAIL failure(s) before starting."
  exit 1
elif [ "$WARN" -gt 0 ]; then
  echo "⚠️   LAUNCHABLE WITH WARNINGS — $WARN item(s) may cause issues."
  echo "    Set STRICT=1 for full audit."
  exit 0
else
  echo "✅  ALL CHECKS PASSED — ready to launch."
  exit 0
fi
