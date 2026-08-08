#!/usr/bin/env bash
#
# Production deploy for the single-VPS Docker Compose stack.
#
# WHY THIS FILE EXISTS
#
# On 2026-08-08 production was 221 commits and 11 days behind main, carrying a
# cross-tenant write that had been proven exploitable against the live server.
# It had not been deployed because nobody could remember how. Every fact below
# was rediscovered that night, the hard way, one failed command at a time:
#
#   * `--env-file .env.production` is LOAD-BEARING. The compose file uses
#     `env_file:` for runtime environment, but that does NOT feed ${VAR}
#     interpolation at parse time, which is where build args come from. Without
#     the flag every NEXT_PUBLIC_* build arg is empty and `next build` dies on
#     env validation — after several minutes of compiling.
#   * The box is a SINGLE-BRANCH clone. A bare `git fetch` will not see a new
#     branch; it must be fetched by name.
#   * `git reset --hard` destroys uncommitted local config. infrastructure/
#     livekit.production.yaml was modified only on the box and was lost this way.
#   * The server's tsc needs ~3.5GB. The box has 7.6GB total and no swap by
#     default; 4GB of swap was added to make the build survivable.
#
# Anything you learn the next time this hurts belongs here, not in your memory.
#
# Usage:   scripts/deploy.sh [git-ref]
#          scripts/deploy.sh                 # deploy current checkout
#          scripts/deploy.sh main            # fetch and deploy main
#
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

COMPOSE_FILE="docker-compose.production.yml"
ENV_FILE=".env.production"
SERVICES="api web"
REF="${1:-}"

say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[31mFAILED: %s\033[0m\n' "$*" >&2; exit 1; }

# --- preflight ---------------------------------------------------------------
say "Preflight"
[ -f "$COMPOSE_FILE" ] || die "$COMPOSE_FILE not found (run from the project root)"
[ -f "$ENV_FILE" ]     || die "$ENV_FILE not found — the build cannot resolve NEXT_PUBLIC_* args without it"
command -v docker >/dev/null || die "docker not found"

# Uncommitted config on this box exists nowhere else. Refuse to clobber it.
DIRTY="$(git status --porcelain 2>/dev/null | grep -vE '^\?\?' || true)"
if [ -n "$DIRTY" ] && [ -n "$REF" ]; then
  printf '%s\n' "$DIRTY"
  die "tracked files are modified locally and a ref was given.
     Committing or backing these up first is not optional — these edits exist
     ONLY on this machine, and checking out a ref will discard them."
fi

# Swap: the server build OOMs without it on a 7.6GB box.
if [ "$(free -m | awk '/^Swap:/ {print $2}')" -lt 2048 ]; then
  printf 'WARNING: less than 2GB swap. The server tsc build needs ~3.5GB and may be OOM-killed.\n'
  printf '         fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile\n'
fi

# --- checkout ----------------------------------------------------------------
if [ -n "$REF" ]; then
  say "Fetching $REF"
  # By name: this is a single-branch clone, so a bare fetch will not find it.
  git fetch origin "$REF" || die "could not fetch $REF"
  git checkout -B "$REF" FETCH_HEAD || die "could not check out $REF"
fi

GIT_COMMIT="$(git rev-parse HEAD)"
export GIT_COMMIT
say "Deploying ${GIT_COMMIT:0:12} — $(git log -1 --format=%s)"

# --- backup ------------------------------------------------------------------
say "Backing up the database"
STAMP="$(date +%F-%H%M%S)"
BACKUP="/root/keyflow-backup-${STAMP}.sql"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T db \
  sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' > "$BACKUP" \
  || die "pg_dump failed — refusing to deploy without a backup"
TABLES="$(grep -c '^CREATE TABLE' "$BACKUP" || true)"
[ "$TABLES" -gt 100 ] || die "backup has only $TABLES CREATE TABLE statements — it is not a real dump"
printf '    %s (%s tables, %s)\n' "$BACKUP" "$TABLES" "$(du -h "$BACKUP" | cut -f1)"

# --- rollback tags -----------------------------------------------------------
# Tag what is RUNNING before the build steals the :latest tag from it.
say "Tagging the current images for rollback"
for svc in $SERVICES; do
  cid="$(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps -q "$svc" 2>/dev/null || true)"
  if [ -n "$cid" ]; then
    img="$(docker inspect "$cid" --format '{{.Image}}')"
    docker tag "$img" "keyflowos-${svc}:rollback"
    printf '    keyflowos-%s:rollback -> %s\n' "$svc" "${img:7:12}"
  fi
done

# --- build -------------------------------------------------------------------
say "Building ($SERVICES)"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" build $SERVICES \
  || die "build failed — NOTHING was deployed, the old containers are still serving"

# --- migrate -----------------------------------------------------------------
# Schema BEFORE traffic. Shipping code against a database that cannot serve it
# is the one failure this ordering exists to prevent.
if [ -d packages/db/prisma/migrations ] && [ -n "$(ls -A packages/db/prisma/migrations 2>/dev/null)" ]; then
  say "Applying migrations"
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" run --rm -T api \
    pnpm --filter @keyflow/db exec prisma migrate deploy \
    || die "migrate deploy failed — NOTHING was deployed. Restore: psql < $BACKUP"
fi

# --- deploy ------------------------------------------------------------------
say "Starting new containers"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d $SERVICES

# --- verify ------------------------------------------------------------------
say "Verifying"
sleep 8
HEALTH="$(curl -fsS --max-time 20 https://keyflowos.com/api/healthz || true)"
printf '    %s\n' "$HEALTH"

RUNNING="$(printf '%s' "$HEALTH" | sed -n 's/.*"commit":"\([^"]*\)".*/\1/p')"
if [ "$RUNNING" = "${GIT_COMMIT:0:12}" ]; then
  printf '\n\033[32mDEPLOYED — /healthz reports %s, which is what we just built.\033[0m\n' "$RUNNING"
else
  printf '\n\033[31mMISMATCH — /healthz reports "%s", expected "%s".\033[0m\n' "$RUNNING" "${GIT_COMMIT:0:12}"
  printf 'The containers may not have picked up the new image. Roll back with:\n'
  printf '  docker tag keyflowos-api:rollback keyflowos-api:latest\n'
  printf '  docker tag keyflowos-web:rollback keyflowos-web:latest\n'
  printf '  docker compose --env-file %s -f %s up -d %s\n' "$ENV_FILE" "$COMPOSE_FILE" "$SERVICES"
  exit 1
fi

cat <<EOF

Rollback, if something surfaces later:
  docker tag keyflowos-api:rollback keyflowos-api:latest
  docker tag keyflowos-web:rollback keyflowos-web:latest
  docker compose --env-file $ENV_FILE -f $COMPOSE_FILE up -d $SERVICES

Database restore (only if a migration went wrong):
  docker compose --env-file $ENV_FILE -f $COMPOSE_FILE exec -T db \\
    sh -c 'psql -U "\$POSTGRES_USER" "\$POSTGRES_DB"' < $BACKUP
EOF
