#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "[verify-update] Running frontend check (web lint)..."
pnpm --filter web lint

echo "[verify-update] Running backend check (server build)..."
pnpm --filter server build

echo "[verify-update] Running backend smoke tests..."
pnpm --filter server exec vitest run \
  test/commerce.service.test.ts \
  test/social.service.test.ts \
  test/identity.service.test.ts

echo "[verify-update] All checks passed."
