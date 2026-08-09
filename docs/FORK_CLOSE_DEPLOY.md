# Deploying KEYFLOWOS to production

Written as a plan on 2026-08-08. Rewritten on 2026-08-09, after the deploy, to
record what actually happened — including the two things the plan got wrong and
the three hazards it did not know about.

**Status: done.** Production runs `main`. The fork is closed and both branches
are retired.

---

## The deploy that happened

| | |
|---|---|
| When | 2026-08-09 13:33 UTC |
| Commit | `8394e9529c5e` |
| From | `hotfix/tenant-security-2026-08` @ `4e1b64a` (26 July, 221 commits behind) |
| Migrations applied | 6, after recording `0_baseline` as applied |
| Result | 2,174 routes mapped, zero errors, `/healthz` reporting the built commit |

Verified after: 31 applied migrations, 443 tables, `conversation_threads` and
`conversation_messages` confirmed dropped via `to_regclass`, the partial
expression index present, `user_identities` and `risc_events` created, the
genome gate string in the shipped web bundle, `/` 200 in 175ms.

---

## What the plan got wrong

**The baseline did not need regenerating.** The plan said not to carry
`0_baseline` into the merge because it was generated from `main`'s schema and
would be stale against the merged one. Measured: `migrate deploy` against a
virgin database applied all 14 migrations cleanly and produced 443 tables, and
`migrate diff --to-schema-datamodel` reported **"No difference detected."** The
migration set already reproduced the merged schema exactly. Nothing was
regenerated.

**The destructive migration destroyed nothing.** `20260806130000_retire_conversation_store`
drops `conversation_threads` and `conversation_messages`, and neither inbox
migration contains a single `INSERT` — so the plan flagged possible data loss.
It held one thread and one message: channel `whatsapp`, number `18685559999`
(`555` is the reserved fictional prefix), created 2026-07-26 at 18:36 — the day
of the previous deploy — never resolved in the fourteen days since, on the
`KEYFLOWOS` business itself. `key_inbox_threads` already held an equivalent
thread and message for the same business. A smoke test, already duplicated.

Both were only knowable by measuring. Neither was knowable by reading.

---

## The procedure, as corrected

### 0. Facts about the box you will otherwise discover the hard way

- **No `node` on the host.** Prisma runs inside the `api` service container:
  `docker compose --env-file .env.production -f docker-compose.production.yml run --rm -T api pnpm --filter @keyflow/db exec prisma <cmd>`
- **Migrations are baked into the image at build time** — there is no volume
  mount. A migration the running image does not contain cannot be resolved
  against. This is why the build has to happen before the resolve.
- **`/opt/keyflowos` is a single-branch clone.** A bare `git fetch` fails
  looking for a long-deleted ref. Always `git fetch origin <branch>`.
- **Postgres credentials are `keyflow`/`keyflow`, not `postgres`.** Read them
  with `docker exec keyflowos-db-1 env | grep -E "^POSTGRES_(USER|DB)="` — that
  pattern deliberately excludes the password.
- The app container is `keyflowos-api-1`. The compose service is `api`.

### 1. Check what a destructive migration would destroy

Read every pending migration for `DROP TABLE`, `DROP COLUMN` and `UPDATE ... SET
x = NULL`. For each, count the rows first. Then check whether the data already
exists in its replacement — that is the question that actually settles it, and
it is one query.

### 2. Back up, and verify the backup

```bash
docker exec keyflowos-db-1 pg_dump -U keyflow keyflow > /root/pre-deploy-$(date +%F-%H%M%S).sql
grep -c "^CREATE TABLE" /root/pre-deploy-*.sql     # expect ~443, not 0
```

A dump that exists is not a dump that worked. The count is the check.

### 3. Check out the ref, then run the name gate

```bash
cd /opt/keyflowos && git fetch origin main && git checkout -B main FETCH_HEAD
```

If `0_baseline` is pending against a populated database, it will run its 433
unguarded `CREATE TABLE`s, hit `42P07`, record a failed migration, and block
every future deploy with P3009. It must be recorded as applied without running —
but only if that is true. Prove it:

```bash
grep -oE '^CREATE TABLE "[^"]+"' packages/db/prisma/migrations/0_baseline/migration.sql \
  | sed 's/CREATE TABLE "//;s/"$//' | sort -u > /tmp/baseline-tables.txt
docker exec keyflowos-db-1 psql -U keyflow -d keyflow -tAc \
  "select table_name from information_schema.tables where table_schema='public'" \
  | tr -d '\r' | sort -u > /tmp/prod-tables.txt
comm -23 /tmp/baseline-tables.txt /tmp/prod-tables.txt
```

Empty output means production contains every table the baseline describes. On
2026-08-09: 433 of 433 present, production a strict superset at 443.

Validate the extraction before trusting it — run it against a database built
from the merged migrations, where it should correctly report the two tables
`retire_conversation_store` drops. A check that cannot report a known absence
proves nothing about an unknown one.

### 4. Build, then resolve, then deploy

```bash
export GIT_COMMIT=$(git rev-parse HEAD)
docker compose --env-file .env.production -f docker-compose.production.yml build api
docker compose --env-file .env.production -f docker-compose.production.yml run --rm -T api \
  pnpm --filter @keyflow/db exec prisma migrate resolve --applied 0_baseline
docker compose --env-file .env.production -f docker-compose.production.yml run --rm -T api \
  pnpm --filter @keyflow/db exec prisma migrate status
./scripts/deploy.sh main
```

Setting `GIT_COMMIT` to the value `deploy.sh` will use means its build hits the
cache rather than repeating an eight-minute compile.

`migrate status` before the resolve is worth the thirty seconds: it states
Prisma's own view of the history, and if that disagrees with your analysis, stop.
Before: "The last common migration is: null". After: the real one.

The 17 rows naming migrations that no longer exist locally are expected — `main`
squashed them into `0_baseline`, and `migrate deploy` ignores applied rows it
cannot find.

### 5. Verify

```bash
curl -s https://api.keyflowos.com/healthz          # commit must be what you built
docker logs keyflowos-api-1 --since 10m | grep -ciE "Mapped \{"   # routes, not zero
docker logs keyflowos-api-1 --since 10m | grep -iE "error|fatal"  # want nothing
```

Then check anything `migrate diff` cannot see. Prisma's datamodel cannot express
partial or expression indexes, so they appear in neither the expected delta nor
the diff output, before or after:

```bash
docker exec keyflowos-db-1 psql -U keyflow -d keyflow -c \
  "\di bank_transactions_account_external_id_key"
```

---

## Hazards discovered on 2026-08-09

**Hand-building an image before a deploy breaks rollback tagging.** Building
`api` by hand took the `:latest` tag off the running container's image; the
containerd store then collected it, while the container kept serving from layers
that outlived it. `deploy.sh` inspects the running container for an image ID to
tag, got a sha256 that no longer resolved, and under `set -euo pipefail` the
deploy died — at the one step whose entire purpose is making failure survivable.
`docker commit` could not snapshot it either; the parent content was gone too.

Fixed in `8394e952`: tagging now reports rather than decides, falls back to
`docker commit`, and can never abort a deploy. The step is a convenience, and it
should not be able to stop a deploy it cannot help.

**An image tag was never a sufficient rollback anyway.** Once migrations have
run, the previous build against the new schema is its own kind of broken — the
old code writes to `conversation_threads`, which no longer exists. A real
rollback is the dump plus a rebuild from the previous ref.

**Production is single-tenant.** One business, one user, one membership. A
cross-tenant probe cannot demonstrate anything here; the guard specs on the
deployed commit are the stronger evidence.

---

## Rollback

Before `deploy.sh` starts containers: nothing has changed. Walk away.

After, code only:

```bash
docker tag keyflowos-web:rollback keyflowos-web:latest
docker compose --env-file .env.production -f docker-compose.production.yml up -d web
```

After, with migrations applied — the real path:

```bash
git checkout <previous-ref> && export GIT_COMMIT=$(git rev-parse HEAD)
docker compose --env-file .env.production -f docker-compose.production.yml build api web
docker compose --env-file .env.production -f docker-compose.production.yml exec -T db \
  sh -c 'psql -U "$POSTGRES_USER" "$POSTGRES_DB"' < /root/pre-deploy-<stamp>.sql
docker compose --env-file .env.production -f docker-compose.production.yml up -d api web
```

Slower than a tag swap. Complete, which a tag swap is not.

---

## Gates that must be green before deploying

| Gate | What it catches |
|---|---|
| `pnpm typecheck --continue` | the `--continue` matters: turbo stops at the first failure and hides the rest |
| `apps/server` vitest | 3,304 tests including the boot gate |
| `apps/web` vitest | mount gate, nav, fabricated screens, tool routes |
| `pnpm install --frozen-lockfile` | a lockfile override with no `package.json` entry may be load-bearing |

`check-tool-routes` used to be a standalone script outside CI, which is how
twelve broken tool routes reached a green pipeline. It is a spec now.

**Never read a build's exit code through a pipe.** `pnpm typecheck | tail`
returns tail's status. Two runs looked green here that were not.
