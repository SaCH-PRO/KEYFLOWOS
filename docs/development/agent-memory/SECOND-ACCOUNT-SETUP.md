# Adding a second Claude account as a packet-worker lane

Written 2026-11-23 by the orchestrator (control room updated to #273 under D-319; #80 is archived at the 2,500-comment cap). A second account works through GitHub only: it cannot message the
orchestrator's sessions, and the orchestrator cannot message it. Issue #273 and the `pkt/V1-*` branches are the channel.

## 1. Give the account GitHub access

1. Sign in to claude.ai with the second account.
2. Open https://claude.ai/connect-github and connect a GitHub user that can push to `KEYFLOWOS/KEYFLOWOS`.
3. On that page, check the Claude GitHub App is installed on `KEYFLOWOS/KEYFLOWOS` (install it if not; an owner of
   the KEYFLOWOS organization must approve).

## 2. Create its cloud environment

In claude.ai/code, open the cloud environment menu in a new session's title bar, choose to add an environment, and set:

- Name: `keyflowos`
- Repositories: `KEYFLOWOS/KEYFLOWOS`
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

Start a new claude.ai/code session in that environment with `KEYFLOWOS/KEYFLOWOS` selected, and paste the prompt in
section 4 as the first message. Prefer an Opus or Fable model; a session can run several packets in a row.

## 4. First message for the second account

```
You are a packet-worker lane for the KEYFLOWOS v1 programme (repo KEYFLOWOS/KEYFLOWOS). Another session is the orchestrator; you cannot message it, so coordinate only through GitHub (issue #273 and the branch coord/board; #80 is archived at 2,500 comments, roll over at 2,350).

The plan ref: origin/main once PR #230 (the rulings and the wedge re-cut) is merged; until then origin/wave/v1-rulings-3n. ORCHESTRATOR-STATE.md on that ref names the ref if it has changed.

Read first, in order:
1. docs/development/agent-memory/README.md on the plan ref
2. BOARD.md at the root of branch coord/board (who owns what; the merge order)
3. docs/reconstruction/handoff/ORCHESTRATOR-STATE.md on the plan ref (standing rules, what is in flight)
4. the latest comments on issue #273
5. docs/development/agent-memory/CHECKLISTS.md (A at every start; B for every packet) and PACKET-WORKER-BRIEF.md on the plan ref

Your lane: board rows marked "any lane may claim", or packets in docs/reconstruction/V1-PLAN-RECUT.json with "track": "launch" (D-263) whose depends_on are all done (node scripts/agent-memory/status.mjs --ref <plan ref> --stdout shows readiness; it lists every track, so check the packet's track yourself). Never take a follow-on packet unless the owner assigns it to you on #273, and never a row another lane owns.

Claim (CHECKLISTS B1): from origin/main (or the stack top it depends on), make a claim commit no other lane can make, `git commit --allow-empty -m "claim <ID> <your lane> $(date -u +%FT%T.%NZ)"`, and push it with `git push --force-with-lease=refs/heads/pkt/V1-<ID>: origin HEAD:refs/heads/pkt/V1-<ID>`, which is refused if the branch exists. Then `git ls-remote origin refs/heads/pkt/V1-<ID>` must print your own `git rev-parse HEAD`. If the push is refused or the sha is not yours, the packet is taken: pick another, and never delete or force-push its branch. Post "CLAIM <ID>" on issue #273 and set the board row's owner to your lane.

For each packet (D-265): tests first, two independent reviews by fresh subagents until both accept, the tests of every folder you touch (check the exit code, not only the pass count) and the type check. Run the full server suite and `pnpm proof:release0 -- --skip-build` (must print R0 EXIT GATE MET) on your own local database only when the packet edits a Release 0 bound suite or a manifest-bound file; otherwise they run at the wave head. Push after every commit, then post a RETURN on #273 with branch, head sha, RED and fix shas, files, the proof totals as printed, review findings and how each was closed. Do not open PRs and do not merge: the orchestrator reviews and merges in waves (D-272 merge order on the board).

If Postgres or Redis is down (real ECONNREFUSED on 5432 or 6379, e.g. after a container restart), run `service postgresql start; redis-cli ping || redis-server --bind 127.0.0.1 --daemonize yes` and re-run; a run with real ECONNREFUSED does not count.

Never: production or staging, real provider traffic, weakening a test or gate, editing Release 0 evidence without an owner ruling (an r0_register AMEND), secrets in chat or code.
```

## 5. What the orchestrator does with the lane's work

It watches #273 for CLAIM and RETURN posts, runs its own two-lens acceptance review on each returned branch (D-241,
`ACCEPTANCE-REVIEW-BRIEF.md`), compacts
accepted packets into wave PRs and merges them under D-239. Lane work that skips the claim rule may be duplicated and
discarded.
