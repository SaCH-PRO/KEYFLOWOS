#!/usr/bin/env bash
# Local test services for a Claude Code cloud session (or any Ubuntu 24.04
# container without Docker): the same resources CI's service containers give
# the server suites, on localhost only.
#
#   bash scripts/dev/claude-cloud-env.sh up       start everything, idempotent
#   bash scripts/dev/claude-cloud-env.sh verify   check it, change nothing (exit 1 on a gap)
#
# `up`, in order:
#   node      the exact Node of .nvmrc (owner ruling D-21) under /opt/node-<v>,
#             downloaded from nodejs.org and checked against SHASUMS256.txt;
#             put it first on PATH yourself: export PATH=/opt/node-<v>/bin:$PATH
#   postgres  Postgres 16 with pgvector (apt postgresql-16-pgvector), started,
#             loopback connections trusted (as CI's POSTGRES_HOST_AUTH_METHOD:
#             trust; no password literal anywhere), role keyflow, database
#             keyflowos built with the ICU collation CI uses (V1 handoff §5),
#             the vector extension in template1 and keyflowos
#   redis     redis-server on 127.0.0.1:6379
#   env       the repo-root .env (git-ignored) naming only those local services
#   deps      pnpm install --frozen-lockfile
#
# Then the repository's own one-command run takes over:
#   pnpm test:local -- --no-compose          (scripts/test-local.sh)
#
# It never touches a remote database, provider or credential. Every URL it
# writes names localhost, so scripts/proof-admission/admit-resources.mjs admits it.
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)
NODE_PIN=$(tr -d '[:space:]' < "$ROOT/.nvmrc")
NODE_DIR="/opt/node-$NODE_PIN"
PG_HBA=/etc/postgresql/16/main/pg_hba.conf
DB_URL='postgresql://keyflow@localhost:5432/keyflowos?schema=public'
REDIS_URL='redis://127.0.0.1:6379'

log() { echo "claude-cloud-env: $*"; }
as_root() { if [[ $(id -u) -eq 0 ]]; then "$@"; else sudo "$@"; fi; }

up_node() {
  if [[ -x "$NODE_DIR/bin/node" ]]; then log "node $NODE_PIN present"; return; fi
  local tmp; tmp=$(mktemp -d)
  local tarball="node-v$NODE_PIN-linux-x64.tar.xz"
  curl -fsSL -o "$tmp/$tarball" "https://nodejs.org/dist/v$NODE_PIN/$tarball"
  (cd "$tmp" && curl -fsSL "https://nodejs.org/dist/v$NODE_PIN/SHASUMS256.txt" | grep " $tarball\$" | sha256sum -c -)
  as_root mkdir -p "$NODE_DIR"
  as_root tar -xJf "$tmp/$tarball" -C "$NODE_DIR" --strip-components=1
  rm -rf "$tmp"
  log "node $NODE_PIN installed in $NODE_DIR"
}

up_postgres() {
  if ! ls /usr/share/postgresql/16/extension/vector.control >/dev/null 2>&1; then
    as_root apt-get install -y postgresql-16-pgvector >/dev/null 2>&1 || {
      as_root apt-get update -qq >/dev/null && as_root apt-get install -y postgresql-16-pgvector >/dev/null
    }
  fi
  # Loopback only: the two `host all all` lines for 127.0.0.1/32 and ::1/128.
  if grep -Eq '^host\s+all\s+all\s+(127\.0\.0\.1/32|::1/128)\s+scram-sha-256' "$PG_HBA"; then
    as_root sed -i -E 's/^(host\s+all\s+all\s+(127\.0\.0\.1\/32|::1\/128)\s+)scram-sha-256/\1trust/' "$PG_HBA"
  fi
  as_root service postgresql start >/dev/null
  as_root service postgresql reload >/dev/null
  for _ in $(seq 1 20); do pg_isready -q -h localhost && break; sleep 0.5; done
  as_root su postgres -c "psql -qtAc \"SELECT 1 FROM pg_roles WHERE rolname='keyflow'\"" | grep -q 1 \
    || as_root su postgres -c "psql -qc 'CREATE ROLE keyflow LOGIN SUPERUSER'"
  psql -h localhost -U keyflow -d postgres -qtAc "SELECT 1 FROM pg_database WHERE datname='keyflowos'" | grep -q 1 \
    || psql -h localhost -U keyflow -d postgres -qc "CREATE DATABASE keyflowos TEMPLATE template0 LOCALE_PROVIDER icu ICU_LOCALE 'en-US' LOCALE 'C.UTF-8'"
  for db in template1 keyflowos; do
    psql -h localhost -U keyflow -d "$db" -qc 'CREATE EXTENSION IF NOT EXISTS vector'
  done
  log "postgres 16 + pgvector up (database keyflowos, ICU)"
}

up_redis() {
  redis-cli -h 127.0.0.1 ping >/dev/null 2>&1 || redis-server --bind 127.0.0.1 --daemonize yes >/dev/null
  log "redis up"
}

up_env() {
  local env="$ROOT/.env"
  if [[ -f "$env" ]] && ! grep -q '^# written by scripts/dev/claude-cloud-env.sh' "$env"; then
    log ".env exists and was not written here: left unchanged"
    return
  fi
  cat > "$env" <<EOF
# written by scripts/dev/claude-cloud-env.sh: local services only
DATABASE_URL=$DB_URL
DIRECT_URL=$DB_URL
REDIS_URL=$REDIS_URL
NODE_ENV=test
EOF
  log ".env written (local services only)"
}

up_deps() {
  (cd "$ROOT" && PATH="$NODE_DIR/bin:$PATH" pnpm install --frozen-lockfile >/dev/null)
  log "dependencies installed"
}

verify() {
  local gaps=0
  check() { if eval "$2" >/dev/null 2>&1; then echo "ok    $1"; else echo "GAP   $1"; gaps=$((gaps + 1)); fi; }
  check "node $NODE_PIN at $NODE_DIR"               "[[ \$($NODE_DIR/bin/node -v) == v$NODE_PIN ]]"
  check "pnpm 9.15.0"                               "[[ \$(PATH=$NODE_DIR/bin:\$PATH pnpm -v) == 9.15.0 ]]"
  check "postgres accepting on localhost"           "pg_isready -h localhost"
  check "database keyflowos with vector"            "psql -h localhost -U keyflow -d keyflowos -tAc \"SELECT 1 FROM pg_extension WHERE extname='vector'\" | grep -q 1"
  check "redis on 127.0.0.1:6379"                   "redis-cli -h 127.0.0.1 ping | grep -q PONG"
  # The full admission runs first in pnpm test:local (admit-resources.mjs); this is the quick look.
  check ".env names only local services"            "[[ -f $ROOT/.env ]] && ! grep -E '^(DATABASE_URL|DIRECT_URL|REDIS_URL)=' $ROOT/.env | grep -vqE '=(postgresql|redis)://[^/@]*@?(localhost|127\.0\.0\.1)(:[0-9]+)?(/|$)'"
  check "node_modules installed"                    "[[ -d $ROOT/node_modules/.pnpm ]]"
  if [[ $gaps -gt 0 ]]; then echo "$gaps gap(s): run  bash scripts/dev/claude-cloud-env.sh up"; return 1; fi
  echo "ready: export PATH=$NODE_DIR/bin:\$PATH && pnpm test:local -- --no-compose"
}

case ${1:-help} in
  up) up_node; up_postgres; up_redis; up_env; up_deps; verify ;;
  verify) verify ;;
  *) sed -n '2,/^set -euo pipefail$/p' "${BASH_SOURCE[0]}" | sed -e '$d' -e 's/^# \{0,1\}//' ;;
esac
