# Running KeyflowOS off Replit

This guide walks through running the KeyflowOS monorepo on any host: Docker
Compose locally, a single VM, or a managed PaaS (Fly.io, Render, Railway,
Vercel + a separate API host, etc.). The codebase no longer depends on any
Replit-specific runtime — only environment variables drive behavior.

> See `AUDIT_REPORT.md` for the full audit log of what was removed and why.

---

## 1. Prerequisites

| Tool | Version | Notes |
| --- | --- | --- |
| Node.js | 20.x LTS | Both apps target Node 20. |
| pnpm | 10.x | `corepack enable && corepack prepare pnpm@10.26.1 --activate`. |
| PostgreSQL | 14+ | Local, Supabase, RDS, Neon, etc. |
| S3-compatible bucket | — | AWS S3, Cloudflare R2, MinIO, Supabase Storage, Wasabi, etc. |
| Docker (optional) | 24+ | Only if using `docker compose`. |

---

## 2. Configure environment

```bash
cp .env.example .env
# edit .env — at minimum fill in DATABASE_URL, the SUPABASE_* trio,
# the S3_* trio (bucket + access key + secret), and the public URLs.
```

### URL precedence

Both apps resolve their own public URL through this chain — first match wins:

1. Explicit env (`APP_URL`, `API_URL`, `OAUTH_REDIRECT_BASE`)
2. `PUBLIC_BASE_URL` (umbrella for both)
3. `REPLIT_DEV_DOMAIN` (only set automatically inside a Repl)
4. `http://localhost:5000` (web) / `http://localhost:3001` (api)

`OAUTH_REDIRECT_BASE` is what Google/Meta/etc. callbacks point at. It defaults
to `APP_URL`; only override when the callback host differs from the user-facing
host (edge worker, separate marketing site, etc.).

For Next.js dev-mode CSRF protection on tunnels (ngrok, Cloudflare Access,
Tailscale Funnel), set `NEXT_PUBLIC_DEV_ORIGINS=host1,host2`.

---

## 3. Local development

### Bare metal (recommended for development)

```bash
pnpm install
pnpm --filter @keyflow/db run db:generate
pnpm --filter @keyflow/db exec prisma migrate deploy   # or `migrate dev`
pnpm dev                                               # web + api in parallel
```

For production-style starts on bare metal:

```bash
pnpm --filter @keyflow/db run db:generate
pnpm start                                             # web + api together
# or individually:
pnpm start:server                                      # api only (uses tsx)
pnpm start:web                                         # web only (next start)
```

> The API runs from TypeScript source via `tsx` in production. Workspace
> packages (`@keyflow/db`, `@keyflow/api`) export `.ts` directly, so a
> traditional `tsc → node dist/...` pipeline would `SyntaxError` on the
> first workspace import. Using `tsx` keeps everything portable without
> requiring a workspace-wide build refactor.

### Docker Compose (one-command stack incl. Postgres)

```bash
docker compose up --build
```

Brings up:
- `db`  — Postgres 16 with a named volume (`keyflow_db`)
- `api` — NestJS backend on `http://localhost:3001`
- `web` — Next.js frontend on `http://localhost:5000`

The compose file is meant for development convenience. For production, swap
`db` for managed Postgres and use the published `web` / `api` images.

---

## 4. Object storage

KeyflowOS stores uploads in any S3-compatible bucket. Set the `S3_*` group in
`.env` once; the adapter at `apps/server/src/core/object-storage/` handles
pre-signed uploads and tenant-aware ACLs.

| Provider | `S3_ENDPOINT` | `S3_REGION` | `S3_FORCE_PATH_STYLE` |
| --- | --- | --- | --- |
| AWS S3 | (leave empty) | `us-east-1` etc. | `false` |
| Cloudflare R2 | `https://<account>.r2.cloudflarestorage.com` | `auto` | `false` |
| MinIO (local) | `http://minio:9000` | `us-east-1` | `true` |
| Supabase Storage | `https://<proj>.supabase.co/storage/v1/s3` | `us-east-1` | `true` |
| Wasabi | `https://s3.<region>.wasabisys.com` | `<region>` | `false` |

Set `S3_PUBLIC_URL` to a CDN base (e.g. `https://cdn.example.com`) when you
want public objects to be served from a vanity domain instead of the raw
provider URL.

`PRIVATE_OBJECT_DIR` (default `private`) and `PUBLIC_OBJECT_SEARCH_PATHS`
(comma-separated, e.g. `public/branding,public/avatars`) are key prefixes
inside the single bucket — not GCS-style `/<bucket>/<path>` strings.

---

## 5. OAuth redirect configuration

Each Google product pulls its callback URL from this chain:

```
<PRODUCT>_REDIRECT_URI   →   OAUTH_REDIRECT_BASE + <default path>
```

| Variable | Default path appended |
| --- | --- |
| `GOOGLE_REDIRECT_URI` | `/api/crm/google/callback` |
| `GMAIL_REDIRECT_URI` | `/api/commerce/gmail/callback` |
| `CALENDAR_REDIRECT_URI` | `/bookings/calendar/callback` |
| `DRIVE_REDIRECT_URI` | `/api/drive/callback` |

Register each computed URL in the Google Cloud Console under the OAuth client
"Authorized redirect URIs" list before going live.

---

## 6. Production deployment recipes

### Single Docker host (Caprover, Coolify, Dokploy, raw `docker compose`)

```bash
docker build --target server -t keyflowos-api .
docker build --target web    -t keyflowos-web .
# Push to your registry and roll out via your orchestrator of choice.
```

Set `DATABASE_URL` / `DIRECT_URL` to the managed Postgres instance and the
`S3_*` trio to your provider. `APP_URL` / `API_URL` should match the user-
facing hostnames behind your reverse proxy (Traefik, Caddy, nginx, etc.).

### Fly.io

1. `fly launch --no-deploy --copy-config` for each app (separate `fly.toml`
   files for `web` and `api`).
2. In each `fly.toml`, set `dockerfile = "Dockerfile"` and override `build.target`:
   ```toml
   [build]
   dockerfile = "Dockerfile"
   build-target = "server"   # or "web" for the frontend
   ```
3. `fly secrets set DATABASE_URL=... SUPABASE_URL=... S3_BUCKET=...` (etc.).
4. `fly deploy`.

### Render / Railway

- Create two services from the same repo. For each, set the Docker build
  target (`server` or `web`).
- Wire them to a managed Postgres add-on (`DATABASE_URL`).
- Add the rest of the env vars under the service's "Environment" tab.

### Vercel (web) + any host (api)

The web app is a stock Next.js project — `vercel deploy` works out of the box
once `NEXT_PUBLIC_API_BASE_URL` and the `NEXT_PUBLIC_SUPABASE_*` pair are set
on Vercel. Host the API anywhere that runs a Node.js server.

---

## 7. Database migrations

```bash
# generate the Prisma client (always after a schema change)
pnpm --filter @keyflow/db run db:generate

# apply migrations against the database in $DATABASE_URL
pnpm --filter @keyflow/db exec prisma migrate deploy

# create a new migration during development
pnpm --filter @keyflow/db exec prisma migrate dev --name <change_summary>
```

Keep `DIRECT_URL` pointed at a non-pooled connection — Prisma migrate cannot
run through PgBouncer-style poolers.

---

## 8. Operational checklist before going live

- [ ] `DATABASE_URL` and `DIRECT_URL` point at a managed Postgres backup-enabled instance.
- [ ] `SUPABASE_JWT_SECRET`, `JWT_SECRET`, `BYOK_ENCRYPTION_SECRET`,
      `CREDENTIALS_ENCRYPTION_KEY`, `TRACKING_HMAC_SECRET`, `GOOGLE_STATE_SECRET`
      are long random strings — and rotated from any value ever shared with
      Replit Secrets if migrating from there.
- [ ] `APP_URL` / `API_URL` / OAuth redirect URIs are registered in every
      identity provider console (Google Cloud, Supabase, Stripe, etc.).
- [ ] S3 bucket has CORS configured to allow `APP_URL` origin for direct uploads.
- [ ] `CORS_ALLOWED_ORIGINS` lists every browser origin that calls the API.
- [ ] `NODE_ENV=production` is set on both runtime images.
- [ ] Health probes hit `/` on both the api (`:3001`) and web (`:5000`).
