# KEYFLOWOS Deployment Guide

> ## ⚠️ This is not how production is deployed
>
> **Production is a Hetzner VPS at `37.27.27.0` running Docker Compose** from
> `/opt/keyflowos`, behind Caddy. Deploy with `./scripts/deploy.sh <git-ref>` on
> the box. The Render workspace referenced below was deleted on 2026-08-08 after
> it was found returning 502 with no database credentials — it had never served a
> request.
>
> Read `render.yaml` for the measured build constraints that still apply
> (memory ceilings, why `tsx` cannot start the server, why `NODE_ENV=production`
> breaks the install), and `docs/CRITICAL_ANALYSIS_2026-08.md` for why the deploy
> tooling lives on a branch `main` does not have.
>
> Below is kept for the platform-agnostic parts, which remain useful.

> Platform-agnostic deploy instructions for KEYFLOWOS. No Replit required.

---

## Table of Contents

1. [Local Development (Docker)](#local-development-docker)
2. [Vercel + Railway (Recommended)](#vercel--railway-recommended)
3. [Render](#render)
4. [Fly.io](#flyio)
5. [Environment Variables Reference](#environment-variables-reference)
6. [Migrating from Replit](#migrating-from-replit)

---

## Local Development (Docker)

The fastest way to get a complete local stack.

### Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop)
- [pnpm](https://pnpm.io/installation) (`npm i -g pnpm`)
- Node 20.x (see `.nvmrc`)

### 1. Clone & Install

```bash
git clone https://github.com/SaCH-PRO/KEYFLOWOS.git
cd KEYFLOWOS
pnpm install
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your values. For local Docker, these defaults work out of the box:

```env
APP_URL=http://localhost:5000
API_URL=http://localhost:3001
NEXT_PUBLIC_SITE_URL=http://localhost:5000
NEXT_PUBLIC_API_BASE_URL=http://localhost:3001

DATABASE_URL=postgresql://keyflow:keyflow@localhost:5432/keyflowos?schema=public
DIRECT_URL=postgresql://keyflow:keyflow@localhost:5432/keyflowos?schema=public

REDIS_URL=redis://localhost:6379

# Supabase (required for auth)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_JWT_SECRET=your-jwt-secret
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key

# S3-compatible storage (MinIO for local)
S3_BUCKET=keyflowos-uploads
S3_REGION=us-east-1
S3_ENDPOINT=http://localhost:9000
S3_ACCESS_KEY_ID=minioadmin
S3_SECRET_ACCESS_KEY=minioadmin
S3_FORCE_PATH_STYLE=true
S3_PUBLIC_URL=http://localhost:9000/keyflowos-uploads
```

### 3. Start Infrastructure

```bash
docker compose up -d db redis minio
```

### 4. Database Setup

```bash
# Generate Prisma client
cd packages/db && npx prisma generate

# Run migrations
npx prisma migrate dev

# Seed (optional)
npx prisma db seed
```

### 5. Start Dev Servers

```bash
# From repo root — starts both web (5000) and server (3001)
pnpm dev
```

Visit: **http://localhost:5000**

---

## Vercel + Railway (Recommended)

This is the optimal production stack for KEYFLOWOS.

| Service | Platform | Purpose |
|---------|----------|---------|
| Frontend | **Vercel** | Next.js app, global CDN, preview deployments |
| Backend | **Railway** | NestJS API, background jobs, WebSockets |
| Database | **Railway** | PostgreSQL (managed) |
| Cache | **Railway** | Redis (managed) |
| Storage | **Cloudflare R2** | S3-compatible object storage |
| Auth | **Supabase** | JWT auth (keep existing) |

### 1. Backend → Railway

#### 1.1 Create Project

1. Go to [railway.app](https://railway.app) → New Project
2. Choose **"Deploy from GitHub repo"**
3. Select `SaCH-PRO/KEYFLOWOS`
4. Add a **PostgreSQL** service → Railway creates `DATABASE_URL` and `DIRECT_URL` automatically
5. Add a **Redis** service → Railway creates `REDIS_URL` automatically

#### 1.2 Configure Build & Start

In your Railway project settings:

| Setting | Value |
|---------|-------|
| Root Directory | `apps/server` |
| Build Command | `cd ../../ && pnpm install && pnpm build:server` |
| Start Command | `node apps/server/dist/main.js` |

Or use a `railway.json` at repo root:

```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "builder": "NIXPACKS",
    "buildCommand": "pnpm install && pnpm build:server"
  },
  "deploy": {
    "startCommand": "node apps/server/dist/main.js",
    "healthcheckPath": "/__api/healthz",
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 3
  }
}
```

#### 1.3 Add Environment Variables

In Railway → Variables, add:

```env
NODE_ENV=production
PORT=3001

APP_URL=https://your-vercel-domain.vercel.app
API_URL=https://your-railway-domain.railway.app
NEXT_PUBLIC_APP_URL=https://your-vercel-domain.vercel.app

# Auth (same Supabase project)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_JWT_SECRET=your-jwt-secret
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Database (auto-filled by Railway Postgres)
DATABASE_URL=${{Postgres.DATABASE_URL}}
DIRECT_URL=${{Postgres.DIRECT_URL}}

# Redis (auto-filled by Railway Redis)
REDIS_URL=${{Redis.REDIS_URL}}

# Storage — Cloudflare R2
S3_BUCKET=your-bucket-name
S3_REGION=auto
S3_ENDPOINT=https://your-account-id.r2.cloudflarestorage.com
S3_ACCESS_KEY_ID=your-r2-access-key
S3_SECRET_ACCESS_KEY=your-r2-secret-key
S3_PUBLIC_URL=https://pub-your-hash.r2.dev

# Email (Resend)
RESEND_API_KEY=your-resend-key
EMAIL_FROM_ADDRESS=no-reply@yourdomain.com
EMAIL_FROM_NAME=Keyflow

# AI (set whichever you use)
AI_INTEGRATIONS_OPENAI_API_KEY=your-openai-key

# Stripe (if using payments)
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_...

# Encryption secrets (generate with: openssl rand -base64 32)
JWT_SECRET=your-jwt-secret
BYOK_ENCRYPTION_SECRET=your-byok-secret
CREDENTIALS_ENCRYPTION_KEY=your-credentials-key
TRACKING_HMAC_SECRET=your-tracking-secret
GOOGLE_STATE_SECRET=your-google-state-secret
```

#### 1.4 Deploy

```bash
# Push to main triggers auto-deploy
git push origin main
```

Copy your Railway domain: `https://keyflowos-api.up.railway.app`

---

### 2. Frontend → Vercel

#### 2.1 Create Project

1. Go to [vercel.com](https://vercel.com) → Add New Project
2. Import `SaCH-PRO/KEYFLOWOS`
3. Framework Preset: **Next.js**

#### 2.2 Configure Build

| Setting | Value |
|---------|-------|
| Root Directory | `apps/web` |
| Build Command | `cd ../.. && pnpm install && pnpm build:web` |
| Output Directory | `apps/web/.next` |
| Install Command | `pnpm install` |

Or add `vercel.json` at repo root:

```json
{
  "buildCommand": "cd apps/web && pnpm build",
  "outputDirectory": "apps/web/.next",
  "framework": "nextjs",
  "installCommand": "pnpm install"
}
```

#### 2.3 Add Environment Variables

In Vercel → Settings → Environment Variables:

```env
NEXT_PUBLIC_SITE_URL=https://your-vercel-domain.vercel.app
NEXT_PUBLIC_API_BASE_URL=/__api

# Supabase (same as backend)
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key

# Stripe (if using payments)
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_...

# Dev origins (optional — for ngrok tunnels)
NEXT_PUBLIC_DEV_ORIGINS=
```

#### 2.4 API Proxy Rewrites

Vercel needs to proxy `/__api/*` to your Railway backend. Add to `apps/web/next.config.ts` (already configured):

```ts
async rewrites() {
  const upstream = process.env.KEYFLOW_API_INTERNAL_URL?.trim()
    || "https://your-railway-domain.railway.app";
  return [
    {
      source: "/__api/:path*",
      destination: `${upstream}/:path*`,
    },
  ];
}
```

Or set the environment variable in Vercel:

```env
KEYFLOW_API_INTERNAL_URL=https://your-railway-domain.railway.app
```

#### 2.5 Deploy

```bash
git push origin main
```

Vercel auto-deploys on every push. Preview deployments are created for PRs.

---

## Render

Good free-tier option for the backend.

### Backend

1. [dashboard.render.com](https://dashboard.render.com) → New → Web Service
2. Connect your GitHub repo
3. Settings:
   - **Root Directory**: `apps/server`
   - **Build Command**: `cd ../.. && pnpm install && pnpm build:server`
   - **Start Command**: `node apps/server/dist/main.js`
4. Add **PostgreSQL** service → copy `DATABASE_URL`
5. Add env vars (same as Railway)

### Frontend

1. New → Static Site
2. Connect repo
3. **Root Directory**: `apps/web`
4. **Build Command**: `cd ../.. && pnpm install && pnpm build:web`
5. **Publish Directory**: `apps/web/.next`
6. Add `KEYFLOW_API_INTERNAL_URL=https://your-render-backend.onrender.com`

---

## Fly.io

Best for global edge deployment with Docker.

### 1. Install Fly CLI

```bash
curl -L https://fly.io/install.sh | sh
fly auth login
```

### 2. Create App

```bash
fly apps create keyflowos-api
fly apps create keyflowos-web
```

### 3. Database & Redis

```bash
fly postgres create --name keyflowos-db
fly redis create --name keyflowos-redis
```

### 4. Deploy API

Create `apps/server/Dockerfile`:

```dockerfile
FROM node:20-alpine
WORKDIR /app
RUN npm install -g pnpm
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY packages ./packages
COPY apps/server ./apps/server
RUN pnpm install --frozen-lockfile
RUN pnpm build:server
EXPOSE 3001
CMD ["node", "apps/server/dist/main.js"]
```

```bash
fly deploy --dockerfile apps/server/Dockerfile --app keyflowos-api
```

### 5. Deploy Web

```bash
cd apps/web
fly deploy --app keyflowos-web
```

---

## Environment Variables Reference

### Required (App won't boot without these)

| Variable | Used By | Description |
|----------|---------|-------------|
| `DATABASE_URL` | Server | PostgreSQL connection (pooled) |
| `DIRECT_URL` | Server | PostgreSQL direct (for migrations) |
| `SUPABASE_URL` | Both | Supabase project URL |
| `SUPABASE_ANON_KEY` | Both | Supabase public anon key |
| `SUPABASE_JWT_SECRET` | Server | JWT signing secret |
| `S3_BUCKET` | Server | Object storage bucket |
| `S3_ACCESS_KEY_ID` | Server | S3 access key |
| `S3_SECRET_ACCESS_KEY` | Server | S3 secret key |
| `REDIS_URL` | Server | Redis connection (BullMQ) |

### Required for Production Features

| Variable | Feature | Description |
|----------|---------|-------------|
| `SUPABASE_SERVICE_ROLE_KEY` | Auth | Admin operations (required if email verification enabled) |
| `RESEND_API_KEY` | Email | Transactional emails |
| `STRIPE_SECRET_KEY` | Payments | Stripe integration |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Integrations | Google OAuth |
| `AI_INTEGRATIONS_OPENAI_API_KEY` | AI | OpenAI-powered features |

### URL Configuration

| Variable | Fallback | Description |
|----------|----------|-------------|
| `APP_URL` | `PUBLIC_BASE_URL` → `localhost:5000` | Public web URL |
| `API_URL` | `PUBLIC_BASE_URL` → `localhost:3001` | Public API URL |
| `PUBLIC_BASE_URL` | — | Umbrella URL for both |
| `OAUTH_REDIRECT_BASE` | `APP_URL` | OAuth callback base |
| `NEXT_PUBLIC_SITE_URL` | — | Frontend mirror of `APP_URL` |
| `NEXT_PUBLIC_API_BASE_URL` | — | Frontend API base (`/__api` or full URL) |

### Optional / Dev Conveniences

| Variable | Default | Description |
|----------|---------|-------------|
| `NEXT_PUBLIC_DEV_ORIGINS` | — | Comma-separated extra dev hosts |
| `CORS_ALLOWED_ORIGINS` | — | Extra API CORS origins |
| `AUTH_REQUIRE_EMAIL_VERIFICATION` | `false` (dev) / `true` (prod) | Require email verification |
| `PRESENCE_TRUSTED_HOSTS` | `APP_URL` | Trusted analytics ingestion hosts |

---

## Migrating from Replit

### 1. Database

**Option A: Keep Supabase (Recommended)**
- You're already using Supabase for auth
- Move your data to a dedicated Supabase project or keep the existing one
- Update `DATABASE_URL` to point to Supabase Postgres

**Option B: Export & Import**

On Replit:
```bash
pg_dump $DATABASE_URL > keyflowos_backup.sql
```

On new host:
```bash
psql $DATABASE_URL < keyflowos_backup.sql
```

### 2. Object Storage

**From Replit Object Storage → Cloudflare R2 / AWS S3**

1. Create R2 bucket or S3 bucket
2. Update `S3_*` env vars
3. Re-upload branding assets, avatars, documents

### 3. Environment Variables

Copy your Replit Secrets to your new platform:

| Replit Secret | New Location |
|---------------|--------------|
| `DATABASE_URL` | Railway/Render env vars |
| `SUPABASE_*` | Both Vercel + Railway |
| `S3_*` | Railway env vars |
| `STRIPE_*` | Both Vercel + Railway |
| `OPENAI_API_KEY` | Railway env vars |

### 4. Update OAuth Redirect URIs

In Google Cloud Console → APIs & Services → Credentials:
- Remove: `https://*.replit.dev/__api/connect/google-suite/callback`
- Add: `https://your-vercel-domain.vercel.app/__api/connect/google-suite/callback`

### 5. Custom Domain (Optional)

**Vercel**: Settings → Domains → Add `app.yourdomain.com`
**Railway**: Settings → Domains → Add `api.yourdomain.com`

Update `APP_URL` and `API_URL` accordingly.

---

## Troubleshooting

### "Invalid Host header" in dev

Add your tunnel domain:
```env
NEXT_PUBLIC_DEV_ORIGINS=your-tunnel.ngrok.io
```

### "CORS error" in production

Ensure `CORS_ALLOWED_ORIGINS` includes your Vercel domain:
```env
CORS_ALLOWED_ORIGINS=https://your-vercel-domain.vercel.app
```

### Uploads failing

Check S3 configuration:
```bash
curl -I $S3_ENDPOINT
```

Ensure `S3_PUBLIC_URL` is set and the bucket allows public read.

### Build fails on Vercel

If `pnpm` isn't found, add to Vercel project settings:
- **Install Command**: `npm install -g pnpm && pnpm install`

---

## Quick Reference Commands

```bash
# Local dev
pnpm dev

# Build everything
pnpm build

# Build specific app
pnpm build:web    # or turbo run build --filter=web
pnpm build:server # or turbo run build --filter=server

# Database
cd packages/db
npx prisma generate
npx prisma migrate dev
npx prisma studio

# Lint
pnpm lint

# Type check
cd apps/server && npx tsc --noEmit
cd apps/web && npx tsc --noEmit
```

---

**Need help?** Open an issue at [github.com/SaCH-PRO/KEYFLOWOS](https://github.com/SaCH-PRO/KEYFLOWOS)
