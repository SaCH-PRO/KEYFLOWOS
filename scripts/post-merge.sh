#!/bin/bash
set -e

echo "=== Post-merge setup ==="

echo "[1/3] Installing dependencies..."
pnpm install --frozen-lockfile 2>/dev/null || pnpm install

echo "[2/3] Generating Prisma client..."
cd packages/db
npx prisma generate --schema=./prisma/schema.prisma
cd ../..

echo "[3/3] Syncing database schema..."
cd packages/db
npx prisma db push --schema=./prisma/schema.prisma --skip-generate || echo "Schema push skipped or failed (non-fatal)"
cd ../..

echo "=== Post-merge setup complete ==="
