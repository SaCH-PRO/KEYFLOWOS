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
BACKUP="/root/keyflow-backup-${STAMP}.sql"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T db \
  sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' > "$BACKUP" \
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
