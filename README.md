# KEYFLOW OS

> The AI-powered business operating system for founders, freelancers, and small teams.

[![Node](https://img.shields.io/badge/node-20.x-339933?logo=node.js)](https://nodejs.org/)
[![pnpm](https://img.shields.io/badge/pnpm-9.15.0-F69220?logo=pnpm)](https://pnpm.io/)
[![NestJS](https://img.shields.io/badge/NestJS-Backend-E0234E?logo=nestjs)](https://nestjs.com/)
[![Next.js](https://img.shields.io/badge/Next.js-Frontend-000000?logo=next.js)](https://nextjs.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Database-4169E1?logo=postgresql)](https://www.postgresql.org/)
[![License](https://img.shields.io/badge/license-Proprietary-blue)](./LICENSE)

KEYFLOW OS unifies the tools you need to run a business — CRM, invoicing, bookings, automations, content, analytics, and an AI assistant named **KEY** — into one cohesive platform.

---

## ✨ What It Does

- **Cockpit** — See what matters most today: urgent actions, today's schedule, KPI pulse, and KEY Command.
- **Workspaces** — Execute daily work across Money (revenue, contacts, bookings), Time (calendar, flows, projects), and People (inbox, content, community).
- **Studio** — Configure your business blueprint, products, automations, integrations, and team permissions.
- **Public Surfaces** — Customer-facing booking pages, storefronts, carts, and invoice payment pages.
- **KEY AI** — Natural-language command interface that reasons over your business data and takes action.

---

## 🏗️ Architecture

```text
┌─────────────────────────────────────────────────────────────┐
│                        KEYFLOW OS                            │
├─────────────────────────────────────────────────────────────┤
│  apps/web        Next.js 16 App Router (port 5000)          │
│  apps/server     NestJS API + tRPC (port 3001)              │
│  packages/api    Shared API contracts & tRPC routers        │
│  packages/db     Prisma schema + migrations + seeds         │
│  packages/shared Cross-cutting types & utilities            │
│  packages/ui     Shared React component library             │
└─────────────────────────────────────────────────────────────┘
```

- **Monorepo tooling:** pnpm workspaces + Turborepo
- **Auth:** Supabase JWT (primary) + HMAC-JWT admin tokens (fallback)
- **Database:** PostgreSQL with Prisma ORM
- **Queues / Cache:** Redis + BullMQ
- **Object storage:** S3-compatible (AWS S3, R2, MinIO)
- **AI providers:** OpenAI, Anthropic Claude, xAI Grok (BYOK supported)
- **Observability:** Sentry

---

## 🚀 Quick Start

### Prerequisites

- Node.js 20.x (see `.nvmrc`)
- pnpm 9.15.0
- PostgreSQL 15+
- Redis (optional, used for queues/cache)

### 1. Clone & install

```bash
git clone <repo-url>
cd KEYFLOWOS
pnpm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env with your database, Supabase, and AI provider credentials.
```

### 3. Prepare the database

```bash
pnpm db:migrate
pnpm db:generate
```

### 4. Start development

```bash
bash scripts/launch-dev.sh
```

- Web app: http://localhost:5000
- API server: http://localhost:3001
- Health check: `curl http://localhost:3001/healthz`

> **Note:** `launch-dev.sh` handles port cleanup, cache clearing, env guards, DB checks, and starts both servers with the webpack dev bundler to avoid a known Next.js 16 + Turbopack cold-start issue.

---

## 📦 Useful Commands

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start all dev servers |
| `pnpm build` | Build all packages/apps |
| `pnpm lint` | Lint all packages/apps |
| `pnpm db:migrate` | Run Prisma migrations |
| `pnpm db:seed` | Seed the database |
| `pnpm db:studio` | Open Prisma Studio |

---

## 🧪 Testing

```bash
# Server unit tests
cd apps/server && pnpm test

# Run full CI checks locally
pnpm lint
pnpm build
```

---

## 📚 Documentation

- [`docs/LAUNCH_GUIDE.md`](./docs/LAUNCH_GUIDE.md) — Pre-flight checklist and deployment steps
- [`docs/ENVIRONMENT.md`](./docs/ENVIRONMENT.md) — Full environment variable reference
- [`docs/KEYFLOWOS_100_PERCENT_ROADMAP.md`](./docs/KEYFLOWOS_100_PERCENT_ROADMAP.md) — Gap analysis & costed roadmap
- [`docs/INFORMATION_ARCHITECTURE.md`](./docs/INFORMATION_ARCHITECTURE.md) — Surface & module design
- [`docs/PRODUCTION_READINESS.md`](./docs/PRODUCTION_READINESS.md) — Production checklist
- [`AGENTS.md`](./AGENTS.md) — Agent / automation context for this repo

---

## 🤝 Contributing

1. Open an issue or discussion before large changes.
2. Create a feature branch from `main`.
3. Follow the existing code style and run `pnpm lint` before pushing.
4. Open a pull request using the provided template.

---

## 🔒 Security

- Never commit secrets. Use `.env` and GitHub Secrets.
- Never set `KEYFLOW_DEV_AUTH_BYPASS=true` in production; the server refuses to boot with it enabled.
- See [`docs/PRODUCTION_READINESS.md`](./docs/PRODUCTION_READINESS.md) for the full security checklist.

---

## 📄 License

Proprietary — all rights reserved.
