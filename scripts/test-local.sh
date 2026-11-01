#!/usr/bin/env bash
# One-command local test run (R0-16-PROOF-BINDING).
#
#   pnpm test:local [-- options]          (bash scripts/test-local.sh [options])
#
# Steps, in order. Admission always runs first and cannot be skipped; nothing
# else runs when it refuses:
#   admit      resource admission by scripts/proof-admission/admit-resources.mjs:
#                in a worktree: --packet <id> (local-worktree-resources.json:
#                  only kf_wt_<packet> on localhost and the packet's Redis index);
#                in CI (CI=true, GITHUB_ACTIONS=true): ci-resources.json;
#                in a main checkout: the same local-only rules as CI (database
#                  keyflowos on localhost, the docker-compose default) without
#                  the CI identity.
#              A non-local DATABASE_URL, DIRECT_URL or REDIS_URL is refused here.
#   compose    docker compose up -d db redis
#   generate   pnpm db:generate
#   workspace  pnpm --filter @keyflow/shared --filter @keyflow/db --filter @keyflow/api build
#   deploy     pnpm db:deploy
#   build      pnpm --filter server build       (dist/main.js, which some suites spawn)
#   vitest     the --suite selection:
#                release0 (default)  pnpm --filter server proof:manifests --skip-build
#                                    every case manifest's suites in one vitest run,
#                                    each manifest judged at HEAD
#                server              pnpm --filter server test:ci (the whole server suite)
#                <file> ...          pnpm --filter server exec vitest run <file> ...
#                                    (paths relative to apps/server; --suite repeats)
#
# Options:
#   --plan               print the steps and exit; runs nothing (admission included)
#   --suite <s>          release0 | server | a test file (repeatable)
#   --packet <id>        the packet this worktree was provisioned for
#                        (scripts/worktree-resources.sh provision <id>); required in a worktree
#   --skip <s>[,<s>]     skip compose, generate, workspace, deploy or build
#   --no-compose         same as --skip compose (services already running)
#   -h, --help
#
# DATABASE_URL, DIRECT_URL, REDIS_URL and KF_WT_PACKET come from the shell or,
# when the shell does not export them, from the repo-root .env (the file the
# integration suites load). As with dotenv, an exported value wins. No value
# is printed: the admission receipt names hosts and database names only.
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
ADMIT="$ROOT/scripts/proof-admission/admit-resources.mjs"
CI_MANIFEST="$ROOT/scripts/proof-admission/manifests/ci-resources.json"

usage() {
  sed -n '2,/^set -euo pipefail$/p' "${BASH_SOURCE[0]}" | sed -e '$d' -e 's/^# \{0,1\}//'
}

die() {
  echo "test-local: $*" >&2
  exit 2
}

plan=false
packet=''
suites=()
skips=()
while [[ $# -gt 0 ]]; do
  case $1 in
    --) ;; # pnpm test:local -- <options> may pass the separator through
    --plan) plan=true ;;
    --suite)
      [[ $# -ge 2 && -n $2 ]] || die '--suite needs a value'
      suites+=("$2")
      shift
      ;;
    --suite=*) suites+=("${1#--suite=}") ;;
    --packet)
      [[ $# -ge 2 && -n $2 ]] || die '--packet needs a value'
      packet=$2
      shift
      ;;
    --packet=*) packet=${1#--packet=} ;;
    --skip)
      [[ $# -ge 2 && -n $2 ]] || die '--skip needs a value'
      IFS=',' read -r -a more <<< "$2"
      skips+=("${more[@]}")
      shift
      ;;
    --skip=*)
      IFS=',' read -r -a more <<< "${1#--skip=}"
      skips+=("${more[@]}")
      ;;
    --no-compose) skips+=(compose) ;;
    -h | --help)
      usage
      exit 0
      ;;
    *) die "unknown option $1 (see --help)" ;;
  esac
  shift
done

for s in ${skips[@]+"${skips[@]}"}; do
  case $s in
    compose | generate | workspace | deploy | build) ;;
    admit) die 'resource admission cannot be skipped' ;;
    *) die "--skip names an unknown step: $s (compose, generate, workspace, deploy, build)" ;;
  esac
done
skipped() {
  local s
  for s in ${skips[@]+"${skips[@]}"}; do [[ $s == "$1" ]] && return 0; done
  return 1
}

# --- where are we: a worktree, CI, or a main checkout ----------------------
git_dir=$(cd "$ROOT" && cd "$(git rev-parse --git-dir)" && pwd -P)
common_dir=$(cd "$ROOT" && cd "$(git rev-parse --git-common-dir)" && pwd -P)
if [[ $git_dir != "$common_dir" ]]; then
  mode=worktree
elif [[ ${CI:-} == true && ${GITHUB_ACTIONS:-} == true ]]; then
  mode=ci
else
  mode=main
fi

# --- the vitest step ---------------------------------------------------------
[[ ${#suites[@]} -gt 0 ]] || suites=(release0)
if [[ ${#suites[@]} -eq 1 && ${suites[0]} == release0 ]]; then
  vitest_cmd=(pnpm --filter server proof:manifests --skip-build)
elif [[ ${#suites[@]} -eq 1 && ${suites[0]} == server ]]; then
  vitest_cmd=(pnpm --filter server test:ci)
else
  for s in "${suites[@]}"; do
    [[ $s != release0 && $s != server ]] || die "--suite $s cannot be combined with other suites"
    [[ $s != -* ]] || die "--suite takes a test file, not an option: $s"
  done
  vitest_cmd=(pnpm --filter server exec vitest run "${suites[@]}")
fi

case $mode in
  worktree) admit_cmd=(node "$ADMIT" --packet "${packet:-<packet-id>}") ;;
  ci) admit_cmd=(node "$ADMIT" --manifest "$CI_MANIFEST") ;;
  main) admit_cmd=(node --input-type=module -e '<admitResources(ci-resources.json rules, no CI identity) from admit-resources.mjs>') ;;
esac

steps=(admit compose generate workspace deploy build vitest)
step_cmd() {
  case $1 in
    admit) printf '%s ' "${admit_cmd[@]}" ;;
    compose) printf '%s' 'docker compose up -d db redis' ;;
    generate) printf '%s' 'pnpm db:generate' ;;
    workspace) printf '%s' 'pnpm --filter @keyflow/shared --filter @keyflow/db --filter @keyflow/api build' ;;
    deploy) printf '%s' 'pnpm db:deploy' ;;
    build) printf '%s' 'pnpm --filter server build' ;;
    vitest) printf '%s ' "${vitest_cmd[@]}" ;;
  esac
}

if $plan; then
  echo "test-local plan ($mode checkout at $ROOT):"
  n=0
  for s in "${steps[@]}"; do
    n=$((n + 1))
    if [[ $s != admit ]] && skipped "$s"; then
      printf '  %d. %-9s (skipped) %s\n' "$n" "$s" "$(step_cmd "$s")"
    else
      printf '  %d. %-9s %s\n' "$n" "$s" "$(step_cmd "$s")"
    fi
  done
  [[ $mode != worktree || -n $packet ]] || echo '  note: a worktree run needs --packet <id>'
  exit 0
fi

# --- environment: exported values win over the repo-root .env ----------------
load_env_file() {
  local file=$1 line key value
  [[ -f $file ]] || return 0
  while IFS= read -r line || [[ -n $line ]]; do
    [[ $line =~ ^[[:space:]]*(export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*)[[:space:]]*=[[:space:]]*(.*)$ ]] || continue
    key=${BASH_REMATCH[2]}
    value=${BASH_REMATCH[3]}
    case $key in DATABASE_URL | DIRECT_URL | REDIS_URL | KF_WT_PACKET) ;; *) continue ;; esac
    [[ -z ${!key+set} ]] || continue
    if [[ $value =~ ^\"(.*)\"[[:space:]]*$ || $value =~ ^\'(.*)\'[[:space:]]*$ ]]; then
      value=${BASH_REMATCH[1]}
    else
      value=${value%%[[:space:]]#*}
      value=${value%"${value##*[![:space:]]}"}
    fi
    export "$key=$value"
  done < "$file"
}
load_env_file "$ROOT/.env"

# --- 1. admission ------------------------------------------------------------
echo "test-local: admitting resources ($mode checkout)"
case $mode in
  worktree)
    [[ -n $packet ]] || die "this is a worktree: pass --packet <id> (the id scripts/worktree-resources.sh provisioned it for); resources are admitted per packet"
    node "$ADMIT" --packet "$packet" || die 'resource admission refused this environment (see the receipt above); nothing was run'
    ;;
  ci)
    node "$ADMIT" --manifest "$CI_MANIFEST" || die 'resource admission refused this environment (see the receipt above); nothing was run'
    ;;
  main)
    [[ -z $packet ]] || die '--packet applies to a worktree; this is a main checkout'
    KF_TL_ADMIT="$ADMIT" KF_TL_POLICY="$CI_MANIFEST" node --input-type=module -e '
      import { readFileSync } from "node:fs";
      import { pathToFileURL } from "node:url";
      const { admitResources } = await import(pathToFileURL(process.env.KF_TL_ADMIT).href);
      // The CI rules (local hosts and ports, user keyflow, database keyflowos)
      // without the CI identity: a main checkout is not a CI runner.
      const policy = { ...JSON.parse(readFileSync(process.env.KF_TL_POLICY, "utf8")), environment: "local-main-checkout", requiredEnv: {} };
      const result = admitResources(policy, process.env);
      console.log(JSON.stringify(result));
      process.exit(result.status === "ADMITTED_NONPRODUCTION" ? 0 : 2);
    ' || die 'resource admission refused this environment (see the receipt above); nothing was run'
    ;;
esac

# --- 2..7 ----------------------------------------------------------------------
run_step() {
  local name=$1
  shift
  if skipped "$name"; then
    echo "test-local: [$name] skipped"
    return 0
  fi
  echo "test-local: [$name] $*"
  (cd "$ROOT" && "$@")
}

run_step compose docker compose up -d db redis
run_step generate pnpm db:generate
run_step workspace pnpm --filter @keyflow/shared --filter @keyflow/db --filter @keyflow/api build
run_step deploy pnpm db:deploy
run_step build pnpm --filter server build
echo "test-local: [vitest] ${vitest_cmd[*]}"
(cd "$ROOT" && "${vitest_cmd[@]}")
