#!/usr/bin/env bash
# Per-packet database and Redis index for a packet worktree (R0-00-WT-ISOLATION).
#
# Run by the integrating session in the MAIN tree. Every real-DB packet gets its
# own Postgres database kf_wt_<id>, copied from a template that
# `prisma migrate deploy` built from the main tree, and its own Redis index
# 1-15. The values land in the worktree's gitignored .env, which every
# integration suite loads (apps/server/test/*.integration.test.ts read
# ../../../.env). The worktree shell must not export DATABASE_URL, DIRECT_URL or
# REDIS_URL: dotenv never overrides an exported value. Check a worktree with
#   node scripts/proof-admission/admit-resources.mjs --packet <id>
#
# Commands:
#   provision <packet-id> [worktree]  create kf_wt_<id> from the template (built
#                                     first if absent), pick a free Redis index,
#                                     write <worktree>/.env, print the values for
#                                     active-packet.yaml. Idempotent. Without a
#                                     worktree path, the worktree whose branch is
#                                     pkt/<packet-id>... is used.
#   reprovision [--force]             after a migration lands: rebuild the template
#                                     and re-create every live packet database
#                                     from it (their rows are fixtures; suites
#                                     re-seed them).
#   release <packet-id> [--force]     drop kf_wt_<id>, flush and free its Redis
#                                     index, remove the .env this script wrote.
#   list                              live packets: id, Redis index, worktree.
#   db-name <packet-id>               print kf_wt_<id> (no side effects).
#   slug <packet-id>                  print <id> (no side effects).
#   help
#
# --force terminates other sessions on a database before it is dropped. Without
# it, a database in use is left alone and the command fails.
#
# Environment (defaults in brackets):
#   KF_WT_PG_URL         [postgresql://keyflow:keyflow@localhost:5432] admin connection base
#   KF_WT_REDIS_URL      [redis://localhost:6379]
#   KF_WT_REDIS_INDEXES  ["1 2 ... 15"] candidate indexes; an index is free when no
#                        packet holds it, no allocator's owner key claims it, and
#                        it is empty. An allocator that neither writes this
#                        script's state file nor sets the owner key (for
#                        example a harness that hands out indexes 1-15 by
#                        worker number) is invisible while its index is empty:
#                        give the two disjoint ranges with this variable.
#   KF_WT_STATE_FILE     [<git common dir>/kf-worktree-resources.tsv] allocation table,
#                        shared by every worktree of this clone, never committed
#   KF_WT_PRISMA         [<main tree>/packages/db/node_modules/.bin/prisma]
#
# Safety: only databases whose names match ^kf_wt_[a-z0-9_]+$ are ever created
# or dropped (require_wt_db), only on localhost. The template is kf_wt_template.
# A Redis index is claimed with SET kf_wt:owner <packet> NX before it is
# allocated, and release flushes an index only while that key still names the
# packet being released (flush_owned_index): never another packet's index.
# node scripts/proof-admission/admit-resources.mjs --packet <id> admits only
# the index this table allocated to <id>.
set -euo pipefail

TEMPLATE_DB=kf_wt_template
PG_URL=${KF_WT_PG_URL:-postgresql://keyflow:keyflow@localhost:5432}
REDIS_BASE=${KF_WT_REDIS_URL:-redis://localhost:6379}
REDIS_INDEXES=${KF_WT_REDIS_INDEXES:-1 2 3 4 5 6 7 8 9 10 11 12 13 14 15}
REDIS_OWNER_KEY=kf_wt:owner
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
PACKET_ID_RE='^([A-Za-z])([0-9]+)[-_]([0-9]{2,3})([-_][A-Za-z0-9-]*)?$'

die() {
  echo "worktree-resources: $*" >&2
  exit 1
}

usage() {
  sed -n '2,/^set -euo pipefail$/p' "${BASH_SOURCE[0]}" | sed -e '$d' -e 's/^# \{0,1\}//'
}

# R0-00-WT-ISOLATION, R0-00 and r0_00 -> r0_00 (same rule as admit-resources.mjs packetSlug).
slug_of() {
  local id=$1
  if [[ $id =~ $PACKET_ID_RE ]]; then
    printf '%s%s_%s\n' "${BASH_REMATCH[1],,}" "${BASH_REMATCH[2]}" "${BASH_REMATCH[3]}"
  else
    return 1
  fi
}

require_wt_db() {
  [[ ${1:-} =~ ^kf_wt_[a-z0-9_]+$ ]] \
    || die "refusing to touch database '${1:-}': only kf_wt_* databases are managed here"
}

require_local() {
  local host
  host=$(sed -E 's#^[a-z]+://([^@/]*@)?([^:/]+).*#\2#' <<<"$1")
  [[ $host == localhost || $host == 127.0.0.1 ]] || die "refusing a non-local endpoint: $host"
}

init_paths() {
  local common
  common=$(git -C "$SCRIPT_DIR" rev-parse --git-common-dir)
  common=$(cd "$SCRIPT_DIR" && cd "$common" && pwd -P)
  MAIN_TREE=$(dirname "$common")
  STATE_FILE=${KF_WT_STATE_FILE:-$common/kf-worktree-resources.tsv}
  PRISMA=${KF_WT_PRISMA:-$MAIN_TREE/packages/db/node_modules/.bin/prisma}
  require_local "$PG_URL"
  require_local "$REDIS_BASE"
  touch "$STATE_FILE"
  exec 9>"$STATE_FILE.lock"
  flock 9
}

psql_admin() {
  psql "$PG_URL/postgres" -v ON_ERROR_STOP=1 -qAt "$@"
}

db_exists() {
  require_wt_db "$1"
  [[ $(psql_admin -c "SELECT 1 FROM pg_database WHERE datname = '$1'") == 1 ]]
}

# pg_create_db <name> [template]
pg_create_db() {
  require_wt_db "$1"
  if [[ -n ${2:-} ]]; then
    require_wt_db "$2"
    psql_admin -c "CREATE DATABASE \"$1\" TEMPLATE \"$2\""
  else
    psql_admin -c "CREATE DATABASE \"$1\""
  fi
}

# pg_drop_db <name> [force]
pg_drop_db() {
  require_wt_db "$1"
  if [[ ${2:-} == force ]]; then
    psql_admin -c "DROP DATABASE IF EXISTS \"$1\" WITH (FORCE)"
  else
    psql_admin -c "DROP DATABASE IF EXISTS \"$1\""
  fi
}

# Build the template from the main tree's migrations.
build_template() {
  local url="$PG_URL/$TEMPLATE_DB"
  pg_drop_db "$TEMPLATE_DB" "${1:-}"
  pg_create_db "$TEMPLATE_DB"
  [[ -x $PRISMA ]] || die "prisma not found at $PRISMA (set KF_WT_PRISMA)"
  echo "building $TEMPLATE_DB: prisma migrate deploy from $MAIN_TREE/packages/db" >&2
  (cd "$MAIN_TREE/packages/db" && DATABASE_URL="$url" DIRECT_URL="$url" "$PRISMA" migrate deploy --schema prisma/schema.prisma >&2)
}

ensure_template() {
  if ! db_exists "$TEMPLATE_DB"; then
    build_template
  fi
}

redis_cli() {
  redis-cli -u "$REDIS_BASE/$1" "${@:2}"
}

state_rows() {
  grep -v '^[[:space:]]*$' "$STATE_FILE" || true
}

# state_get <slug> <column 2=index 3=worktree>
state_get() {
  awk -F'\t' -v s="$1" -v c="$2" '$1 == s { print $c; found = 1 } END { exit !found }' "$STATE_FILE"
}

state_put() {
  local tmp
  tmp=$(mktemp "$STATE_FILE.XXXXXX")
  awk -F'\t' -v s="$1" '$1 != s' "$STATE_FILE" >"$tmp"
  printf '%s\t%s\t%s\n' "$1" "$2" "$3" >>"$tmp"
  mv "$tmp" "$STATE_FILE"
}

state_del() {
  local tmp
  tmp=$(mktemp "$STATE_FILE.XXXXXX")
  awk -F'\t' -v s="$1" '$1 != s' "$STATE_FILE" >"$tmp"
  mv "$tmp" "$STATE_FILE"
}

# pick_redis_index <slug>: the first candidate index that no packet in the
# state file holds, that is empty, and that this call wins the owner key on.
# SET NX makes the claim atomic against another allocator honouring the key
# (another clone's copy of this script, with its own state file).
pick_redis_index() {
  local slug=$1 i held
  held=$(awk -F'\t' '{ print $2 }' "$STATE_FILE")
  for i in $REDIS_INDEXES; do
    [[ $i =~ ^[0-9]+$ ]] && ((i >= 1 && i <= 15)) || continue
    grep -qx "$i" <<<"$held" && continue
    [[ $(redis_cli "$i" DBSIZE) == 0 ]] || continue
    [[ $(redis_cli "$i" SET "$REDIS_OWNER_KEY" "$slug" NX) == OK ]] || continue
    echo "$i"
    return 0
  done
  return 1
}

# claim_owned_index <slug> <index>: (re)assert the owner key on an index the
# state file already gives this packet. Fails if another packet's key is there.
claim_owned_index() {
  local slug=$1 idx=$2 owner
  redis_cli "$idx" SET "$REDIS_OWNER_KEY" "$slug" NX >/dev/null
  owner=$(redis_cli "$idx" GET "$REDIS_OWNER_KEY")
  [[ $owner == "$slug" ]] || die "redis index $idx is claimed by '$owner', not $slug; release that packet or pick another index"
}

# flush_owned_index <slug> <index>: FLUSHDB only while the owner key names
# <slug>, or is absent and no other packet in the state file holds the index.
# Anything else means the index is in use by someone else: leave it alone.
flush_owned_index() {
  local slug=$1 idx=$2 owner others
  owner=$(redis_cli "$idx" GET "$REDIS_OWNER_KEY")
  others=$(awk -F'\t' -v s="$slug" -v i="$idx" '$1 != s && $2 == i { print $1 }' "$STATE_FILE")
  if [[ $owner == "$slug" ]] || [[ -z $owner && -z $others ]]; then
    redis_cli "$idx" FLUSHDB >/dev/null
    return 0
  fi
  echo "worktree-resources: warning: not flushing redis index $idx: it is claimed by '${owner:-$others}', not $slug" >&2
  return 1
}

# The worktree whose branch is pkt/<packet-id>..., by slug.
find_worktree() {
  local slug=$1 path='' line branch found=''
  while IFS= read -r line; do
    case $line in
      'worktree '*) path=${line#worktree } ;;
      'branch '*)
        branch=${line#branch refs/heads/}
        if [[ $branch == pkt/* ]] && [[ $(slug_of "${branch#pkt/}" || true) == "$slug" ]]; then
          [[ -z $found ]] || die "several worktrees match $slug; pass the worktree path"
          found=$path
        fi
        ;;
    esac
  done < <(git -C "$MAIN_TREE" worktree list --porcelain)
  [[ -n $found ]] || return 1
  echo "$found"
}

write_env() {
  local wt=$1 slug=$2 db=$3 idx=$4
  cat >"$wt/.env" <<ENV
# Written by scripts/worktree-resources.sh provision for packet $slug.
# Gitignored; never commit. The worktree shell must not export DATABASE_URL,
# DIRECT_URL or REDIS_URL (dotenv never overrides an exported value). Check:
#   node scripts/proof-admission/admit-resources.mjs --packet $slug
KF_WT_PACKET=$slug
DATABASE_URL=$PG_URL/$db
DIRECT_URL=$PG_URL/$db
REDIS_URL=$REDIS_BASE/$idx
ENV
}

cmd_provision() {
  local id=${1:-} wt=${2:-} slug db idx
  [[ -n $id ]] || die "usage: provision <packet-id> [worktree]"
  slug=$(slug_of "$id") || die "not a packet id: $id"
  db="kf_wt_$slug"
  init_paths
  if [[ -z $wt ]]; then
    wt=$(find_worktree "$slug") || die "no worktree on a pkt/$id branch; pass the worktree path"
  fi
  wt=$(cd "$wt" && pwd -P)
  [[ $wt != "$MAIN_TREE" ]] || die "refusing to write .env into the main tree"
  git -C "$wt" rev-parse --is-inside-work-tree >/dev/null 2>&1 || die "$wt is not a git worktree"
  git -C "$wt" check-ignore -q .env || die "$wt/.env is not gitignored"
  if [[ -e $wt/.env ]] && ! grep -qx "KF_WT_PACKET=$slug" "$wt/.env"; then
    die "$wt/.env exists and was not written for $slug; move it aside first"
  fi

  ensure_template
  db_exists "$db" || pg_create_db "$db" "$TEMPLATE_DB"
  if idx=$(state_get "$slug" 2); then
    claim_owned_index "$slug" "$idx"
  else
    idx=$(pick_redis_index "$slug") || die "no free Redis index among: $REDIS_INDEXES"
  fi
  state_put "$slug" "$idx" "$wt"
  write_env "$wt" "$slug" "$db" "$idx"

  cat <<YAML
# for .agent-control/active-packet.yaml
resources:
  database: $db
  redis_index: $idx
  env_file: $wt/.env
  admission: node scripts/proof-admission/admit-resources.mjs --packet $slug
YAML
  if [[ -n ${DATABASE_URL:-}${DIRECT_URL:-}${REDIS_URL:-} ]]; then
    echo "worktree-resources: warning: this shell exports DATABASE_URL/DIRECT_URL/REDIS_URL; a worktree shell that does the same overrides .env" >&2
  fi
}

cmd_reprovision() {
  local force='' slug idx wt
  [[ ${1:-} == --force ]] && force=force
  init_paths
  build_template "$force"
  while IFS=$'\t' read -r slug idx wt; do
    [[ -n $slug ]] || continue
    pg_drop_db "kf_wt_$slug" "$force"
    pg_create_db "kf_wt_$slug" "$TEMPLATE_DB"
    echo "rebuilt kf_wt_$slug (redis index $idx, $wt)"
  done < <(state_rows)
}

cmd_release() {
  local id=${1:-} force='' slug db idx wt
  [[ -n $id ]] || die "usage: release <packet-id> [--force]"
  [[ ${2:-} == --force ]] && force=force
  slug=$(slug_of "$id") || die "not a packet id: $id"
  db="kf_wt_$slug"
  init_paths
  pg_drop_db "$db" "$force"
  if idx=$(state_get "$slug" 2); then
    flush_owned_index "$slug" "$idx" || true
  fi
  if wt=$(state_get "$slug" 3) && [[ -f $wt/.env ]] && grep -qx "KF_WT_PACKET=$slug" "$wt/.env"; then
    rm -f "$wt/.env"
  fi
  state_del "$slug"
  echo "released $db${idx:+ and redis index $idx}"
}

cmd_list() {
  init_paths
  printf 'packet\tredis_index\tworktree\n'
  state_rows
}

main() {
  local cmd=${1:-help}
  shift || true
  case $cmd in
    provision) cmd_provision "$@" ;;
    reprovision) cmd_reprovision "$@" ;;
    release) cmd_release "$@" ;;
    list) cmd_list ;;
    slug) slug_of "${1:-}" || die "not a packet id: ${1:-}" ;;
    db-name)
      local slug
      slug=$(slug_of "${1:-}") || die "not a packet id: ${1:-}"
      echo "kf_wt_$slug"
      ;;
    help | -h | --help) usage ;;
    *) die "unknown command '$cmd' (try: help)" ;;
  esac
}

main "$@"
