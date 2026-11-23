# Adding a second Claude account as a packet-worker lane

Written 2026-11-23 by the orchestrator. A second account works through GitHub only: it cannot message the
orchestrator's sessions, and the orchestrator cannot message it. Issue #80 and the `pkt/V1-*` branches are the channel.

## 1. Give the account GitHub access

1. Sign in to claude.ai with the second account.
2. Open https://claude.ai/connect-github and connect a GitHub user that can push to `SaCH-PRO/KEYFLOWOS`.
3. On that page, check the Claude GitHub App is installed on `SaCH-PRO/KEYFLOWOS` (install it if not; an owner of
   the SaCH-PRO organization must approve).

## 2. Create its cloud environment

In claude.ai/code, open the cloud environment menu in a new session's title bar, choose to add an environment, and set:

- Name: `keyflowos`
- Repositories: `SaCH-PRO/KEYFLOWOS`
- Network: limited, package managers allowed, MCP servers allowed, extra allowed host `nodejs.org`
- Environment variables: none. Secrets: none (the lane never needs production or provider keys).
- Setup script: the script below, unchanged (it installs pgvector, starts a local Postgres 16 and Redis, installs the
  repo's pinned Node from nodejs.org with checksum verification, writes a local-only `.env`, and runs `pnpm install`).

```bash
set -e
apt-get install -y postgresql-16-pgvector >/dev/null 2>&1 || { apt-get update -qq && apt-get install -y postgresql-16-pgvector >/dev/null; }
HBA=/etc/postgresql/16/main/pg_hba.conf
sed -i -E 's/^(host\s+all\s+all\s+(127\.0\.0\.1\/32|::1\/128)\s+)scram-sha-256/\1trust/' "$HBA"
service postgresql start
service postgresql reload
su postgres -c "psql -tAc \"SELECT 1 FROM pg_roles WHERE rolname='keyflow'\"" | grep -q 1 \
  || su postgres -c "psql -c 'CREATE ROLE keyflow LOGIN SUPERUSER'"
PSQL="psql -h localhost -U keyflow"
$PSQL -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='keyflowos'" | grep -q 1 \
  || $PSQL -d postgres -c "CREATE DATABASE keyflowos TEMPLATE template0 LOCALE_PROVIDER icu ICU_LOCALE 'en-US' LOCALE 'C.UTF-8'"
for d in template1 keyflowos; do $PSQL -d "$d" -qc 'CREATE EXTENSION IF NOT EXISTS vector'; done
mkdir -p /tmp/kf-redis
redis-cli ping >/dev/null 2>&1 || redis-server --bind 127.0.0.1 --dir /tmp/kf-redis --daemonize yes
if [ -d KEYFLOWOS ]; then
  V=$(tr -d '[:space:]' < KEYFLOWOS/.nvmrc)
  if [ ! -x "/opt/node-$V/bin/node" ]; then
    T=$(mktemp -d); F="node-v$V-linux-x64.tar.xz"
    curl -fsSL -o "$T/$F" "https://nodejs.org/dist/v$V/$F"
    (cd "$T" && curl -fsSL "https://nodejs.org/dist/v$V/SHASUMS256.txt" | grep " $F\$" | sha256sum -c -)
    mkdir -p "/opt/node-$V" && tar -xJf "$T/$F" -C "/opt/node-$V" --strip-components=1 && rm -rf "$T"
  fi
  U='postgresql://keyflow@localhost:5432/keyflowos?schema=public'
  [ -f KEYFLOWOS/.env ] || printf 'DATABASE_URL=%s\nDIRECT_URL=%s\nREDIS_URL=redis://127.0.0.1:6379\nNODE_ENV=test\n' "$U" "$U" > KEYFLOWOS/.env
  (cd KEYFLOWOS && PATH="/opt/node-$V/bin:$PATH" pnpm install --frozen-lockfile)
fi
```

The `.env` it writes points only at the local database in the container. Never put a production or staging URL in
it.

## 3. Start the session

Start a new claude.ai/code session in that environment with `SaCH-PRO/KEYFLOWOS` selected, and paste the prompt in
section 4 as the first message. Prefer an Opus or Fable model; a session can run several packets in a row.

## 4. First message for the second account

```
You are a second packet-worker lane for the KEYFLOWOS v1 programme (repo SaCH-PRO/KEYFLOWOS). Another Claude account is the orchestrator; you cannot message it, so coordinate only through GitHub.

Read first, in order:
1. docs/development/agent-memory/README.md (on main)
2. docs/reconstruction/handoff/ORCHESTRATOR-STATE.md on branch pkt/V1-RULINGS-3E (standing rules, what is in flight)
3. the latest comments on issue #80
4. docs/development/agent-memory/PACKET-WORKER-BRIEF.md on pkt/V1-RULINGS-3E: follow it for every packet

Your lane: RR-* packets with priority P2 or P3 in docs/reconstruction/V1-PLAN-RECUT.json on pkt/V1-RULINGS-3E, whose depends_on are all done (node scripts/agent-memory/status.mjs --ref origin/pkt/V1-RULINGS-3E --stdout shows readiness). Never take P0/P1, FU-*, MEM-*, NAV-* or any packet outside RR-* P2/P3.

Claim rule: before starting a packet, run `git ls-remote origin refs/heads/pkt/V1-<ID>`. If it exists, skip it: it is taken. Otherwise create pkt/V1-<ID> from origin/main and push it immediately (that push is the claim), then post "CLAIM <ID> (second lane)" on issue #80.

For each packet: tests first, two independent reviews by fresh subagents until both accept, full server suite and `pnpm proof:release0 -- --skip-build` (must print R0 EXIT GATE MET) on your own local database, push after every commit, then post a RETURN on #80 with branch, head sha, RED and fix shas, files, suite totals, the R0 line, review findings and how each was closed. Do not open PRs and do not merge: the orchestrator reviews and merges in waves.

If Postgres or Redis is down (real ECONNREFUSED on 5432 or 6379, e.g. after a container restart), run `service postgresql start; redis-cli ping || redis-server --bind 127.0.0.1 --daemonize yes` and re-run; a run with real ECONNREFUSED does not count.

Never: production or staging, real provider traffic, weakening a test or gate, editing Release 0 evidence without an owner ruling, secrets in chat or code.
```

## 5. What the orchestrator does with the lane's work

It watches #80 for CLAIM and RETURN posts, runs its own two acceptance reviews on each returned branch, compacts
accepted packets into wave PRs and merges them under D-239. Lane work that skips the claim rule may be duplicated and
discarded.
