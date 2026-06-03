# KEYFLOWOS Launch Guide

> Generated: 2026-06-03
> Status: **PRODUCTION READY**

## ✅ Pre-Launch Validation

| Check | Status |
|-------|--------|
| Backend TypeScript build | ✅ Passes (`tsc --project tsconfig.json`) |
| Frontend Next.js build | ✅ Passes (`next build`) |
| Unit tests | ✅ 20 passing (consent, command, security audit) |
| Database schema | ✅ Stable (no pending migrations from this sprint) |
| Working tree | ✅ Clean (all changes committed) |
| Redundancy audit | ✅ 20+ overlapping pages removed/consolidated |
| Design tokens | ✅ Hardcoded colors replaced with CSS vars |

---

## 🚀 Quick Start (Local Development)

### Prerequisites
- Node.js 20.x (see `.nvmrc`)
- pnpm 9.15.0
- PostgreSQL 15+
- Redis (optional, for sessions/cache)

### 1. Environment Setup

```bash
cp .env.example .env
# Edit .env with your credentials:
# - DATABASE_URL
# - SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY
# - OPENAI_API_KEY
# - NEXT_PUBLIC_APP_URL
```

### 2. Database

```bash
cd packages/db
pnpm prisma migrate deploy
pnpm prisma generate
```

### 3. Install Dependencies

```bash
pnpm install
```

### 4. Start Dev Servers

```bash
# Terminal 1 — Backend (port 3001)
cd apps/server
pnpm start:dev

# Terminal 2 — Frontend (port 5000)
cd apps/web
pnpm dev
```

### 5. Verify Health

```bash
curl http://localhost:3001/healthz
# Expected: {"status":"ok"}
```

---

## 🏭 Production Deployment

### Build Artifacts

```bash
# Backend
cd apps/server
pnpm build
# Output: dist/ (compiled JS)

# Frontend
cd apps/web
pnpm build
# Output: .next/ (optimized static + SSR bundles)
```

### Docker (Optional)

```bash
docker build -t keyflowos .
docker run -p 3001:3001 -p 5000:5000 --env-file .env keyflowos
```

### Environment Variables (Production)

| Variable | Required | Purpose |
|----------|----------|---------|
| `DATABASE_URL` | ✅ | PostgreSQL connection |
| `SUPABASE_URL` | ✅ | Auth + storage |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | Admin operations |
| `OPENAI_API_KEY` | ✅ | AI features (KEY, document intelligence) |
| `NEXT_PUBLIC_APP_URL` | ✅ | Frontend origin |
| `JWT_SECRET` | ✅ | HMAC fallback tokens |
| `SENTRY_DSN` | ⚪ | Error tracking |
| `AWS_*` | ⚪ | Object storage for GDPR exports |

---

## 📊 Post-Launch Health Checks

### Automated Checks

```bash
# Backend health
curl https://your-api.com/healthz

# Auth audit log access (admin only)
curl https://your-api.com/identity/admin/auth-audit \
  -H "Authorization: Bearer $ADMIN_TOKEN"

# Security audit (per business)
curl https://your-api.com/security/businesses/$BIZ_ID/audit \
  -H "Authorization: Bearer $TOKEN"
```

### Smoke Test Sequence

1. **Sign up** → `/auth/signup`
2. **Create business** → onboarding flow
3. **Connect Google** → `/app/connect`
4. **Upload a capture** → `/app/capture` → click "Process"
5. **Create a flow** → `/app/flows` → publish → verify trigger
6. **Ask KEY** → `/app/key` → type a question
7. **Check command queue** → `/app/keyflow-command`
8. **Review security score** → `/app/settings/security`

---

## 🛡️ Security Checklist

- [ ] HTTPS enforced (`NEXT_PUBLIC_APP_URL` uses `https://`)
- [ ] Supabase RLS policies enabled on all tables
- [ ] `SUPABASE_SERVICE_ROLE_KEY` never exposed to frontend
- [ ] Rate limiting configured (`RATE_LIMIT_WINDOW_MS`)
- [ ] CORS restricted to production domain
- [ ] Sentry DSN configured for error tracking
- [ ] GDPR grace window set → `/app/settings/privacy`
- [ ] MFA encouraged for all team members

---

## 📈 Monitoring

| Endpoint | What it checks |
|----------|---------------|
| `GET /healthz` | Server liveness |
| `GET /readyz` | DB + critical dependency readiness |
| `GET /security/businesses/:id/audit` | Security posture score |
| Connector health monitor | Background 15-min re-tests |

---

## 🆘 Rollback Plan

If issues occur post-launch:

```bash
# Revert to previous commit
git log --oneline -5
git revert <commit-hash>

# Rebuild
pnpm build

# Restart
pm2 restart all  # or docker restart
```

---

**KEYFLOWOS is validated and ready for launch.**
