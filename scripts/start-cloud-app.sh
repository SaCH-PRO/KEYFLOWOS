#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMUX=(tmux -f /exec-daemon/tmux.portal.conf)
DEFAULT_DB_URL="postgresql://keyflow:keyflow@localhost:5432/keyflow"
ENV_FILE="$ROOT_DIR/apps/web/.env.local"

log() {
  echo "[cloud-start] $*"
}

read_env_value() {
  local key="$1"
  local file="$2"
  [[ -f "$file" ]] || return 0
  rg "^${key}=" -N "$file" | sed "s/^${key}=//" | tail -n 1
}

ensure_session() {
  local session_name="$1"
  "${TMUX[@]}" has-session -t "=$session_name" 2>/dev/null || \
    "${TMUX[@]}" new-session -d -s "$session_name" -c "$ROOT_DIR" -- "${SHELL:-bash}" -l
}

restart_tmux_command() {
  local session_name="$1"
  local command="$2"
  "${TMUX[@]}" send-keys -t "$session_name:0.0" C-c
  "${TMUX[@]}" clear-history -t "$session_name:0.0" || true
  "${TMUX[@]}" send-keys -t "$session_name:0.0" "clear" C-m
  "${TMUX[@]}" send-keys -t "$session_name:0.0" "$command" C-m
}

latest_tunnel_url() {
  local session_name="$1"
  local output=""
  local url=""
  for _ in $(seq 1 50); do
    output="$("${TMUX[@]}" capture-pane -pt "$session_name:0.0" 2>/dev/null || true)"
    url="$(printf '%s\n' "$output" | rg -o 'https://[a-z0-9-]+\.tunnelmole\.net' | tail -n 1 || true)"
    if [[ -n "$url" ]]; then
      printf '%s\n' "$url"
      return 0
    fi
    sleep 1
  done
  return 1
}

ensure_local_postgres() {
  if ! command -v psql >/dev/null 2>&1; then
    log "Installing PostgreSQL packages"
    sudo apt-get update >/dev/null
    sudo apt-get install -y postgresql >/dev/null
  fi

  log "Starting local PostgreSQL service"
  sudo service postgresql start >/dev/null

  local user_exists
  user_exists="$(sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='keyflow';" | tr -d '[:space:]')"
  if [[ "$user_exists" != "1" ]]; then
    log "Creating local postgres role: keyflow"
    sudo -u postgres psql -c "CREATE USER keyflow WITH PASSWORD 'keyflow';" >/dev/null
  fi

  local db_exists
  db_exists="$(sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='keyflow';" | tr -d '[:space:]')"
  if [[ "$db_exists" != "1" ]]; then
    log "Creating local postgres database: keyflow"
    sudo -u postgres psql -c "CREATE DATABASE keyflow OWNER keyflow;" >/dev/null
  fi
}

write_web_env() {
  local supabase_url="$1"
  local supabase_anon_key="$2"
  local api_base_url="$3"
  local site_url="$4"

  cat > "$ENV_FILE" <<EOF
SUPABASE_URL=$supabase_url
SUPABASE_ANON_KEY=$supabase_anon_key
NEXT_PUBLIC_API_BASE_URL=$api_base_url
NEXT_PUBLIC_SITE_URL=$site_url
EOF
}

main() {
  local supabase_url="${SUPABASE_URL:-$(read_env_value SUPABASE_URL "$ENV_FILE")}"
  local supabase_anon_key="${SUPABASE_ANON_KEY:-$(read_env_value SUPABASE_ANON_KEY "$ENV_FILE")}"

  if [[ -z "$supabase_url" || -z "$supabase_anon_key" ]]; then
    echo "Missing SUPABASE_URL/SUPABASE_ANON_KEY."
    echo "Set them in your shell or apps/web/.env.local and re-run."
    exit 1
  fi

  local db_url="${DATABASE_URL:-$DEFAULT_DB_URL}"
  local direct_url="${DIRECT_URL:-$db_url}"

  ensure_local_postgres

  log "Syncing schema to local database"
  DATABASE_URL="$db_url" DIRECT_URL="$direct_url" pnpm db:push >/dev/null

  ensure_session "server-dev"
  ensure_session "web-dev"
  ensure_session "api-tunnel"
  ensure_session "web-tunnel"

  log "Starting backend dev server"
  restart_tmux_command "server-dev" \
    "cd $ROOT_DIR && DATABASE_URL=\"$db_url\" DIRECT_URL=\"$direct_url\" SUPABASE_URL=\"$supabase_url\" SUPABASE_ANON_KEY=\"$supabase_anon_key\" AI_INTEGRATIONS_OPENAI_API_KEY=dummy-key BYOK_ENCRYPTION_SECRET=dummy-secret-for-local-dev pnpm --filter server dev"

  log "Starting backend public tunnel"
  restart_tmux_command "api-tunnel" \
    "cd $ROOT_DIR && npx -y tunnelmole 3001"
  local api_public_url
  api_public_url="$(latest_tunnel_url "api-tunnel")" || {
    echo "Failed to resolve backend tunnel URL."
    exit 1
  }

  write_web_env "$supabase_url" "$supabase_anon_key" "$api_public_url" "http://localhost:5000"

  log "Starting frontend dev server"
  restart_tmux_command "web-dev" \
    "cd $ROOT_DIR && pnpm --filter web dev"

  log "Starting frontend public tunnel"
  restart_tmux_command "web-tunnel" \
    "cd $ROOT_DIR && npx -y tunnelmole 5000"
  local web_public_url
  web_public_url="$(latest_tunnel_url "web-tunnel")" || {
    echo "Failed to resolve frontend tunnel URL."
    exit 1
  }

  write_web_env "$supabase_url" "$supabase_anon_key" "$api_public_url" "$web_public_url"

  log "Reloading frontend with final public URLs"
  restart_tmux_command "web-dev" \
    "cd $ROOT_DIR && pnpm --filter web dev"

  echo
  echo "Cloud app stack is ready:"
  echo "  Frontend URL: $web_public_url"
  echo "  Backend URL : $api_public_url"
  echo
  echo "Sanity checks:"
  echo "  curl \"$web_public_url/auth/login\""
  echo "  curl \"$api_public_url/site/health\""
}

main "$@"
