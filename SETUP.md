# KEYFLOWOS Local Run Guide (Easy + Complete)

This is the **copy/paste local setup guide** for running the full app on your machine.

Architecture in this repo:
- Frontend (Next.js): `apps/web`
- Backend (NestJS): `apps/server`
- Database ORM (Prisma): `packages/db`

Default local ports:
- Web: `http://localhost:5000`
- API: `http://localhost:3001`

---

## 0) Prerequisites

Install these first:
- Node.js 20+
- pnpm 9+
- A Supabase project (URL + publishable key + secret key + DB credentials)

Optional but currently recommended:
- OpenAI API key (`AI_INTEGRATIONS_OPENAI_API_KEY`) so server startup paths do not fail.

---

## 1) Clone and install

From your terminal:

1. `git clone <your-repo-url>`
2. `cd KEYFLOWOS`
3. `pnpm install`

---

## 2) Create env files (important)

You need **two runtime env files**:
- `apps/web/.env.local` (frontend-safe values only)
- `apps/server/.env` (backend/server values)

You can use root `.env.example` as reference for variable names.

### 2.1 Frontend env (`apps/web/.env.local`)

Create `apps/web/.env.local`:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `NEXT_PUBLIC_API_BASE_URL=http://localhost:3001` (recommended explicit local value)
- `NEXT_PUBLIC_SITE_URL=http://localhost:5000` (recommended explicit local value)

Example:

`NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co`  
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxx`  
`NEXT_PUBLIC_API_BASE_URL=http://localhost:3001`  
`NEXT_PUBLIC_SITE_URL=http://localhost:5000`

### 2.2 Backend env (`apps/server/.env`)

Create `apps/server/.env` with:

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SECRET_KEY` (**server only**)
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
- `AI_INTEGRATIONS_OPENAI_API_KEY`
- `PORT=3001`

Where to get these:
- Supabase dashboard -> Project Settings -> API:
  - Project URL -> `SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_URL`
  - Publishable key -> `SUPABASE_PUBLISHABLE_KEY` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
  - Secret key -> `SUPABASE_SECRET_KEY`
- Supabase dashboard -> Project Settings -> Database:
  - Connection strings -> `DATABASE_URL`, `DIRECT_URL`, `DATABASE_TRANSACTION_URL`
  - URL-encode DB password if it has special chars (`@`, `#`, etc.)

### 2.3 Compatibility env (`apps/api/.env`)

`apps/api` is not the runtime backend. You can keep this file for tooling compatibility, but app runtime uses `apps/server/.env`.

---

## 3) Database setup (Prisma)

From repo root (`KEYFLOWOS`):

1. `pnpm db:generate`
2. `pnpm db:migrate:dev`

Optional quick schema sync:
- `pnpm db:push`

If migrations fail with connection/auth errors:
- re-check DB URL + password encoding
- confirm IP/network access in Supabase settings

---

## 4) Start backend + frontend

Open **2 terminals** from repo root.

### Terminal A (Backend)
1. `set -a && source apps/server/.env && set +a`
2. `pnpm --filter server dev`

Expected:
- `Application is running on: http://localhost:3001`

### Terminal B (Frontend)
1. `pnpm --filter web dev`

Expected:
- Next dev server ready on `http://localhost:5000`

---

## 5) Verify it works

### Quick terminal checks

- `curl -i http://localhost:3001/` -> should return `200`
- `curl -i http://localhost:5000/auth/login` -> should return `200`

### Browser checks

1. Open `http://localhost:5000/auth/signup`
2. Create account or sign in at `http://localhost:5000/auth/login`
3. Open `http://localhost:5000/app/profile?tab=security`
4. In profile/security flows, confirm signed-in behavior works.

---

## 6) Common issues and quick fixes

### A) `401 Invalid API key`
- Ensure frontend uses `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (not secret).
- Ensure backend has `SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY`.
- Restart both servers after env changes.

### B) `Authentication required` after login
- Confirm backend is actually running on `:3001`.
- Confirm frontend points to backend (`NEXT_PUBLIC_API_BASE_URL=http://localhost:3001`).
- Clear local storage and sign in again.

### C) Prisma DB connection errors (`P1000`/`P1001`)
- Recheck `DATABASE_URL` / `DIRECT_URL`.
- URL-encode password.
- Verify Supabase DB host/port and network access.

### D) Server startup fails due OpenAI key
- Set `AI_INTEGRATIONS_OPENAI_API_KEY` in `apps/server/.env`.

---

## 7) Security rules (must follow)

- Never put `SUPABASE_SECRET_KEY` in any `NEXT_PUBLIC_*` variable.
- Never commit real keys to git.
- Keep secrets only in server env files or secret managers.
- Rotate any previously exposed secrets.

---

## 8) Should you deploy on Vercel?

**Short answer:**
- **Web app** (`apps/web`): yes, Vercel is a good fit.
- **Backend API** (`apps/server`, NestJS): usually **not ideal on Vercel** as-is.

### Recommended production setup

- Deploy `apps/web` to **Vercel**
- Deploy `apps/server` to a long-running Node host (Render / Railway / Fly.io / ECS / VM)
- Use Supabase for auth/db/storage

Why:
- This backend is a dedicated Nest server with persistent service behavior and multiple modules.
- Vercel is optimized for serverless/functions/edge. Running this Nest backend there usually requires architecture changes and can introduce cold-start/runtime constraints.

If you want “single platform simplicity,” keep web on Vercel and host API on Render/Railway; that’s the lowest-friction path.
