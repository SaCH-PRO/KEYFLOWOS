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
#   * On 2026-11-13 this script printed DEPLOYED while the API crash-looped on
#     "[FATAL] Environment validation failed: SUPABASE_JWT_SECRET is a public
#     placeholder". .env.production is read only inside the containers, so a
#     value the API refuses at boot surfaced after the backup, the build and
#     the restart; and the verify step read /healthz once and trusted any body
#     on the right commit, degraded or not. Both are checked now: the env file
#     against the API's boot rules before anything is touched, and /healthz
#     polled until it is ok with the API reachable (scripts/tests/deploy-sh.spec.mjs).
#   * Bash reads a script from the file it opened. `git checkout` replaces
#     scripts/deploy.sh with a NEW file, and the running bash goes on reading
#     the copy the box had before the checkout. So `deploy.sh <ref>` used to
#     run the PREVIOUS deploy.sh's logic from start to finish: the first
#     deploy of a changed deploy.sh got none of its changes. After the
#     checkout this script now re-runs the ref's own copy when it differs.
#     A box whose copy predates that re-run cannot do it: for the first deploy
#     after it lands, update the checkout by hand and run with no ref
#     (docs/DEPLOY_RUNBOOK.md, "First deploy of a changed deploy.sh").
#   * Run under `bash -x`, the .env.production preflight used to trace every
#     production secret. It turns tracing off for itself, and the dump it
#     takes is created 0600 (it holds every tenant's data).
#
# Anything you learn the next time this hurts belongs here, not in your memory.
#
# Usage:   scripts/deploy.sh [git-ref]
#          scripts/deploy.sh                 # deploy current checkout
#          scripts/deploy.sh main            # fetch and deploy main
#
# Environment (each optional):
#   DEPLOY_SKIP_CI_CHECK=1    deploy without the CI gate below (typed on purpose)
#   DEPLOY_BACKUP_DIR=<dir>   where the pre-deploy dump goes (default /root);
#                             the dump is created 0600 whatever the umask
#   DEPLOY_REEXEC             set by this script when it re-runs the ref's own
#                             deploy.sh after a checkout; not for typing
#
set -euo pipefail

# The copy of this script that bash is running, taken before anything can
# replace it on disk. See the checkout step.
SELF_SUM="$(git hash-object --no-filters -- "${BASH_SOURCE[0]}" 2>/dev/null || true)"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

COMPOSE_FILE="docker-compose.production.yml"
ENV_FILE=".env.production"
SERVICES="api web"
REF="${1:-}"

say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[31mFAILED: %s\033[0m\n' "$*" >&2; exit 1; }

# --- the API's boot rules, for the .env.production preflight ------------------
#
# The refusals the API makes before Nest starts, checked against the env file
# before anything is backed up, built or restarted:
#
#   * SUPABASE_JWT_SECRET holding a public placeholder (env.ts,
#     PUBLIC_SUPABASE_JWT_SECRET_PLACEHOLDERS; R0-SEC-02). The list is read from
#     the env.ts being deployed, plus this copy for a ref whose env.ts has none.
#     Refused even under KEYFLOW_SKIP_ENV_VALIDATION: with a public value anyone
#     can mint tokens the API accepts.
#   * the S3 group (env.ts validateS3Group): any S3_* set needs every one of
#     DEPLOY_S3_REQUIRED, and S3_ENDPOINT must start with http:// or https://.
#     Skipped under KEYFLOW_SKIP_ENV_VALIDATION=1|true, as the API skips it.
#   * KEYFLOW_DEV_AUTH_BYPASS true or 1 (main.ts assertNoDevAuthBypass).
#   * email verification, on in production unless AUTH_REQUIRE_EMAIL_VERIFICATION
#     says otherwise, needs every one of DEPLOY_EMAIL_VERIFICATION_REQUIRED (main.ts).
#
# NODE_ENV, PORT and DATABASE_URL are not read: docker-compose.production.yml
# sets them for the api service over env_file. A line is read as compose reads
# an env_file (`export ` prefix, quotes, ` #` comments, CRLF), the last
# assignment of a name wins, and the value is trimmed as the API trims it
# (quotes and spaces around a placeholder do not hide it; ANY assignment of a
# placeholder is refused). No value is ever printed: only names and line
# numbers, and the check turns `bash -x` tracing off for itself, because
# traced, every assignment it reads would print. For a name the check reads
# (DEPLOY_READ_NAMES), a line compose would read differently from KEY=value
# is refused as unverifiable rather than read wrong: a YAML-style
# `NAME: value` line, and a `$` outside single quotes (compose fills
# `${VAR}` and `$VAR` from the file or from its own environment).
# scripts/tests/deploy-sh.spec.mjs pins these lists to env.ts and
# main.ts. A refusal the API makes later, inside Nest, is caught by the health
# wait at the end of this script.
DEPLOY_JWT_SECRET_PLACEHOLDERS=('your-supabase-jwt-signing-secret' 'your-jwt-secret')
DEPLOY_S3_GROUP=('S3_BUCKET' 'S3_REGION' 'S3_ACCESS_KEY_ID' 'S3_SECRET_ACCESS_KEY' 'S3_ENDPOINT' 'S3_PUBLIC_URL' 'S3_FORCE_PATH_STYLE')
DEPLOY_S3_REQUIRED=('S3_BUCKET' 'S3_REGION' 'S3_ACCESS_KEY_ID' 'S3_SECRET_ACCESS_KEY')
DEPLOY_EMAIL_VERIFICATION_REQUIRED=('SUPABASE_SERVICE_ROLE_KEY' 'RESEND_API_KEY' 'EMAIL_FROM_ADDRESS')
DEPLOY_READ_NAMES=('SUPABASE_JWT_SECRET' 'KEYFLOW_SKIP_ENV_VALIDATION' 'KEYFLOW_DEV_AUTH_BYPASS' 'AUTH_REQUIRE_EMAIL_VERIFICATION' "${DEPLOY_S3_GROUP[@]}" "${DEPLOY_EMAIL_VERIFICATION_REQUIRED[@]}")
SERVER_ENV_TS="apps/server/src/core/config/env.ts"

env_trim() {
  local s="$1"
  s="${s#"${s%%[![:space:]]*}"}"
  s="${s%"${s##*[![:space:]]}"}"
  printf '%s' "$s"
}

# Whitespace and quote characters around a value, however nested.
env_unwrap() {
  local s="$1"
  while :; do
    s="$(env_trim "$s")"
    case "$s" in
      \"*|\'*) s="${s:1}" ;;
      *\"|*\') s="${s%?}" ;;
      *) break ;;
    esac
  done
  printf '%s' "$s"
}

# Reads an env file into ENV_KEYS / ENV_VALS / ENV_LINES, one entry per
# assignment, in file order. The values stay in these arrays; nothing prints them.
# A line this cannot read as compose does goes to ENV_UNREAD_KEYS /
# ENV_UNREAD_LINES / ENV_UNREAD_WHY instead: compose ends a name at the first
# `=` OR `:` (a YAML-style `NAME: value`), and fills `${VAR}` / `$VAR` in an
# unquoted or double-quoted value. Only single quotes are literal.
env_file_parse() {
  local raw line head sep key val why n=0 interp
  ENV_KEYS=(); ENV_VALS=(); ENV_LINES=()
  ENV_UNREAD_KEYS=(); ENV_UNREAD_LINES=(); ENV_UNREAD_WHY=()
  while IFS= read -r raw || [ -n "$raw" ]; do
    n=$((n + 1))
    line="${raw%$'\r'}"
    if [ "$n" -eq 1 ]; then line="${line#$'\xef\xbb\xbf'}"; fi
    line="$(env_trim "$line")"
    case "$line" in ''|'#'*) continue ;; esac
    case "$line" in export[[:space:]]*) line="$(env_trim "${line#export}")" ;; esac
    case "$line" in *[=:]*) ;; *) continue ;; esac
    head="${line%%[=:]*}"
    sep="${line:${#head}:1}"
    key="$(env_trim "$head")"
    val="$(env_trim "${line:$(( ${#head} + 1 ))}")"
    interp=1
    case "$val" in
      \"*) val="${val#\"}"; val="${val%%\"*}" ;;
      \'*) val="${val#\'}"; val="${val%%\'*}"; interp=0 ;;
      *) val="${val%%[[:space:]]#*}" ;;
    esac
    why=""
    if [ "$sep" = ":" ]; then
      why="it is written NAME: value, which compose reads as an assignment (YAML style) and this check does not"
    elif [ "$interp" -eq 1 ]; then
      case "$val" in *'$'*) why="its value holds a \$ outside single quotes, which compose replaces from the file or from its own environment" ;; esac
    fi
    if [ -n "$why" ]; then
      ENV_UNREAD_KEYS+=("$key")
      ENV_UNREAD_LINES+=("$n")
      ENV_UNREAD_WHY+=("$why")
      continue
    fi
    ENV_KEYS+=("$key")
    ENV_VALS+=("$(env_unwrap "$val")")
    ENV_LINES+=("$n")
  done < "$1"
}

# The last assignment of a name: ENV_LAST_VAL (empty when unset) and ENV_LAST_LINE.
env_last() {
  local i
  ENV_LAST_VAL=""
  ENV_LAST_LINE=""
  for i in "${!ENV_KEYS[@]}"; do
    if [ "${ENV_KEYS[$i]}" = "$1" ]; then
      ENV_LAST_VAL="${ENV_VALS[$i]}"
      ENV_LAST_LINE="${ENV_LINES[$i]}"
    fi
  done
}

# The placeholder Set as the env.ts being deployed declares it (nothing when absent).
env_ts_placeholders() {
  [ -f "$SERVER_ENV_TS" ] || return 0
  awk '/PUBLIC_SUPABASE_JWT_SECRET_PLACEHOLDERS[[:space:]]*=[[:space:]]*new Set\(\[/ { on = 1 }
       on { print }
       on && /\]\)/ { exit }' "$SERVER_ENV_TS" \
    | tr '\n' ' ' \
    | sed -n 's/.*new Set(\[\(.*\)\]).*/\1/p' \
    | grep -oE "'[^']*'|\"[^\"]*\"" \
    | sed "s/^['\"]//; s/['\"]\$//" || true
}

# Refuses (exit 1) when the env file holds a value the API refuses at boot.
check_env_production() {
  # Never traced: under `bash -x` every value this reads would be printed.
  # `local -` restores the caller's options when this returns (bash >= 4.4),
  # and env_file_parse and env_last run inside it.
  local -
  set +x
  local file="$1" i p k flag skip=0 s3_any=0
  local -a placeholders problems=() from_ts=()
  mapfile -t from_ts < <(env_ts_placeholders)
  placeholders=("${DEPLOY_JWT_SECRET_PLACEHOLDERS[@]}" ${from_ts[@]+"${from_ts[@]}"})
  env_file_parse "$file"

  # A line for a name this check reads, written so compose reads it otherwise.
  for i in "${!ENV_UNREAD_KEYS[@]}"; do
    for k in "${DEPLOY_READ_NAMES[@]}"; do
      if [ "${ENV_UNREAD_KEYS[$i]}" = "$k" ]; then
        problems+=("$k (line ${ENV_UNREAD_LINES[$i]}) cannot be verified: ${ENV_UNREAD_WHY[$i]}. Write it as $k=value, in single quotes if the value holds a \$.")
        break
      fi
    done
  done

  for i in "${!ENV_KEYS[@]}"; do
    if [ "${ENV_KEYS[$i]}" != SUPABASE_JWT_SECRET ] || [ -z "${ENV_VALS[$i]}" ]; then continue; fi
    for p in "${placeholders[@]}"; do
      if [ -n "$p" ] && [ "${ENV_VALS[$i]}" = "$p" ]; then
        problems+=("SUPABASE_JWT_SECRET (line ${ENV_LINES[$i]}) is a public placeholder from .env.example or DEPLOYMENT.md: anyone can sign tokens the API verifies, and the API refuses to boot with it in production. For Release 0 leave it empty (docs/auth-pathway.md).")
        break
      fi
    done
  done

  env_last KEYFLOW_SKIP_ENV_VALIDATION
  case "$ENV_LAST_VAL" in 1|true) skip=1 ;; esac
  if [ "$skip" -eq 0 ]; then
    for k in "${DEPLOY_S3_GROUP[@]}"; do
      env_last "$k"
      if [ -n "$ENV_LAST_VAL" ]; then s3_any=1; fi
    done
    if [ "$s3_any" -eq 1 ]; then
      for k in "${DEPLOY_S3_REQUIRED[@]}"; do
        env_last "$k"
        if [ -z "$ENV_LAST_VAL" ]; then
          problems+=("$k is not set, and another S3_* variable is: the API requires the S3 config as a group (env.ts validateS3Group).")
        fi
      done
      env_last S3_ENDPOINT
      if [ -n "$ENV_LAST_VAL" ]; then
        case "$ENV_LAST_VAL" in
          [Hh][Tt][Tt][Pp]://*|[Hh][Tt][Tt][Pp][Ss]://*) ;;
          *) problems+=("S3_ENDPOINT (line $ENV_LAST_LINE) must start with http:// or https:// (env.ts validateS3Group).") ;;
        esac
      fi
    fi
  fi

  env_last KEYFLOW_DEV_AUTH_BYPASS
  case "$ENV_LAST_VAL" in
    true|1) problems+=("KEYFLOW_DEV_AUTH_BYPASS (line $ENV_LAST_LINE) is on: the API exits at boot (main.ts assertNoDevAuthBypass). Remove the line.") ;;
  esac

  env_last AUTH_REQUIRE_EMAIL_VERIFICATION
  flag="$(printf '%s' "$ENV_LAST_VAL" | tr '[:upper:]' '[:lower:]')"
  case "$flag" in
    true|1|'')
      for k in "${DEPLOY_EMAIL_VERIFICATION_REQUIRED[@]}"; do
        env_last "$k"
        if [ -z "$ENV_LAST_VAL" ]; then
          problems+=("$k is not set, and email verification is on (AUTH_REQUIRE_EMAIL_VERIFICATION ${flag:-unset}, on by default in production): the API refuses to start (main.ts).")
        fi
      done
      ;;
  esac

  # The values are not needed past this point; nothing later may print them.
  ENV_VALS=()
  ENV_LAST_VAL=""
  if [ "${#problems[@]}" -gt 0 ]; then
    printf '\n\033[31mFAILED: %s would not boot the API (its own rules: %s, apps/server/src/main.ts):\033[0m\n' "$file" "$SERVER_ENV_TS" >&2
    for p in "${problems[@]}"; do printf '  - %s\n' "$p" >&2; done
    printf '     Nothing was backed up, built or restarted. Fix %s on this box and run this again.\n' "$file" >&2
    exit 1
  fi
  printf '    %s passes the API boot checks (%d assignments read; no value printed)\n' "$file" "${#ENV_KEYS[@]}"
}

# One field of the /healthz body, read without jq or node (neither is on the box).
health_string() {
  printf '%s' "$2" | sed -n "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" | head -n 1 || true
}
health_bool() {
  printf '%s' "$2" | grep -oE "\"$1\"[[:space:]]*:[[:space:]]*(true|false)" | head -n 1 | grep -oE '(true|false)$' || true
}

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

  # The checkout wrote the ref's scripts/deploy.sh as a new file, but bash
  # goes on reading the file it opened: the copy from BEFORE the checkout.
  # Left alone, this deploy would run the previous deploy.sh to the end and
  # none of the ref's changes to it (its preflight, its health wait). So when
  # the copies differ, run the ref's own, with no ref: the fetch, the
  # checkout and the dirty check above are done. (scripts/tests/deploy-sh.spec.mjs DSH-R)
  REF_SUM="$(git hash-object --no-filters -- "$ROOT_DIR/scripts/deploy.sh" 2>/dev/null || true)"
  if [ "$REF_SUM" != "$SELF_SUM" ]; then
    [ -f "$ROOT_DIR/scripts/deploy.sh" ] || die "$REF has no scripts/deploy.sh to deploy it with"
    # A re-run never checks anything out, so it cannot get here. If it does
    # (DEPLOY_REEXEC typed by hand), going on would be the old copy again.
    [ -z "${DEPLOY_REEXEC:-}" ] || die "scripts/deploy.sh differs from the copy running, and this run is already a re-run.
     Refusing to go on with a deploy.sh that is not the deployed one.
     Run it again with no ref and DEPLOY_REEXEC unset:  $ROOT_DIR/scripts/deploy.sh"
    say "scripts/deploy.sh changed with $REF: re-running the checked-out copy"
    export DEPLOY_REEXEC=1
    case "$-" in *x*) exec bash -x "$ROOT_DIR/scripts/deploy.sh" ;; esac
    exec bash "$ROOT_DIR/scripts/deploy.sh"
  fi
fi

GIT_COMMIT="$(git rev-parse HEAD)"
export GIT_COMMIT
say "Deploying ${GIT_COMMIT:0:12} — $(git log -1 --format=%s)"

# --- .env.production preflight -------------------------------------------------
# After the checkout, so the rules are those of the code being deployed (its
# env.ts); before the CI gate, the backup and the build, so a file the API would
# refuse stops here with nothing touched. See check_env_production above.
say "Checking $ENV_FILE against the API's boot rules"
check_env_production "$ENV_FILE"

# --- CI gate -----------------------------------------------------------------
#
# Nothing on this path used to consult CI. No test ran, no typecheck ran, and no
# check-run was queried: a red commit, or one CI had never seen, deployed
# exactly like a green one. docs/FORK_CLOSE_DEPLOY.md carries a table headed
# "Gates that must be green before deploying" and this script checked none of
# them — the table was enforced by whoever remembered to read it.
#
# That mattered more than it looked. For a full day CI was failing on a lint
# ceiling, which SKIPPED the test job rather than failing it, so the pipeline
# rendered grey instead of red while 24 server gates and every security
# integration suite went unrun. A deploy in that window would have shipped with
# nothing verified and nothing to say so.
#
# Fails closed, including when the tooling is missing. An unavailable checker
# that waves the deploy through is the same failure one layer down, so the
# escape hatch is explicit and has to be typed on purpose.
if [ "${DEPLOY_SKIP_CI_CHECK:-0}" = "1" ]; then
  printf 'WARNING: DEPLOY_SKIP_CI_CHECK=1 — deploying %s without checking CI.\n' "${GIT_COMMIT:0:12}"
else
  say "Checking CI for ${GIT_COMMIT:0:12}"

  # curl FIRST, gh only as a fallback.
  #
  # The first version required `gh`, which is not on this box and was never
  # going to be — the runbook's own opening fact is that there is no node on the
  # host. So the very first real deploy hit "gh is not installed" and the only
  # way forward was DEPLOY_SKIP_CI_CHECK=1.
  #
  # A gate that can only be satisfied by bypassing it does not protect anything.
  # It teaches the bypass, and the third time someone types that flag they stop
  # reading what it says. Failing closed was right; requiring a tool the target
  # environment does not have was not.
  #
  # The repository is public, so the check-runs endpoint answers unauthenticated
  # (verified: HTTP 200). curl is on every box that can pull a Docker image.
  CI_STATE=""
  CI_API="https://api.github.com/repos/SaCH-PRO/KEYFLOWOS/commits/$GIT_COMMIT/check-runs"
  if command -v curl >/dev/null 2>&1; then
    # No jq either — grep the one field out. Fragile-looking, but the
    # alternative is another dependency this box does not have.
    # In the response "conclusion" follows its check-run's "name" about
    # sixteen comma-fields later, so: split on commas, find the Run Tests
    # name, take the first conclusion after it. Verified against a real
    # commit (-> "success") and an all-zero SHA CI has never seen (-> empty,
    # which refuses rather than guesses).
    CI_STATE="$(curl -sS -m 20 -H 'Accept: application/vnd.github+json' "$CI_API" 2>/dev/null \
      | tr ',' '\n' \
      | grep -A 20 '"name": *"Run Tests"' \
      | grep -m1 '"conclusion"' \
      | sed 's/.*"conclusion": *"\([^"]*\)".*/\1/' || true)"
  fi
  # A 422 body ("No commit found for SHA") is not a conclusion. Anything that
  # is not a bare word is treated as unreadable, so the refusal message says
  # "could not read a result" rather than quoting GitHub's error JSON at someone
  # who is trying to ship.
  case "$CI_STATE" in
    *[!a-z_]*) CI_STATE="" ;;
  esac

  if [ -z "$CI_STATE" ] && command -v gh >/dev/null 2>&1; then
    CI_STATE="$(gh api "repos/{owner}/{repo}/commits/$GIT_COMMIT/check-runs"         --jq '[.check_runs[] | select(.name == "Run Tests")] | first | .conclusion' 2>/dev/null || true)"
  fi

  case "$CI_STATE" in
    success)
      say "CI: Run Tests passed"
      ;;
    ''|null)
      die "could not read a 'Run Tests' result for ${GIT_COMMIT:0:12}.
     Either CI has not finished, it never ran for this commit, or this box
     cannot reach api.github.com. A skipped job reports nothing at all, which is
     indistinguishable from a green one here — so this refuses rather than
     guesses. Wait for CI, or:  DEPLOY_SKIP_CI_CHECK=1 $0 $*"
      ;;
    *)
      die "CI 'Run Tests' concluded '$CI_STATE' for ${GIT_COMMIT:0:12}.
     Fix it, or deploy deliberately with:  DEPLOY_SKIP_CI_CHECK=1 $0 $*"
      ;;
  esac
fi

# --- backup ------------------------------------------------------------------
say "Backing up the database"
STAMP="$(date +%F-%H%M%S)"
BACKUP_DIR="${DEPLOY_BACKUP_DIR:-/root}"
[ -d "$BACKUP_DIR" ] || die "backup directory $BACKUP_DIR does not exist — refusing to deploy without a backup"
BACKUP="${BACKUP_DIR%/}/keyflow-backup-${STAMP}.sql"
# Every tenant's data: created 0600 whatever the umask. /root (0700) used to
# hide a 0644 dump; DEPLOY_BACKUP_DIR can point anywhere.
( umask 077
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T db \
    sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' > "$BACKUP" ) \
  || die "pg_dump failed — refusing to deploy without a backup"
TABLES="$(grep -c '^CREATE TABLE' "$BACKUP" || true)"
[ "$TABLES" -gt 100 ] || die "backup has only $TABLES CREATE TABLE statements — it is not a real dump"
printf '    %s (%s tables, %s)\n' "$BACKUP" "$TABLES" "$(du -h "$BACKUP" | cut -f1)"

# --- rollback tags -----------------------------------------------------------
# Tag what is RUNNING before the build steals the :latest tag from it.
# The image ID a container was created from is not guaranteed to still resolve.
# Build the service image by hand and the old one loses its tag; the containerd
# store then collects it, while the container keeps running quite happily on
# layers that outlive it. On 2026-08-09 `docker tag` was handed a sha256 that no
# longer existed and, under `set -e`, took the whole deploy down — at the one
# step whose entire purpose is making failure survivable. `docker commit` was no
# use either: the parent content was already gone.
#
# So this step now reports rather than decides. A missing rollback image is
# worth knowing about; it is not worth refusing to deploy over, because the
# rollback that matters after migrations have run is the database dump plus a
# rebuild from the previous ref, and no image tag was ever going to supply that.
say "Tagging the current images for rollback"
for svc in $SERVICES; do
  cid="$(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps -q "$svc" 2>/dev/null || true)"
  [ -n "$cid" ] || { printf '    %s is not running — nothing to tag\n' "$svc"; continue; }

  img="$(docker inspect "$cid" --format '{{.Image}}' 2>/dev/null || true)"

  if [ -n "$img" ] && docker image inspect "$img" >/dev/null 2>&1 \
     && docker tag "$img" "keyflowos-${svc}:rollback" 2>/dev/null; then
    printf '    keyflowos-%s:rollback -> %s\n' "$svc" "${img:7:12}"
  elif docker commit "$cid" "keyflowos-${svc}:rollback" >/dev/null 2>&1; then
    printf '    keyflowos-%s:rollback <- committed from the running container\n' "$svc"
  else
    printf '    WARNING: no rollback image for %s — its source image is gone.\n' "$svc"
    printf '             To roll back: git checkout <previous ref>, rebuild, and\n'
    printf '             restore the dump above. Slower, but complete.\n'
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
#
# Polled, bounded, and judged on the whole body. This step used to sleep 8 s,
# read /healthz once and accept any body on the right commit, so on 2026-11-13
# it printed DEPLOYED while the web answered {"status":"degraded",
# "apiReachable":false} over a crash-looping API. Healthy is now all three of
# status "ok", apiReachable true and the commit just built (the web.healthz
# contract in scripts/verify-up-body.mjs, plus the commit), polled every
# VERIFY_INTERVAL_SEC for at most VERIFY_TIMEOUT_SEC. Anything short of that
# exits 1 with the rollback; DEPLOYED is printed only on a healthy body.
say "Verifying"
HEALTH_URL="https://keyflowos.com/api/healthz"
VERIFY_TIMEOUT_SEC=90
VERIFY_INTERVAL_SEC=5
MAX_POLLS=$(( VERIFY_TIMEOUT_SEC / VERIFY_INTERVAL_SEC ))
VERIFY_START=$SECONDS
DEADLINE=$(( VERIFY_START + VERIFY_TIMEOUT_SEC ))
EXPECTED="${GIT_COMMIT:0:12}"
HEALTH="" H_STATUS="" H_API="" RUNNING="" HEALTHY=0 POLL=0
while :; do
  POLL=$((POLL + 1))
  HEALTH="$(curl -sS --max-time 10 "$HEALTH_URL" 2>/dev/null | tr '\n' ' ' || true)"
  H_STATUS="$(health_string status "$HEALTH")"
  H_API="$(health_bool apiReachable "$HEALTH")"
  RUNNING="$(health_string commit "$HEALTH")"
  if [ "$H_STATUS" = "ok" ] && [ "$H_API" = "true" ] && [ "$RUNNING" = "$EXPECTED" ]; then
    HEALTHY=1
    break
  fi
  printf '    %2d/%d  status=%s apiReachable=%s commit=%s\n' "$POLL" "$MAX_POLLS" "${H_STATUS:-none}" "${H_API:-none}" "${RUNNING:-none}"
  if [ "$POLL" -ge "$MAX_POLLS" ] || [ "$SECONDS" -ge "$DEADLINE" ]; then break; fi
  sleep "$VERIFY_INTERVAL_SEC"
done
printf '    %s\n' "${HEALTH:0:600}"
WAITED="$POLL poll(s) over $(( SECONDS - VERIFY_START ))s"

if [ "$HEALTHY" -eq 1 ]; then
  printf '\n\033[32mDEPLOYED — /healthz reports %s, status ok, API reachable: what we just built.\033[0m\n' "$RUNNING"
else
  if [ -z "$HEALTH" ]; then
    printf '\n\033[31mNO ANSWER — %s did not answer (%s).\033[0m\n' "$HEALTH_URL" "$WAITED"
  elif [ -n "$RUNNING" ] && [ "$RUNNING" != "$EXPECTED" ]; then
    printf '\n\033[31mMISMATCH — after %s /healthz reports "%s", expected "%s".\033[0m\n' "$WAITED" "$RUNNING" "$EXPECTED"
    printf 'The containers may not have picked up the new image.\n'
  else
    printf '\n\033[31mNOT HEALTHY — after %s /healthz (commit %s) reports status=%s, apiReachable=%s.\033[0m\n' "$WAITED" "${RUNNING:-none}" "${H_STATUS:-none}" "${H_API:-none}"
    if [ "$H_API" != "true" ]; then
      printf 'The new web build is serving, but it cannot reach the API: the API is down or\n'
      printf 'restarting (a refusal at boot crash-loops it). This is not a deploy.\n'
    else
      printf 'The API answers, but the web reports itself degraded (its env field says why).\n'
      printf 'This is not a deploy.\n'
    fi
  fi
  printf 'See why:\n'
  printf '  docker compose --env-file %s -f %s ps\n' "$ENV_FILE" "$COMPOSE_FILE"
  printf '  docker compose --env-file %s -f %s logs --tail=100 api\n' "$ENV_FILE" "$COMPOSE_FILE"
  printf 'Roll back with:\n'
  printf '  docker tag keyflowos-api:rollback keyflowos-api:latest\n'
  printf '  docker tag keyflowos-web:rollback keyflowos-web:latest\n'
  printf '  docker compose --env-file %s -f %s up -d %s\n' "$ENV_FILE" "$COMPOSE_FILE" "$SERVICES"
  printf 'Database restore (only if a migration went wrong):\n'
  printf '  docker compose --env-file %s -f %s exec -T db \\\n' "$ENV_FILE" "$COMPOSE_FILE"
  printf '    sh -c '\''psql -U "$POSTGRES_USER" "$POSTGRES_DB"'\'' < %s\n' "$BACKUP"
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
