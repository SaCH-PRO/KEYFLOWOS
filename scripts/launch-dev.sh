#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║           KEYFLOWOS Dev Launcher                             ║"
echo "╚══════════════════════════════════════════════════════════════╝"

# ─── 1. Fatal env guard ───
if [ "${KEYFLOW_DEV_AUTH_BYPASS:-}" = "true" ] || [ "${KEYFLOW_DEV_AUTH_BYPASS:-}" = "1" ]; then
  echo "❌ KEYFLOW_DEV_AUTH_BYPASS is set. Unsetting..."
  unset KEYFLOW_DEV_AUTH_BYPASS
fi

# ─── 2. Port cleanup ───
for port in 3001 5000; do
  pid=$(lsof -ti :$port 2>/dev/null || netstat -ano 2>/dev/null | grep ":$port" | grep LISTENING | awk '{print $5}' | head -1 || true)
  if [ -n "$pid" ] && [ "$pid" != "" ]; then
    echo "🧹 Killing stale process on port $port (PID: $pid)..."
    kill -9 "$pid" 2>/dev/null || taskkill //F //PID "$pid" 2>/dev/null || true
  fi
done

# ─── 3. DB readiness ───
echo "🔌 Checking PostgreSQL..."
if ! npx prisma db execute --stdin <<<'SELECT 1' >/dev/null 2>&1; then
  echo "⚠️  Database not reachable. Ensure PostgreSQL is running and DATABASE_URL is set."
  echo "   Continuing anyway — NestJS will retry on its own."
fi

# ─── 4. Build clean? ───
echo "🔨 Type-checking server..."
cd apps/server
pnpm build >/dev/null 2>&1 || {
  echo "❌ Server build failed — fix TypeScript errors before launching."
  exit 1
}
cd ../..

# ─── 5. Launch ───
echo "🚀 Starting dev servers (API:3001 + Web:5000)..."
echo "   Press Ctrl+C to stop both."
echo ""
pnpm dev
