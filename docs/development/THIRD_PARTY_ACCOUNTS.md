# KEYFlowOS Third-Party Accounts & Pricing Guide

This guide lists the external accounts and API keys needed to run KEYFlowOS with **full functionality** in production, along with current pricing options. For local development the requirements are much smaller — Docker provides Postgres and Redis, and several services have generous free tiers.

> **OAuth note:** After the `bad_oauth_state` fix, KEYFlowOS no longer passes a custom `state` parameter to Supabase Auth. Supabase manages the OAuth flow state internally; we keep PKCE (`code_verifier` / `code_challenge`) for the token exchange. See `apps/web/src/app/auth/callback/page.tsx` for the implementation.

---

## Local development minimum

You can run the app locally with only these accounts/services:

| Service | Purpose | Cost | Notes |
|---------|---------|------|-------|
| **Docker Desktop** | Local Postgres + Redis | Free personal license | Required by `scripts/launch-dev.sh`. |
| **Supabase project** | Auth (Google OAuth provider) | Free tier | Used for sign-up/sign-in. The free tier pauses after 7 days of inactivity. |
| **Google Cloud** | Google OAuth client for sign-in | Free to create OAuth client | Only the sign-in scope is required locally. |
| **S3-compatible object storage** | File uploads | Free (self-hosted MinIO) or Supabase Storage free tier | MinIO via Docker is the simplest local option. |

No AI keys, email provider, payment gateway, or observability stack is required to boot the app or run the test suite locally.

---

## Production / full-feature accounts

These are the accounts required for the complete product experience in a live environment. They are grouped by capability.

### 1. Core platform & auth

| Service | Purpose | Free option | Paid options (2026) |
|---------|---------|-------------|----------------------|
| **Supabase** | Auth, managed Postgres, Storage, Realtime, Edge Functions | Free: 500 MB DB, 50K MAU, 5 GB egress, 1 GB file storage, 2 projects (auto-pauses after 7 days idle) | Pro: **$25/mo** — 8 GB DB, 100K MAU, 250 GB egress, 100 GB file storage, $10 compute credit (covers Micro instance). Team: **$599/mo**. Enterprise: custom. |

Production tip: Use Supabase Pro or self-host Postgres/Redis on managed services such as Neon, Railway, Render, Aiven, or Upstash Redis.

### 2. Email (verification, password resets, notifications)

| Service | Purpose | Free option | Paid options (2026) |
|---------|---------|-------------|----------------------|
| **Resend** *(recommended)* | Transactional email | Free: 3,000 emails/mo, 100/day cap, 1 domain | Pro 50K: **$20/mo**; Pro 100K: **$35/mo**; Scale 100K+: **$90–$1,150/mo**; Enterprise: custom. |
| **Postmark** | High-deliverability transactional email | Free: 100 emails/mo | $15/mo (10K), $50/mo (50K), $115/mo (100K); overage ~$1.20–$1.80/1K. |
| **SendGrid** | Transactional + marketing email | 60-day trial only (100/day) | Essentials 50K: **$19.95/mo**; Pro 100K: **$89.95/mo**; scales to 2.5M/mo. |
| **Amazon SES** | High-volume transactional/bulk email | 12-month AWS free tier includes 62K outbounds/mo from EC2 | Pay-as-you-go: ~$0.10/1K emails + data transfer. |

### 3. Object storage (file uploads)

| Service | Purpose | Free option | Paid options (2026) |
|---------|---------|-------------|----------------------|
| **Cloudflare R2** *(recommended for egress-heavy apps)* | S3-compatible object storage | Free: 10 GB storage, 1M Class A ops, 10M Class B ops | Standard: **$0.015/GB-mo** storage; Class A writes $4.50/M; Class B reads $0.36/M; **$0 egress**. |
| **AWS S3** | Object storage | 12-month free tier: 5 GB standard | Standard: **$0.023/GB-mo**; egress **$0.09/GB** (first 10 TB). |
| **Backblaze B2** | Cheap at-rest storage / backups | Free: 10 GB storage | **$0.00695/GB-mo**; free egress up to 3× stored volume, then $0.01/GB. |
| **MinIO** | Self-hosted S3-compatible storage | Free (open source) | Server/bandwidth cost only. |
| **Supabase Storage** | Bundled with Supabase | Included in Supabase free/pro quotas | Overage at Supabase rates. |

### 4. AI providers

At least one key is recommended; routing can fall back between providers.

| Service | Purpose | Free option | Paid options (2026) |
|---------|---------|-------------|----------------------|
| **OpenAI** | GPT models, embeddings | Trial credits on new accounts | Pay-as-you-go. GPT-4o: ~$2.50/1M input tokens, $10.00/1M output tokens. GPT-4o mini: ~$0.15/1M input, $0.60/1M output. Rates change frequently — verify on openai.com/pricing. |
| **Anthropic** | Claude models | Trial credits on new accounts | Pay-as-you-go. Claude Sonnet 4.5: ~$3.00/1M input, $15.00/1M output. Claude Opus 4.5: ~$5.00/1M input, $25.00/1M output. |
| **xAI (Grok)** | Grok models | Trial credits on new accounts | Pay-as-you-go. Verify current rates at x.ai. |

### 5. Google Workspace connectors

| Service | Purpose | Free option | Paid options (2026) |
|---------|---------|-------------|----------------------|
| **Google Cloud** | OAuth for Gmail, Calendar, Drive, Contacts | Creating an OAuth client is free | API usage is pay-as-you-go beyond free quotas (Gmail API has user-rate limits; Google Workspace subscriptions may be required for some business features). |

### 6. Payments

| Service | Purpose | Free option | Paid options (2026) |
|---------|---------|-------------|----------------------|
| **Stripe** *(recommended)* | Cards, subscriptions, wallets | No monthly fee | US online cards: **2.9% + $0.30** per transaction; international cards +1–1.5%; currency conversion +1%; chargebacks $15. Custom interchange-plus for high volume. |
| **PayPal** | Alternative wallet / bank payments | Sandbox free | Per-transaction (~2.9% + fixed fee); varies by country. |
| **WiPay** | Caribbean payments | Account required | Per-transaction; contact WiPay for rates. |

### 7. Communications (SMS / WhatsApp)

| Service | Purpose | Free option | Paid options (2026) |
|---------|---------|-------------|----------------------|
| **Twilio** | SMS, voice, WhatsApp Business API | Trial: ~$15.50 credit | US SMS: **$0.0083/segment** + carrier surcharges (~$0.0025–$0.005); US long-code number ~$1.15/mo; WhatsApp conversation fees apply on top of Twilio’s markup. |
| **Meta for Developers / WhatsApp Business Platform** | WhatsApp Cloud API, Messenger/Instagram webhooks | Cloud API signup free; sandbox free | Per-message/conversation pricing by recipient country. US examples: utility ~$0.005–$0.015, authentication ~$0.005–$0.020, marketing ~$0.01–$0.14 per message. BSP/platform fees extra if not self-hosted. |

### 8. Voice / text-to-speech

| Service | Purpose | Free option | Paid options (2026) |
|---------|---------|-------------|----------------------|
| **ElevenLabs** | AI text-to-speech / voice cloning | Free: 10K credits/mo (~10 min), non-commercial | Starter: **$5–$6/mo** (30K credits); Creator: **$22/mo** (100K+ credits); Pro: **$99/mo**; Scale/Business: **$299–$990/mo**. |

### 9. Observability

| Service | Purpose | Free option | Paid options (2026) |
|---------|---------|-------------|----------------------|
| **Sentry** | Error tracking, performance monitoring, session replay | Free: 5K errors/mo, 50 replays, 5M spans, 1 user | Team: **$26–$29/mo**; Business: **$80–$89/mo**; Enterprise: custom. Event-based overages apply. |

### 10. Hosting

| Service | Purpose | Free option | Paid options (2026) |
|---------|---------|-------------|----------------------|
| **Vercel** *(recommended for Next.js web app)* | Frontend hosting, serverless functions, preview deploys | Hobby: 100 GB bandwidth, 100 GB-hours functions, 600 build min/mo (non-commercial) | Pro: **$20/seat/mo** — 1 TB bandwidth, 1 TB-hours functions, 1,000 build min; overages $40/100 GB bandwidth, $0.128/CPU-hour, $0.014–$0.105/build min. Enterprise: custom. |
| **Netlify / Cloudflare Pages / Railway / Render** | Alternative web/API hosting | Free tiers available | Netlify Pro $19–$20/seat; Cloudflare Pages free/unlimited bandwidth with adapter; Railway/Render from ~$5–$19/mo per service. |

---

## Recommended minimum production starter stack

For a small production deployment, budget roughly:

| Layer | Service | Estimated monthly cost |
|-------|---------|------------------------|
| Auth + DB + Storage bundle | Supabase Pro | **$25** |
| Transactional email | Resend Free (3K/mo) or Pro ($20) | **$0–$20** |
| Object storage | Cloudflare R2 or Supabase Storage | **$0–$15** for light usage |
| Payments | Stripe | No monthly fee; **2.9% + 30¢** per transaction |
| AI | OpenAI + Anthropic keys | Pay-as-you-go; often **$10–$100+** depending on volume |
| Error tracking | Sentry Free or Team | **$0–$26** |
| Web hosting | Vercel Pro (1 seat) | **$20** |
| **Typical total fixed cost** | | **~$45–$110/mo** before AI usage and payment-processing fees |

Add communication channels (Twilio/WhatsApp/SMS) and marketing email only when those features are actively used.

---

## Account setup checklist

Use this checklist when provisioning a new production environment:

- [ ] **Supabase** project created; Google OAuth provider enabled; Site URL and redirect URLs configured.
- [ ] **Google Cloud** OAuth client created; consent screen configured; redirect URIs added.
- [ ] **Resend** (or Postmark/SendGrid) account created; domain verified; SPF/DKIM/DMARC configured.
- [ ] **S3-compatible storage** bucket created; CORS configured; access keys generated.
- [ ] **Stripe** account created; webhook endpoint registered; live keys swapped in.
- [ ] **OpenAI** and/or **Anthropic** API keys created; rate limits and usage alerts set.
- [ ] **Sentry** project created; DSN copied into environment.
- [ ] **Vercel** (or chosen host) project linked; environment variables pasted; production domain configured.
- [ ] **Meta/WhatsApp/Twilio** accounts created only if messaging features are required.

---

## Keeping this document current

Pricing changes frequently. Verify all numbers on the provider's own pricing page before committing to a budget. If you add a new integration or change the default provider for a capability, update this file and `.env.example` so the next deployment has a single source of truth.
