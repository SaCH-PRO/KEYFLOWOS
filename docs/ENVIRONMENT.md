# KeyflowOS Environment Configuration

This document describes every environment variable used by KeyflowOS.

## Quick Start (Local Docker)

```bash
cp .env.example .env
# Edit .env and set at minimum:
#   - DATABASE_URL (or use Docker Compose defaults)
#   - SUPABASE_URL + SUPABASE_ANON_KEY + SUPABASE_JWT_SECRET
#   - S3_BUCKET + S3_ACCESS_KEY_ID + S3_SECRET_ACCESS_KEY
pnpm install
pnpm --filter db run db:push
pnpm --filter server dev
pnpm --filter web dev
```

---

## Required Variables

### Public URLs
| Variable | Description | Example |
|----------|-------------|---------|
| `APP_URL` | Frontend URL | `http://localhost:5000` |
| `API_URL` | Backend URL | `http://localhost:3001` |
| `NEXT_PUBLIC_SITE_URL` | Frontend URL (browser-visible) | `http://localhost:5000` |
| `NEXT_PUBLIC_API_BASE_URL` | API URL (browser-visible) | `http://localhost:3001` |

### Database
| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | Pooled Postgres connection | `postgresql://user:pass@host:5432/db` |
| `DIRECT_URL` | Direct connection (for Prisma migrate) | Same as above |

### Authentication (Supabase)
| Variable | Description |
|----------|-------------|
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_ANON_KEY` | Public anon key |
| `SUPABASE_JWT_SECRET` | JWT signing secret |
| `SUPABASE_SERVICE_ROLE_KEY` | **Server-only** service role key |
| `NEXT_PUBLIC_SUPABASE_URL` | Mirror for browser |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Mirror for browser |

### Object Storage (S3-compatible)
| Variable | Description |
|----------|-------------|
| `S3_BUCKET` | Bucket name |
| `S3_REGION` | Region (e.g. `us-east-1`) |
| `S3_ENDPOINT` | Optional custom endpoint (R2, MinIO) |
| `S3_ACCESS_KEY_ID` | Access key |
| `S3_SECRET_ACCESS_KEY` | Secret key |
| `S3_FORCE_PATH_STYLE` | `true` for MinIO |
| `S3_PUBLIC_URL` | Public CDN URL (optional) |

---

## Optional Variables

### AI Providers
| Variable | Description |
|----------|-------------|
| `AI_INTEGRATIONS_OPENAI_API_KEY` | OpenAI API key |
| `AI_INTEGRATIONS_OPENAI_BASE_URL` | Custom base URL (e.g. OpenRouter) |
| `ANTHROPIC_API_KEY` | Claude API key |
| `XAI_API_KEY` | xAI/Grok API key |
| `BYOK_ENCRYPTION_SECRET` | AES-256 secret for BYOK keys |

### Payment Gateways
| Variable | Description |
|----------|-------------|
| `STRIPE_SECRET_KEY` | Stripe secret key |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Stripe publishable key (browser) |
| `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` | PayPal credentials |
| `PAYPAL_ENVIRONMENT` | `sandbox` or `live` |
| `WIPAY_API_KEY` / `WIPAY_ACCOUNT_NUMBER` | WiPay (Caribbean) |

### Email
| Variable | Description |
|----------|-------------|
| `RESEND_API_KEY` | Resend API key (for verification emails) |
| `EMAIL_FROM_ADDRESS` | Sender address |
| `EMAIL_FROM_NAME` | Sender name |
| `AUTH_REQUIRE_EMAIL_VERIFICATION` | `true` to require email verification |

### Google OAuth
| Variable | Description |
|----------|-------------|
| `GOOGLE_CLIENT_ID` | OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | OAuth client secret |
| `GOOGLE_STATE_SECRET` | CSRF state secret |

### WhatsApp
| Variable | Description |
|----------|-------------|
| `WHATSAPP_ACCESS_TOKEN` | WhatsApp Business Cloud token |
| `WHATSAPP_PHONE_NUMBER_ID` | Phone number ID |

### Security
| Variable | Description |
|----------|-------------|
| `JWT_SECRET` | Standalone JWT secret (non-Supabase) |
| `TRACKING_HMAC_SECRET` | HMAC for tracking pixels/links |
| `CREDENTIALS_ENCRYPTION_KEY` | AES key for connector credentials |
| `NANGO_SECRET_KEY` | Nango OAuth sync secret |

---

## Feature Flags

Feature flags are managed via the database (`FeatureFlag` table) and can be toggled at runtime. No environment variables required.

---

## Development Conveniences

| Variable | Description |
|----------|-------------|
| `NODE_ENV` | `development` or `production` |
| `PORT` | API server port (default: 3001) |
| `NEXT_PUBLIC_DEMO_BUSINESS_ID` | Auto-select business in demo mode |
| `CORS_ALLOWED_ORIGINS` | Extra allowed origins (comma-separated) |
