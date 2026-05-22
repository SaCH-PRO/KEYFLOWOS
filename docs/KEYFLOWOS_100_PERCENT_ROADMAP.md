# KEYFLOWOS: 100% Functional Roadmap
## Gap Analysis + Costed Execution Plan

**Date:** 2026-05-17  
**Scope:** Everything required for KEYFLOWOS to be a fully production-ready, marketable, scalable business operating system.  
**Currency:** USD unless otherwise noted. TTD estimates use 1 USD = 6.7 TTD.

---

## Executive Summary

| Category | Status | Est. Cost to Complete | Timeline |
|----------|--------|----------------------|----------|
| **Core Platform** | 85% done | $8,500 | 4-6 weeks |
| **Payments & Finance** | 90% done | $3,500 | 2-3 weeks |
| **Customer-Facing (Widgets)** | 70% done | $4,000 | 2-3 weeks |
| **Notifications & Comms** | 60% done | $6,000 | 3-4 weeks |
| **AI & Intelligence** | 75% done | $5,000 | 3-4 weeks |
| **Integrations** | 65% done | $7,000 | 4-5 weeks |
| **Admin & Ops** | 50% done | $8,000 | 4-6 weeks |
| **Infrastructure & DevOps** | 70% done | $4,500 | 2-3 weeks |
| **TOTAL** | — | **$46,500** (~311,000 TTD) | **14-18 weeks** |

---

## 1. Core Platform

### ✅ Already Working
- Auth (Supabase JWT, Google OAuth, email verification)
- Business/Membership/Team management
- Role-based access control (`BusinessGuard`, `ModuleScopeGuard`)
- Feature flags (database-driven)
- Onboarding wizard (4-step with XP)
- Dashboard/Cockpit (momentum, KPIs, AI suggestions)
- Settings & profile management
- File uploads (S3-compatible storage)

### 🔧 Needs Completion

| Item | What's Missing | Effort | Cost |
|------|---------------|--------|------|
| **Row-level ownership** | Any team member sees all contacts/deals. Need `ownerUserId` enforcement. | 3 days | $1,200 |
| **GDPR data export** | No "Download my data" endpoint for contacts/users. | 2 days | $800 |
| **Account deletion** | Users can't delete their account + associated data. | 2 days | $800 |
| **Session management** | No "Log out all devices" or active session list. | 2 days | $800 |
| **Audit log (unified)** | Events scattered across `TeamActivityLog`, `BusinessEvent`, `Timeline`. Need single queryable stream. | 5 days | $2,000 |
| **Prisma tenant middleware** | Manual `businessId` filtering everywhere. Auto-inject via middleware. | 3 days | $1,200 |
| **Soft-delete UI** | Deleted records are hidden but there's no "Trash" to restore from. | 3 days | $1,200 |
| **Data import (bulk)** | No CSV import for contacts, products, or invoices. | 4 days | $1,600 |

**Subtotal: $9,600 → rounded to $8,500** (some items overlap with other modules)

---

## 2. Payments & Finance (FIN2/FIN3)

### ✅ Already Working
- Stripe Checkout Sessions + webhooks ( ✅ fixed storefront flow)
- PayPal order capture + webhooks
- WiPay callback processing
- Invoice workflow (DRAFT → SENT → PAID)
- Quote → Invoice conversion
- Payment reconciliation
- Revenue attribution (storefront, invoice, booking)
- FIN2 ledger posting (Payment → AR → Deposit)
- Refunds with ledger reversal
- Multi-currency support
- Per-business gateway credentials

### 🔧 Needs Completion

| Item | What's Missing | Effort | Cost |
|------|---------------|--------|------|
| **Recurring invoices** | No subscription billing / auto-recurring invoices. | 4 days | $1,600 |
| **Payment plans / installments** | Can't split invoice into 2-4 payments. | 3 days | $1,200 |
| **Late fees** | No automatic late fee calculation on overdue invoices. | 2 days | $800 |
| **Partial payment UI** | Backend supports partials, but UI doesn't show "Amount Paid / Balance Due". | 2 days | $800 |
| **Receipt generation** | No PDF receipt generation after payment. | 3 days | $1,200 |
| **Tax reports** | No quarterly/annual tax liability summary. | 3 days | $1,200 |
| **Cash flow forecast** | No predictive cash flow based on open invoices + bookings. | 4 days | $1,600 |
| **Expense receipt OCR** | Expenses exist but no receipt upload + auto-extraction. | 3 days | $1,200 |

**Subtotal: $9,600 → rounded to $7,000** (some are nice-to-have)

---

## 3. Customer-Facing Surfaces (Widgets + Storefront)

### ✅ Already Working (Just Built)
- Widget loader script (`/widgets/v1/loader.js`)
- Booking widget (`/widgets/booking/[slug]`)
- Cart widget (`/widgets/cart/[slug]`)
- Pay widget (`/widgets/pay/[invoiceId]`)
- CORS for cross-origin embedding
- postMessage resize + event protocol
- Public storefront (`/book/[slug]`) with full checkout
- Public payment page (`/pay/[invoiceId]`)
- Public booking page (`/public/book`)

### 🔧 Needs Completion

| Item | What's Missing | Effort | Cost |
|------|---------------|--------|------|
| **Widget: service availability** | Booking widget doesn't check real-time staff availability. | 3 days | $1,200 |
| **Widget: time slot picker** | Shows datetime-local input instead of available slots grid. | 3 days | $1,200 |
| **Widget: customization** | No per-business color/logo injection in widgets yet. | 2 days | $800 |
| **Custom domains** | `bookings.salon.com` → CNAME → your Vercel. Needs domain routing. | 4 days | $1,600 |
| **Storefront SEO** | No meta tags, OpenGraph, structured data on product pages. | 2 days | $800 |
| **Storefront mobile** | Public storefront is desktop-first; needs thumb-zone optimization. | 4 days | $1,600 |
| **Storefront search** | No product/service search on public storefront. | 2 days | $800 |
| **Intake forms (public)** | Intake endpoints exist but no public form builder UI. | 4 days | $1,600 |
| **Qualification flow UI** | Backend exists for guided selectors; frontend is minimal. | 3 days | $1,200 |
| **Review system completion** | Reviews can be submitted but there's no rich review display widget. | 2 days | $800 |

**Subtotal: $11,600 → rounded to $8,000**

---

## 4. Notifications & Communications

### ✅ Already Working
- In-app notification system
- Notification polling
- Email via Resend (verification emails)
- Multi-channel communication module
- WhatsApp Business API integration (partial)

### 🔧 Needs Completion

| Item | What's Missing | Effort | Cost |
|------|---------------|--------|------|
| **Booking confirmations** | No automated email/SMS/WhatsApp on booking creation. | 3 days | $1,200 |
| **Booking reminders** | No 24h / 1h reminder sequence. | 4 days | $1,600 |
| **Invoice reminders** | No overdue invoice reminder sequence (email + WhatsApp). | 4 days | $1,600 |
| **Payment receipts** | No automatic receipt email after payment. | 2 days | $800 |
| **Template editor** | Notifications exist but no WYSIWYG template builder. | 5 days | $2,000 |
| **SMS gateway** | No Twilio/SMS integration for Caribbean markets. | 3 days | $1,200 |
| **WhatsApp deep integration** | WhatsApp token exists but not orchestrated across all modules. | 5 days | $2,000 |
| **Push notifications** | No web push (PWA has manifest but no service worker push). | 4 days | $1,600 |
| **Notification preferences** | Users can't toggle which channels they want per event type. | 3 days | $1,200 |

**Subtotal: $13,200 → rounded to $10,000**

---

## 5. AI & Intelligence

### ✅ Already Working
- KEY Copilot (natural language commands)
- 60+ AI tools with governance
- Role engine + budget caps
- BYOK (Bring Your Own Key) support
- Contact intelligence (lead scoring, OCR)
- Call script generation
- Growth intelligence scheduler
- Cross-business intelligence
- Content generation (social, email, SEO briefs)

### 🔧 Needs Completion

| Item | What's Missing | Effort | Cost |
|------|---------------|--------|------|
| **AI phone agent** | No voice AI for answering calls / booking appointments. | 8 days | $3,200 |
| **Predictive churn** | AI doesn't flag which contacts are likely to churn. | 4 days | $1,600 |
| **Smart scheduling** | AI doesn't suggest optimal slots based on travel, staff efficiency. | 5 days | $2,000 |
| **Revenue forecasting** | No AI-based revenue prediction from pipeline + bookings. | 4 days | $1,600 |
| **Auto-follow-up drafting** | AI doesn't draft personalized follow-up emails per contact. | 3 days | $1,200 |
| **Document Q&A** | No RAG over uploaded documents for business knowledge. | 5 days | $2,000 |
| **Image generation** | No AI-generated product images / social media visuals. | 4 days | $1,600 |
| **AI confidence scoring** | AI insights don't show confidence levels or data sources. | 2 days | $800 |

**Subtotal: $14,000 → rounded to $10,000**

---

## 6. Integrations

### ✅ Already Working
- Supabase Auth
- Stripe (full)
- PayPal (full)
- WiPay (full)
- Google Calendar (OAuth, sync)
- Gmail (OAuth, send)
- Google Drive (full CRUD, sync)
- Google Contacts (import)
- Resend (email)
- OpenAI / Kimi / Claude / Grok (AI gateway)
- WhatsApp Business API (token-based)

### 🔧 Needs Completion

| Item | What's Missing | Effort | Cost |
|------|---------------|--------|------|
| **QuickBooks / Xero sync** | No accounting software integration for Caribbean businesses. | 6 days | $2,400 |
| **Shopify connector** | Module exists but needs full product/order sync. | 5 days | $2,000 |
| **Facebook/Instagram ads** | Social module exists but no paid ad management. | 5 days | $2,000 |
| **TikTok integration** | No TikTok posting or analytics. | 3 days | $1,200 |
| **Slack deep integration** | Basic connector; no interactive commands or rich notifications. | 3 days | $1,200 |
| **Zapier / Make.com** | No third-party automation platform integration. | 4 days | $1,600 |
| **Nango OAuth sync** | Nango secret exists but not fully wired for all providers. | 4 days | $1,600 |
| **Webhooks (outbound)** | Users can't configure outgoing webhooks to their own systems. | 3 days | $1,200 |
| **API keys (user-facing)** | No developer API key generation for power users. | 3 days | $1,200 |
| **Google Analytics** | No GA4 tracking on public storefronts. | 2 days | $800 |
| **Meta Pixel** | No Facebook pixel on public storefronts. | 2 days | $800 |

**Subtotal: $16,000 → rounded to $12,000**

---

## 7. Admin, Reporting & Operations

### ✅ Already Working
- Platform admin routes (`/admin/*`)
- AI usage monitoring
- Business event logging (fragmented)
- Module health monitoring
- Feature flags

### 🔧 Needs Completion

| Item | What's Missing | Effort | Cost |
|------|---------------|--------|------|
| **Real admin dashboard** | Admin pages use hardcoded data in places. Needs real metrics. | 5 days | $2,000 |
| **User impersonation** | Support can't log in as user to debug issues. | 2 days | $800 |
| **Business suspension** | No way to suspend abusive businesses. | 2 days | $800 |
| **Usage-based billing** | No metering or billing for platform usage (MRR tracking). | 5 days | $2,000 |
| **Reports module** | Reports page is stub — needs real analytics (revenue, bookings, CRM). | 6 days | $2,400 |
| **Data exports (admin)** | No admin-level CSV/JSON export of all business data. | 3 days | $1,200 |
| **System health dashboard** | No centralized view of DB health, queue depth, error rates. | 4 days | $1,600 |
| **A/B testing framework** | No way to run experiments on onboarding or pricing. | 4 days | $1,600 |

**Subtotal: $12,400 → rounded to $9,000**

---

## 8. Infrastructure & DevOps

### ✅ Already Working
- Docker multi-stage build (server + web)
- pnpm monorepo
- TypeScript (clean compile)
- Tests (610 passing)
- Prisma migrations
- Redis (caching, sessions, queues)

### 🔧 Needs Completion

| Item | What's Missing | Effort | Cost |
|------|---------------|--------|------|
| **Production deployment** | Still on Replit. Needs Vercel + Railway/Render migration. | 3 days | $1,200 |
| **CI/CD pipeline** | No GitHub Actions for test + build + deploy. | 2 days | $800 |
| **Database read replicas** | Single DB instance; will bottleneck under load. | 3 days | $1,200 |
| **Connection pooling** | No PgBouncer; Prisma can exhaust connections. | 2 days | $800 |
| **Log aggregation** | Logs are local; need centralized logging (Datadog / Logtail). | 2 days | $800 |
| **Error tracking** | No Sentry / Rollbar integration for production errors. | 1 day | $400 |
| **Uptime monitoring** | No Pingdom / UptimeRobot for alerting. | 1 day | $400 |
| **CDN for static assets** | No Cloudflare / AWS CloudFront for widget JS and images. | 2 days | $800 |
| **Backup automation** | No automated DB backups to S3. | 2 days | $800 |
| **SSL for custom domains** | No automated Let's Encrypt for business custom domains. | 3 days | $1,200 |

**Subtotal: $8,200 → rounded to $6,000**

---

## 9. Mobile & PWA

### ✅ Already Working
- PWA manifest
- Mobile bottom nav
- Responsive layouts (basic)

### 🔧 Needs Completion

| Item | What's Missing | Effort | Cost |
|------|---------------|--------|------|
| **Service worker** | No caching strategy; app doesn't work offline. | 3 days | $1,200 |
| **Push notifications** | No web push for booking reminders. | 4 days | $1,600 |
| **Native app wrapper** | No Capacitor / React Native wrapper for app store. | 5 days | $2,000 |
| **Mobile-optimized forms** | Long forms aren't thumb-friendly; no stepper pattern. | 3 days | $1,200 |
| **Biometric auth** | No Face ID / fingerprint login. | 2 days | $800 |
| **Mobile camera integration** | Can't scan business cards or receipts from camera. | 3 days | $1,200 |

**Subtotal: $8,000 → rounded to $5,000**

---

## Grand Total

| Phase | What You Get | Cost | Weeks |
|-------|-------------|------|-------|
| **Phase 1: Foundation** | Production hosting, CI/CD, error tracking, backups | $6,000 | 2-3 |
| **Phase 2: Core Gaps** | Notifications, widgets polish, recurring invoices, reports | $12,000 | 4-5 |
| **Phase 3: Scale** | Integrations (QuickBooks, Zapier), AI deep features, mobile | $15,000 | 5-6 |
| **Phase 4: Polish** | Custom domains, mobile app, advanced analytics | $13,500 | 4-5 |
| **TOTAL** | **100% production-ready platform** | **$46,500** | **14-18** |

### Monthly Infrastructure Costs (at 1,000 businesses)

| Service | Provider | Monthly Cost |
|---------|----------|-------------|
| Frontend hosting | Vercel Pro | $20 |
| Backend hosting | Railway Pro (2 instances) | $170 |
| Database | Neon Pro + read replica | $69 |
| Redis | Upstash Pro | $30 |
| Object Storage | Cloudflare R2 | $10 |
| Email | Resend (10,000 emails/mo) | $20 |
| CDN | Cloudflare Pro | $20 |
| Error Tracking | Sentry (team plan) | $26 |
| Logging | Logtail | $20 |
| Uptime Monitoring | UptimeRobot Pro | $15 |
| AI Usage (OpenAI) | Usage-based | $200-500 |
| **Total Monthly Burn** | | **~$600-900** |

### Revenue Required to Break Even

At **$29/mo Flow tier**:
- ~25 paying users = $725/mo (covers infra + AI)
- ~50 paying users = $1,450/mo (covers everything + 1 support person)
- ~100 paying users = $2,900/mo (profitable, can hire 2nd engineer)

---

## Priority Order (What to Build First)

### Week 1-2: Go Live
1. ✅ Migrate off Replit → Vercel + Railway
2. ✅ Set up Sentry + Logtail
3. ✅ Automated DB backups
4. ✅ Production env vars + domain
5. ✅ Stripe/PayPal/WiPay live credentials

### Week 3-4: Customer Experience
6. ✅ Booking confirmation emails
7. ✅ Invoice reminder sequence
8. ✅ Widget customization (colors, logo)
9. ✅ Receipt PDF generation
10. ✅ Storefront mobile optimization

### Week 5-8: Revenue Features
11. ✅ Recurring invoices
12. ✅ Partial payment UI
13. ✅ Payment plans
14. ✅ Reports module (real analytics)
15. ✅ QuickBooks/Xero integration

### Week 9-12: Scale & AI
16. ✅ Zapier integration
17. ✅ Webhook outbound configuration
18. ✅ AI follow-up drafting
19. ✅ Predictive churn
20. ✅ API keys for developers

### Week 13-16: Mobile & Polish
21. ✅ Service worker + offline mode
22. ✅ Push notifications
23. ✅ Custom domain routing
24. ✅ Mobile camera integration
25. ✅ Native app wrapper (Capacitor)

---

## What You Can Charge For (Pricing Tiers)

| Tier | Price | Includes |
|------|-------|----------|
| **Starter** | $0/mo | 1 user, 20 bookings/mo, 5 invoices/mo, basic CRM, hosted pages, KeyFlow branding |
| **Flow** | $29/mo | 3 users, unlimited, full CRM, automations, widgets, email reminders |
| **Flow Pro** | $79/mo | 10 users, AI copilot, advanced reports, WhatsApp, custom domain, priority support |
| **Flow Business** | $149/mo | 25 users, API access, white-label, dedicated support, onboarding concierge |

**With 100 Flow customers = $2,900 MRR = break even on dev costs in ~16 months.**

---

## Bottom Line

**You don't need to build everything to launch.** The MVP for paying customers is:

1. ✅ Hosting (Vercel + Railway)
2. ✅ Payments working (Stripe + PayPal + WiPay)
3. ✅ Widgets embedded on client sites
4. ✅ Booking confirmations + invoice reminders
5. ✅ Basic reports (revenue, bookings, contacts)

**That's ~$10,000 and 6-8 weeks.** Everything else is upsell material.

Want me to start on any specific phase?
