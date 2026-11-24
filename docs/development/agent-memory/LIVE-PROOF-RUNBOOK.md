# Live proof runbook (server proof, live journeys, browser sweeps)

How the Claude lane ran every proof in November 2026, written down so any account, AI or tool can run the same
proof the same way.

The scripts below are generic: replace `$WT` with a git worktree path and `$OUT` with a log folder. No secret is
written here. The local JWT secret is a random string you generate once.

## 0. One-time machine setup

- **Node:** 22.23.4, the version in `.nvmrc`. Put it first on `PATH`, for example
  `export PATH=/opt/node-22.23.4/bin:$PATH`. Check with `node -v`.
- **Postgres 16** with pgvector, and **Redis**, on localhost. A container restart stops both. Check them before
  every proof run and restart them if needed:
  ```bash
  pg_isready -h 127.0.0.1 -p 5432 || service postgresql start
  redis-cli ping || service redis-server start
  ```
  With Docker: `docker compose up -d db redis`, then `CREATE EXTENSION IF NOT EXISTS vector` in `keyflowos`,
  `template1` and `keyflowos_e2e`.
- **Two databases:**
  - `keyflowos` serves the server suite and Release 0, through `.env` at the repo root.
  - `keyflowos_e2e` serves the live browser runs, so they never touch the suite's data.

  Migrate both:
  ```bash
  (cd packages/db && npx prisma migrate deploy --schema=./prisma/schema.prisma)
  (cd packages/db && DATABASE_URL=postgresql://keyflow:keyflow@127.0.0.1:5432/keyflowos_e2e \
     DIRECT_URL=postgresql://keyflow:keyflow@127.0.0.1:5432/keyflowos_e2e npx prisma migrate deploy --schema=./prisma/schema.prisma)
  ```
- **`.env`:** a working local `.env` at the repo root, with DATABASE_URL, DIRECT_URL and REDIS_URL pointing at the
  local services. A plain copy of `.env.example` is not valid. Release 0 **must** run with it loaded. A run without
  it rejects with "Environment variable not found: DATABASE_URL" and does not count.
- **Playwright 1.59** looks for browser builds 1217. If only 1243 is installed, alias them:
  ```bash
  ln -s /opt/pw-browsers/chromium-1243 /opt/pw-browsers/chromium-1217
  ln -s /opt/pw-browsers/chromium_headless_shell-1243 /opt/pw-browsers/chromium_headless_shell-1217
  ```
- **The local JWT secret** for the live harness. Generate it once:
  `openssl rand -hex 32 > ~/.kf-e2e-jwt-secret`.

## 1. Server proof at one exact head (D-265)

**When:** per wave head; per packet only when the packet changes a server file, a Release 0 bound suite or a
manifest-bound file.

**Rules:**
- Run it in a dedicated detached worktree of the head (`git worktree add --detach <new path> $H`), never in a
  checkout someone else is using, strictly one head at a time.
- Check the head before and after each step.
- Never run two proof runs, or a reviewer's server integration tests, against the same database at once. Fixtures
  collide.

```bash
set -euo pipefail                      # a failed step stops the chain; the run does not count
H=<sha>; cd /path/to/dedicated/worktree
test "$(git rev-parse HEAD)" = "$(git rev-parse $H)"          # the worktree is at the head
test -z "$(git status --porcelain)"                           # and clean
set +e                                 # from here each step reports its own exit code
(cd apps/server && NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit -p tsconfig.json); echo TSC=$?
pnpm --filter server build; echo BUILD=$?
(cd apps/server && set -a && . ../../.env && set +a && pnpm vitest run) > $OUT/vitest-$H.log 2>&1; echo SUITE=$?
grep -E 'Test Files|Tests  ' $OUT/vitest-$H.log | tail -2
(cd apps/server && set -a && . ../../.env && set +a && pnpm proof:release0 -- --skip-build) > $OUT/r0-$H.log 2>&1; echo R0=$?
grep -E 'proof:release0:|run-manifests: [0-9]+ of' $OUT/r0-$H.log | tail -3     # must say "R0 EXIT GATE MET" and "exact-head receipt"
test "$(git rev-parse HEAD)" = "$(git rev-parse $H)" || echo "HEAD MOVED: the run does not count"
```

- The full suite takes about 25 minutes, and Release 0 about 5.
- A run counts only if it finished on the same head it started on, with services up and `.env` loaded.
- A single tool call often times out after 10 minutes, so run the chain as one background script and read its log.

## 2. Web proof per packet

```bash
cd $WT/apps/web
npx vitest run <the packet's touched folders>
npx eslint <changed files>
NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit -p tsconfig.json   # one pre-existing error is allowed: "Cannot find type definition file for 'next'" in symlinked worktrees
npx vitest run                                                              # the whole web suite, about 2 minutes
```

A worktree may symlink `node_modules`, `apps/*/node_modules` and `packages/*/dist` from the main checkout for unit
tests. A production web build needs a real install (section 3).

## 3. Live browser runs (journeys and sweeps)

**Needs:**
- a worktree with a **real** `pnpm install --frozen-lockfile --offline` (Turbopack refuses symlinked `node_modules`);
- `pnpm --filter @keyflow/shared --filter @keyflow/db --filter @keyflow/api build`;
- the server built at the same head.

```bash
cd $WT && pnpm --filter server build
cd $WT/apps/web && rm -rf .next && NEXT_PUBLIC_API_BASE_URL=http://localhost:3001 NEXT_PUBLIC_SUPABASE_URL= \
  NEXT_PUBLIC_SUPABASE_ANON_KEY= NEXT_PUBLIC_SITE_URL= pnpm run build

# The API on the e2e database (a clean environment; AI and schedulers off)
cd $WT/apps/server && env -i PATH="$PATH" HOME="$HOME" \
  DATABASE_URL=postgresql://keyflow:keyflow@127.0.0.1:5432/keyflowos_e2e DIRECT_URL=postgresql://keyflow:keyflow@127.0.0.1:5432/keyflowos_e2e \
  REDIS_URL=redis://127.0.0.1:6379 NODE_ENV=test PORT=3001 AI_DISABLED=1 DISABLE_SCHEDULERS=1 HIBP_DISABLED=true \
  SUPABASE_JWT_SECRET="$(cat ~/.kf-e2e-jwt-secret)" RATE_LIMIT_MAX_REQUESTS=100000 KEY_DISABLED= \
  NEXT_PUBLIC_APP_URL=http://127.0.0.1:5000 node dist/main.js > $OUT/e2e-api.log 2>&1 &
API_PID=$!
for i in $(seq 1 90); do curl -fsS http://localhost:3001/healthz >/dev/null && break; sleep 2; done
curl -fsS http://localhost:3001/healthz >/dev/null || { echo "API did not start: read $OUT/e2e-api.log"; kill $API_PID; }

# The browser runs (the harness starts the standalone web server on 5000)
cd $WT/apps/web
export E2E_LIVE=1 E2E_VARIANT=ai-disabled E2E_API_URL=http://localhost:3001 E2E_WEB_COMMAND=standalone \
  E2E_BASE_URL=http://127.0.0.1:5000 E2E_PORT=5000 E2E_JWT_SECRET="$(cat ~/.kf-e2e-jwt-secret)"
pnpm exec playwright test e2e/journeys/d-quote-deposit.spec.ts e2e/journeys/e-invoice-paid.spec.ts \
  --project=phone --project=desktop --trace off
pnpm exec playwright test e2e/sweep-<name>.spec.ts --project=chromium --trace off      # sweeps hold both widths inside
```

**Mocked sweeps** (the mocked CI job): build with `NEXT_PUBLIC_API_BASE_URL=http://api.test.local` and run
`E2E_WEB_COMMAND=standalone E2E_PORT=5100 pnpm exec playwright test e2e/<spec> --project=chromium`. No API is
needed; the spec answers `api.test.local` with `page.route`.

**RED in a browser:**
- Build the packet's base, copy only the new spec in (`git checkout <head> -- apps/web/e2e/<spec>`), run it, and
  record the failure line.
- Then build the head and run it green.
- Where the base cannot run the spec (a selector that only exists at the head), add a throwaway probe with
  structural selectors to show the bug, and do not commit the probe.

**Stop the API when finished:** `kill $API_PID` (only the API you started; never `pkill`, which also stops
another lane's API or proof run on the same machine). Do not stop it while a run is using it: that turns every case
into a connection failure.

## 4. Reviews

Two fresh agents work in **detached** worktrees of the exact head (`git worktree add --detach <path> <sha>`), with
symlinked dependencies. They never check out, stash or commit in anyone else's worktree.

- One reads with the security / tenancy / process lens, the other with the correctness / regression lens.
- Each gets `docs/development/agent-memory/ACCEPTANCE-REVIEW-BRIEF.md`, the bundle
  (`node scripts/agent-memory/bundle.mjs <ID> --ref origin/main`; before PR #230 merges, `--ref origin/wave/v1-rulings-3n`), the diff range, and the worker's
  claims and deviations. Never give them the worker's conclusions as facts.
- Close every real finding tests-first, then get a confirmation review of the delta
  (`CONFIRMATION-REVIEW-BRIEF.md`).
- While a server proof is running, reviewers must not run server integration tests: they share the database.
