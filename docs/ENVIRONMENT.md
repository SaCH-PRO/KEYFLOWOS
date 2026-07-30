# KEYFlowOS Environment Reference

This document maps every environment variable the server and web app use, whether it is required, and what happens when it is missing.

For deployment specifics see `DEPLOYMENT.md`.
For a pre-flight checklist see `PRODUCTION_READINESS.md`.
For the third-party account and pricing guide see `docs/development/THIRD_PARTY_ACCOUNTS.md`.

---

## Required to boot

These variables are validated at boot time. If any are missing or invalid, `ensureValidServerEnv()` exits the process with a clear error.

| Variable | Purpose | Failure mode |
|----------|---------|--------------|
| `NODE_ENV` | Runtime environment. | Defaults to `development`. Must be `development`, `test`, or `production`. |
| `PORT` | API server port. | Defaults to `3001`. Must be a valid TCP port. |
| `DATABASE_URL` | Pooled PostgreSQL connection string. | Boot fails with `DATABASE_URL: is required`. |

## Auth (required for real users)

Auth is optional for local development if you rely on the dev-auth bypass path, but **never use the bypass in production or shared environments**.

| Variable | Purpose | Dev behavior | Production behavior |
|----------|---------|--------------|---------------------|
| `SUPABASE_URL` | Supabase project URL. | Warning only. | Required for Supabase JWT validation. |
| `SUPABASE_ANON_KEY` | Public Supabase anon key. | Warning only. | Required for Supabase client initialization. |
| `SUPABASE_JWT_SECRET` | JWT signing secret for local verification. | Falls back to `getUser()` round-trip. | Strongly recommended for performance and reliability. |
| `SUPABASE_SERVICE_ROLE_KEY` | Admin-level key for user management. | Warning only. | Required when `AUTH_REQUIRE_EMAIL_VERIFICATION=true`. |
| `JWT_SECRET` | Standalone HMAC secret for service tokens. | Optional. | Required if you issue service tokens outside Supabase. |

## Public URLs

| Variable | Purpose | Fallback |
|----------|---------|----------|
| `APP_URL` | Canonical web app URL. | `http://localhost:5000` |
| `API_URL` | Canonical API URL. | `http://localhost:3001` |
| `PUBLIC_BASE_URL` | Umbrella override for both URLs. | — |
| `NEXT_PUBLIC_SITE_URL` | Frontend mirror of `APP_URL`. | — |
| `NEXT_PUBLIC_API_BASE_URL` | Frontend mirror of `API_URL`. | — |

## Queues and cache

| Variable | Purpose | Failure mode |
|----------|---------|--------------|
| `REDIS_URL` | BullMQ job queues and caches. | Warning only; background jobs fail at runtime if not set. |

## Object storage (S3-compatible)

Object storage is required for file uploads. If **any** `S3_*` variable is set, the validator requires `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, and `S3_SECRET_ACCESS_KEY`.

| Variable | Purpose | Notes |
|----------|---------|-------|
| `S3_BUCKET` | Bucket name. | Required when S3 is configured. |
| `S3_REGION` | Region, e.g. `us-east-1`. | Required when S3 is configured. |
| `S3_ACCESS_KEY_ID` | Access key. | Required when S3 is configured. |
| `S3_SECRET_ACCESS_KEY` | Secret key. | Required when S3 is configured. |
| `S3_ENDPOINT` | Custom endpoint for R2/MinIO. | Leave empty for AWS S3. |
| `S3_PUBLIC_URL` | Public-facing asset base URL. | Optional. |
| `S3_FORCE_PATH_STYLE` | Use path-style URLs. | Use `true` for MinIO. |

## AI providers

At least one provider key is recommended; otherwise AI features return errors.

| Variable | Provider |
|----------|----------|
| `AI_INTEGRATIONS_OPENAI_API_KEY` | OpenAI |
| `ANTHROPIC_API_KEY` | Anthropic Claude |
| `XAI_API_KEY` | xAI Grok |
| `BYOK_ENCRYPTION_SECRET` | AES-256 secret for encrypting BYOK provider keys. |

## Email and verification

| Variable | Purpose |
|----------|---------|
| `AUTH_REQUIRE_EMAIL_VERIFICATION` | `true` requires email confirmation. Defaults to `true` in production. |
| `RESEND_API_KEY` | Sends verification emails. Required when email verification is on. |
| `EMAIL_FROM_ADDRESS` | From address for system emails. Required when email verification is on. |

## Integrations

### Google OAuth (Gmail, Calendar, Drive, Contacts)

| Variable | Purpose |
|----------|---------|
| `GOOGLE_CLIENT_ID` | OAuth client ID. |
| `GOOGLE_CLIENT_SECRET` | OAuth client secret. |
| `GOOGLE_REDIRECT_URI` | Optional override. |
| `GMAIL_REDIRECT_URI` | Optional override. |
| `CALENDAR_REDIRECT_URI` | Optional override. |
| `DRIVE_REDIRECT_URI` | Optional override. |

### Payments

| Variable | Purpose |
|----------|---------|
| `STRIPE_SECRET_KEY` | Stripe API secret. |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signature secret. |
| `PAYPAL_CLIENT_ID` | PayPal client ID. |
| `PAYPAL_CLIENT_SECRET` | PayPal client secret. |
| `PAYPAL_WEBHOOK_ID` | PayPal webhook ID. |

### Communications

| Variable | Purpose |
|----------|---------|
| `WHATSAPP_TOKEN` | WhatsApp Business Cloud API token. |
| `WHATSAPP_PHONE_NUMBER_ID` | WhatsApp phone number ID. |
| `META_APP_SECRET` | Meta app secret for webhook signatures. |
| `TRACKING_HMAC_SECRET` | HMAC secret for tracking links/pixels. |
| `CONNECTOR_ENCRYPTION_KEY` | AES key for connector credentials. |

## Observability

| Variable | Purpose |
|----------|---------|
| `SENTRY_DSN` | Error tracking DSN. |
| `SENTRY_ENVIRONMENT` | Sentry environment tag. |
| `SENTRY_RELEASE` | Release tag. |
| `SENTRY_TRACES_SAMPLE_RATE` | Performance trace sample rate. |

## Development and safety toggles

| Variable | Purpose | Safety |
|----------|---------|--------|
| `KEYFLOW_DEV_AUTH_BYPASS` | **DANGER:** disables authentication. | Server refuses to boot if set to `true` or `1`. Never use in production. |
| `KEYFLOW_SKIP_ENV_VALIDATION` | Skip boot-time env validation. | Useful for one-off scripts; do not use in production. |
| `NEXT_PUBLIC_DEMO_BUSINESS_ID` | Pre-select a demo business in the UI. | Dev only. |

---

## How env validation works

1. `apps/server/src/core/config/env.ts` defines a Zod schema.
2. `bootstrap()` calls `ensureValidServerEnv()` before creating the Nest app.
3. Required issues are fatal and printed to `stderr`.
4. Recommended issues are warnings and do not block boot.
5. Validation values are never logged — only variable names.

## Common local setup

```bash
NODE_ENV=development
PORT=3001
DATABASE_URL=postgresql://keyflow:keyflow@localhost:5432/keyflow?schema=public
DIRECT_URL=postgresql://keyflow:keyflow@localhost:5432/keyflow?schema=public
REDIS_URL=redis://localhost:6379
APP_URL=http://localhost:5000
API_URL=http://localhost:3001
NEXT_PUBLIC_SITE_URL=http://localhost:5000
NEXT_PUBLIC_API_BASE_URL=http://localhost:3001
```

Auth, AI, and integrations can be left unset for local unit testing; the reliable test suite does not require them.
