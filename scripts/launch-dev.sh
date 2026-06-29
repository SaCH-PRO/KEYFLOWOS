#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

# ═══════════════════════════════════════════════════════════════════════════════
# KEYFLOWOS Dev Launcher — starts API (NestJS) + Web (Next.js) locally.
# Ports: API 3001, Web 5000
# ═══════════════════════════════════════════════════════════════════════════════

# ── env guard ──────────────────────────────────────────────────────────────────
if [ "${KEYFLOW_DEV_AUTH_BYPASS:-}" = "true" ] || [ "${KEYFLOW_DEV_AUTH_BYPASS:-}" = "1" ]; then
  echo "❌ KEYFLOW_DEV_AUTH_BYPASS is set. Unsetting..."
  unset KEYFLOW_DEV_AUTH_BYPASS
fi

# Clear any inherited OpenAI keys so the values in .env always take precedence.
unset AI_INTEGRATIONS_OPENAI_API_KEY OPENAI_API_KEY 2>/dev/null || true

# ── port cleanup ───────────────────────────────────────────────────────────────
echo "🧹 Cleaning up stale ports..."
for port in 3001 5000; do
  pid=$(lsof -ti :$port 2>/dev/null || netstat -ano 2>/dev/null | grep ":$port" | grep LISTENING | awk '{print $5}' | head -1 || true)
  if [ -n "${pid:-}" ] && [ "$pid" != "" ]; then
    kill -9 "$pid" 2>/dev/null || taskkill //F //PID "$pid" 2>/dev/null || true
  fi
done

# ── clear stale caches ─────────────────────────────────────────────────────────
echo "🧹 Clearing stale dev caches..."
# We used to wipe the whole apps/web/.next folder, but Next.js 16 + Turbopack
# can fail to cold-start after a full wipe (missing routes-manifest.json /
# middleware-manifest.json + SST compaction errors).  Deleting only the
# Turbopack-specific layers keeps webpack dev fast and stable.
rm -rf .turbo/cache \
       apps/web/.next/dev \
       apps/web/.next/cache/turbopack \
       apps/web/.next/cache/webpack 2>/dev/null || true
mkdir -p apps/web/.next/cache/webpack

# ── DB readiness (best-effort) ─────────────────────────────────────────────────
echo "🔌 Checking PostgreSQL..."
if ! npx prisma db execute --schema packages/db/prisma/schema.prisma --stdin <<<'SELECT 1' >/dev/null 2>&1; then
  echo "⚠️  Database not reachable. Ensure PostgreSQL is running and DATABASE_URL is set."
  echo "   Continuing anyway — NestJS will retry on its own."
fi

# ── workspace package build check ──────────────────────────────────────────────
echo "🔨 Building workspace packages..."
(
  pnpm --filter @keyflow/shared build >/dev/null 2>&1 &&
  pnpm --filter @keyflow/db build >/dev/null 2>&1 &&
  pnpm --filter @keyflow/api build >/dev/null 2>&1
) || { echo "❌ Workspace package build failed"; exit 1; }

# ── server build check ─────────────────────────────────────────────────────────
echo "🔨 Type-checking and compiling server..."
(
  cd apps/server
  pnpm build >/dev/null 2>&1
) || { echo "❌ Server build failed"; exit 1; }

# ── launch both servers ────────────────────────────────────────────────────────
echo "🚀 Starting dev servers (API:3001 + Web:5000)..."
echo "   Press Ctrl+C to stop both."

cd apps/server
# Run the compiled server directly. tsx does not preserve emitDecoratorMetadata,
# so NestJS type-injection fails under tsx; the compiled output is reliable.
node dist/main.js &
SERVER_PID=$!
cd ../..

cd apps/web
# --webpack avoids the recurring Turbopack persistent-cache cold-start crash
# ("Persisting failed: Unable to write SST file" / missing manifest errors).
pnpm dev --webpack &
WEB_PID=$!
cd ../..

cleanup() {
  echo
  echo "🛑 Shutting down dev servers..."
  kill "$SERVER_PID" "$WEB_PID" 2>/dev/null || true
  wait "$SERVER_PID" 2>/dev/null || true
  wait "$WEB_PID" 2>/dev/null || true
  exit 0
}
trap cleanup INT TERM EXIT

# ── wait for readiness ─────────────────────────────────────────────────────────
echo "⏳ Waiting for API to be ready on http://localhost:3001/healthz ..."
for _ in $(seq 1 60); do
  if curl -sf http://localhost:3001/healthz >/dev/null 2>&1; then
    echo "✅ API ready"
    break
  fi
  sleep 1
done

echo "⏳ Waiting for Web to be ready on http://localhost:5000/auth/login ..."
for _ in $(seq 1 240); do
  code=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:5000/auth/login 2>/dev/null || echo '000')
  if [ "$code" = "200" ]; then
    echo "✅ Web ready (webpack dev)"
    break
  fi
  sleep 1
done

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  KEYFLOWOS dev stack is up:"
echo "    API  → http://localhost:3001"
echo "    Web  → http://localhost:5000"
echo "═══════════════════════════════════════════════════════════════"
echo ""

# Keep the script alive until one of the servers exits or the user hits Ctrl+C.
wait -n "$SERVER_PID" "$WEB_PID"
