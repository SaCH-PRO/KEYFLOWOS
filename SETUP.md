# Supabase Setup (Local Dev)

This project uses:
- Frontend: `apps/web`
- Backend API: `apps/server`
- Prisma schema: `packages/db/prisma/schema.prisma`

## 1) Add secrets and URLs

### Frontend (`apps/web/.env.local`)
Set:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

### Backend (`apps/server/.env`)
Set:
- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SECRET_KEY` (**server only; never in browser env**)
- `SUPABASE_AUTH_URL`
- `SUPABASE_JWKS_URL`
- `SUPABASE_JWT_ISSUER`
- `SUPABASE_JWT_AUDIENCE=authenticated`
- `SUPABASE_REST_URL`
- `SUPABASE_STORAGE_URL`
- `SUPABASE_FUNCTIONS_URL`
- `SUPABASE_REALTIME_URL`
- `DATABASE_URL`
- `DIRECT_URL`
- `DATABASE_TRANSACTION_URL`
- `AI_INTEGRATIONS_OPENAI_API_KEY` (required by current server startup path)

### Compatibility (`apps/api/.env`)
`apps/api` is a package in this repo, not a runtime app. A compatibility `.env` is included for tooling parity.

## 2) Database schema/migrations

Run from repo root:
- `pnpm db:generate`
- `pnpm db:migrate:dev`

Optional quick sync:
- `pnpm db:push`

## 3) Start app locally

Run in separate terminals:
- `pnpm --filter server dev`
- `pnpm --filter web dev`

Open:
- Web: `http://localhost:5000`
- API: `http://localhost:3001`

## 4) Test auth + profile flow

1. Sign up/sign in at `/auth/signup` or `/auth/login`.
2. Open Profile page (`/app/profile?tab=security`) and use **Supabase Profile (RLS Example)**:
   - Save a display name (writes to `public.profiles` via protected API route)
   - Read profile (fetches your own row)
3. Protected route sanity check:
   - `GET /auth/me` with bearer token should return user id/email.

## 5) Storage example

Use:
- `POST /uploads/storage/signed-upload`
- `POST /uploads/storage/signed-download`

Current default bucket env:
- `SUPABASE_STORAGE_BUCKET=app-uploads`

If the bucket does not exist yet, create it in Supabase Dashboard and update policies.

## Security notes

- Never expose `SUPABASE_SECRET_KEY` to client code.
- `.env` files are gitignored.
- Rotate your DB password after setup.
