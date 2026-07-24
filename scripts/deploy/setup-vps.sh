#!/usr/bin/env bash
###############################################################################
# KEYFLOWOS — one-shot VPS provisioning (Ubuntu 22.04/24.04, run as root).
#
#   curl -fsSL https://raw.githubusercontent.com/SaCH-PRO/KEYFLOWOS/main/scripts/deploy/setup-vps.sh | bash
#
# Or after cloning the repo on the VPS:
#   bash scripts/deploy/setup-vps.sh
#
# What it does:
#   1. Installs Docker + compose plugin
#   2. Clones/updates the repo into /opt/keyflowos
#   3. Generates .env.production with random secrets (edit afterwards)
#   4. Renders the LiveKit production config with generated keys
#   5. Runs Prisma migrations against the production DB
#   6. Boots the full stack with Caddy auto-HTTPS
###############################################################################
set -euo pipefail

REPO_URL="https://github.com/SaCH-PRO/KEYFLOWOS.git"
APP_DIR="/opt/keyflowos"
BRANCH="${KEYFLOW_BRANCH:-main}"

echo "═══ KEYFLOWOS VPS setup ═══"

# ── 1. Docker ────────────────────────────────────────────────────────────────
if ! command -v docker >/dev/null 2>&1; then
  echo "→ Installing Docker..."
  curl -fsSL https://get.docker.com | sh
fi
docker compose version >/dev/null 2>&1 || { echo "❌ docker compose plugin missing"; exit 1; }

# ── 2. Repo ──────────────────────────────────────────────────────────────────
if [ ! -d "$APP_DIR/.git" ]; then
  echo "→ Cloning $REPO_URL ($BRANCH)..."
  git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
else
  echo "→ Updating repo..."
  git -C "$APP_DIR" fetch origin "$BRANCH" --depth 1
  git -C "$APP_DIR" reset --hard "origin/$BRANCH"
fi
cd "$APP_DIR"

# ── 3. .env.production ───────────────────────────────────────────────────────
if [ ! -f .env.production ]; then
  echo "→ Generating .env.production with random secrets..."
  cp infrastructure/production.env.template .env.production
  rand() { openssl rand -hex "${1:-32}"; }
  sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(rand 16)|" .env.production
  sed -i "s|^ADMIN_JWT_SECRET=.*|ADMIN_JWT_SECRET=$(rand 32)|" .env.production
  sed -i "s|^BYOK_ENCRYPTION_SECRET=.*|BYOK_ENCRYPTION_SECRET=$(rand 32)|" .env.production
  sed -i "s|^MINIO_ROOT_PASSWORD=.*|MINIO_ROOT_PASSWORD=$(rand 16)|" .env.production
  sed -i "s|^CHATWOOT_SECRET_KEY_BASE=.*|CHATWOOT_SECRET_KEY_BASE=$(rand 64)${CHATWOOT_SECRET_KEY_BASE:-}|" .env.production
  sed -i "s|^LIVEKIT_API_KEY=.*|LIVEKIT_API_KEY=prod$(rand 8)|" .env.production
  sed -i "s|^LIVEKIT_API_SECRET=.*|LIVEKIT_API_SECRET=$(rand 24)|" .env.production
  sed -i "s|^GOOGLE_STATE_SECRET=.*|GOOGLE_STATE_SECRET=$(rand 16)|" .env.production
  echo "  ⚠️  EDIT .env.production — fill in Supabase, OpenAI, Google, Meta, WhatsApp values."
fi

# ── 4. LiveKit config with generated keys ────────────────────────────────────
echo "→ Rendering LiveKit production config..."
LK_KEY=$(grep '^LIVEKIT_API_KEY=' .env.production | cut -d= -f2-)
LK_SECRET=$(grep '^LIVEKIT_API_SECRET=' .env.production | cut -d= -f2-)
sed -e "s|\${LIVEKIT_API_KEY}|$LK_KEY|" -e "s|\${LIVEKIT_API_SECRET}|$LK_SECRET|" \
    infrastructure/livekit.production.yaml > infrastructure/livekit.production.rendered.yaml
mv infrastructure/livekit.production.rendered.yaml infrastructure/livekit.production.yaml

# ── 5. Firewall hint ─────────────────────────────────────────────────────────
echo "→ Required open ports: 80, 443, 7881/tcp, 7882/udp"
if command -v ufw >/dev/null 2>&1; then
  ufw allow 80,443/tcp >/dev/null 2>&1 || true
  ufw allow 7881/tcp >/dev/null 2>&1 || true
  ufw allow 7882/udp >/dev/null 2>&1 || true
fi

# ── 6. Build + boot ──────────────────────────────────────────────────────────
echo "→ Building images (first build takes a while)..."
docker compose --env-file .env.production -f docker-compose.production.yml build

echo "→ Starting infra for migrations..."
docker compose --env-file .env.production -f docker-compose.production.yml up -d db redis
sleep 10

echo "→ Running Prisma migrations..."
docker compose --env-file .env.production -f docker-compose.production.yml run --rm api \
  npx prisma migrate deploy --schema packages/db/prisma/schema.prisma

echo "→ Booting the full stack..."
docker compose --env-file .env.production -f docker-compose.production.yml up -d

echo ""
echo "═══ Done ═══"
echo "  Web:  https://$(grep '^DOMAIN=' .env.production | cut -d= -f2)"
echo "  API:  https://$(grep '^API_DOMAIN=' .env.production | cut -d= -f2)/healthz"
echo ""
echo "  Next: edit .env.production with your Supabase/OpenAI/Google/Meta values,"
echo "  then: docker compose --env-file .env.production -f docker-compose.production.yml restart api web voice-agent"
