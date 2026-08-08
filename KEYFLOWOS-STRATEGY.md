# KEYFLOWOS: Strategic Product & Engineering Master Plan

> **Note (2026-07-20):** The "Screens & Features" status table below is stale — it marks Reports and Projects as "Stub," but both are fully built pages (see `KEYFLOWOS-PRODUCT-AUDIT.md`, written the same day, for the accurate current UX map). Treat the strategic/business sections of this doc as current; treat the per-module status table as historical.

---

## PHASE 1 — CURRENT STATE MAP (Verified from Code)

### What the App Does Today
KEYFLOWOS is an all-in-one business operating system for small-to-medium service businesses. It combines CRM, booking/scheduling, invoicing/quoting, commerce, social media management, automations, and AI-powered insights into a single platform with a Caribbean-first identity (TTD currency, Trinidad timezone).

### Screens & Features (User-Visible)

| Module | Route | Status | What It Does |
|--------|-------|--------|-------------|
| **Auth** | `/auth/login`, `/auth/signup` | Working | 2-step glassmorphism sign-up with Google OAuth, profile collection (name, phone, company) |
| **Onboarding** | `/app/onboarding` | Working | 4-step guided setup wizard with XP rewards |
| **Cockpit** | `/app` | Working | Dashboard with personalized greeting, flow graph, momentum indicators, AI suggestions, bottleneck detection |
| **CRM** | `/app/crm/pipeline` | Working | Contact management, pipeline view, lead scoring, timeline, AI-powered contact insights, Google Contacts import, business card OCR scanning |
| **Commerce** | `/app/commerce` | Working | Products/services CRUD, multi-item invoicing with tax/discount, quotes with conversion-to-invoice, Gmail integration for sending quotes |
| **Bookings** | `/app/bookings` | Working | Service scheduling, staff management, availability, Google Calendar sync, public booking page |
| **Store** | `/app/store` | Working | Public-facing catalog with cart, 4-step checkout, filter/sort |
| **Social** | `/app/social` | Working | Post creation, scheduling, draft management |
| **Automations** | `/app/automations` | Working | Playbook builder with trigger/action system |
| **Reports** | `/app/reports` | Stub | KPI placeholders |
| **Projects** | `/app/projects` | Stub | Project management placeholder |
| **Settings** | `/app/settings/*` | Working | Profile, business info, branding (custom colors), team management, connections (Google Calendar/Gmail), compliance checklist |
| **Public Booking** | `/book/[slug]` | Working | Customer-facing booking page with multi-service cart |
| **Public Invoice** | `/pay/[invoiceId]` | Working | Branded payment page with line item breakdown |
| **Admin** | `/admin/*` | Stub | Platform admin dashboard (hardcoded data) |

### Data Model (21 Models)
- **Identity:** User, Business, Membership, Session
- **CRM:** Contact (with timeline events, notes, tasks, import tracking, segments)
- **Commerce:** Product, Invoice/InvoiceItem, Quote/QuoteItem, Payment
- **Bookings:** Service, StaffMember, Availability, Booking
- **Social:** SocialPost, SocialConnection
- **Automation:** Automation (Playbook)
- **Projects:** Project, ProjectTask, ProjectTemplate
- **Presence:** Site, Notification, GamificationProfile, AutopilotTask

### Technology Stack
| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16 (App Router), React, TailwindCSS, PWA-enabled |
| Backend | NestJS (modular, event-driven), tsx runtime |
| Database | PostgreSQL (Replit built-in / Neon-backed), Prisma ORM |
| Auth | Supabase Auth (JWT-based, Google OAuth) |
| AI | OpenAI GPT-4o (vision for OCR, suggestions) |
| Storage | Replit Object Storage (logo uploads) |
| Email | Gmail API (OAuth, quote sending) |
| Calendar | Google Calendar API (OAuth, event sync) |
| Contacts | Google People API (import) |
| Payments | Stripe (webhook stub only, not fully integrated) |
| Package Manager | pnpm (monorepo) |

### Code Metrics
- **31,199 total lines** across 171 files
- Frontend: 86 files (~18K lines), Backend: 85 files (~10K lines)
- Largest files: Commerce page (2,570 lines), CRM service (1,460 lines)
- Dependencies: 13 frontend, 21 backend (lean)

### Identified Gaps, Risks & Fragilities

**Critical Gaps:**
1. **No real payment processing** - Stripe webhook stub exists but no checkout flow, no payment collection
2. **No WhatsApp integration** - Critical for Caribbean market where WhatsApp IS business communication
3. **No SMS/email notifications to customers** - Booking confirmations, reminders, invoice alerts don't reach customers
4. **Reports page is a stub** - No actual analytics or reporting
5. **Projects page is a stub** - Listed in nav but non-functional
6. **Admin panel uses hardcoded data** - Not connected to real metrics
7. **No recurring invoices** - Common need for service businesses
8. **No offline capability** - PWA manifest exists but no service worker caching strategy

**Architecture Risks:**
1. **Monolithic page files** - Commerce page is 2,570 lines (should be split into components)
2. **No API rate limiting** - Public endpoints (booking, store) have no protection
3. **No input sanitization on public forms** - XSS risk on booking/payment pages
4. **Token stored client-side without refresh rotation** - Session security gap
5. **No database connection pooling configuration** - Will fail under load
6. **No error boundaries** - Frontend crashes propagate to full page failures

**UX Fragilities:**
1. **Desktop-first layouts** - Mobile bottom nav exists but page content isn't optimized for thumb-zone navigation
2. **No loading skeletons** - White/blank screens during data fetch
3. **No empty states** - New users see empty tables with no guidance
4. **Long forms without save progress** - Onboarding/checkout can lose data on accidental navigation

---

## PHASE 2 — COMPETITIVE & META ANALYSIS

### A) Market & Positioning

**Category:** All-in-one Business Management Platform for Service Businesses
**Subcategory:** Caribbean-first / emerging market small business OS

**Direct Competitors:**

| Competitor | Price | Strength | Weakness vs KEYFLOWOS |
|-----------|-------|----------|----------------------|
| **Jobber** ($39-599/mo) | Field service focused | Scheduling, quoting, GPS routing | No CRM intelligence, no social, no Caribbean localization, expensive |
| **HouseCall Pro** ($59-189/mo) | Home services | Payments, dispatching | Limited CRM, no AI, no social tools, US-centric |
| **Square Appointments** ($0-69/mo) | Free tier, payments | POS integration, simple booking | No CRM, no invoicing workflow, no automation |
| **Fresha** ($0-20/mo) | Beauty/wellness | Marketplace discovery, booking | Niche to beauty, no general business tools |
| **Flowlu** (Free-$99/mo) | All-in-one | Projects, CRM, invoicing | No booking system, no social, no Caribbean focus |
| **Zoho One** ($45/user/mo) | Enterprise suite | Everything | Overwhelming complexity, enterprise pricing, no Caribbean identity |

**KEYFLOWOS Differentiation:**
1. **Caribbean-first** - TTD currency, local timezone, cultural identity (no competitor does this)
2. **All-in-one at accessible pricing** - CRM + Bookings + Invoicing + Social + AI in one app
3. **AI-native** - Built with AI from day one (not bolted on), business autopilot concept
4. **Beautiful, modern UX** - Glassmorphism dark theme vs. corporate-looking competitors
5. **Playbook-driven automation** - Pre-built workflows vs. complex "build your own" automation

**Wedge Strategy (Easiest Entry Point):**
> "Free booking page + instant invoicing" - Get businesses online and collecting money in under 5 minutes. This is the hook. Everything else (CRM, automation, AI) is the moat.

### B) Tech Strategy

**"Highest Tech" Opportunities:**
1. **AI Business Copilot** - Natural language commands: "Invoice Sarah for last Tuesday's appointment" or "What's my revenue this month?"
2. **Smart Scheduling** - AI-optimized slot suggestions based on travel time, preferences, staff efficiency
3. **Predictive Cash Flow** - AI forecasting based on booking patterns, invoice history, seasonal trends
4. **WhatsApp Business API** - Automated booking confirmations, payment reminders, follow-ups via WhatsApp
5. **Voice-to-Action** - "Hey KeyFlow, book Mrs. Johnson for a haircut tomorrow at 3pm" (mobile-first interaction)
6. **Auto-generated Social Content** - AI creates social posts from completed jobs, reviews, milestones

### C) Financial Strategy

**Recommended Pricing Model: Tiered Access**

| Tier | Price | Target | What's Included |
|------|-------|--------|----------------|
| **Free (Starter)** | $0/mo | Solo operators testing the waters | 1 user, public booking page, 20 bookings/mo, 5 invoices/mo, basic CRM (50 contacts), KeyFlow branding on public pages |
| **Flow** | $29/mo (or ~190 TTD) | Solo-to-small businesses | 3 users, unlimited bookings & invoices, full CRM, automation playbooks, remove branding, email reminders |
| **Flow Pro** | $79/mo (or ~530 TTD) | Growing businesses with staff | 10 users, AI copilot, advanced reporting, WhatsApp integration, Google Calendar sync, priority support |
| **Flow Business** | $149/mo (or ~1,000 TTD) | Medium operations | 25 users, custom domain, API access, dedicated support, white-label options |

**Unit Economics (Assumptions labeled):**
- **CAC** (Assumption): $15-30 via social media/referrals in Caribbean market (lower than US because of community-driven word of mouth)
- **LTV** at Flow tier: $29 x 18 months avg retention = $522
- **LTV/CAC ratio**: ~17:1 (excellent, target is >3:1)
- **Gross margin**: ~85% (hosting ~$5/user, AI costs ~$2-5/user on usage)
- **Breakeven**: ~100 paying users at Flow tier = $2,900 MRR

### D) Social & Growth Strategy

**Growth Loops:**
1. **Viral booking page** - Every public booking page has subtle "Powered by KeyFlow" branding (free tier). Each customer who books becomes a potential business owner who sees the tool.
2. **WhatsApp sharing** - "Share your booking link via WhatsApp" is a natural Caribbean distribution channel.
3. **Referral program** - "Invite a business owner, both get 1 month free" - leverages tight-knit Caribbean business communities.
4. **Success stories** - Automated case studies: "KeyFlow helped [Business] increase bookings by 40%" - built from real platform data.
5. **Local events/partnerships** - Trinidad Carnival vendors, market sellers, festival service providers.

**Distribution Channels:**
1. WhatsApp groups (free, organic, Caribbean-dominant)
2. Instagram/TikTok (show the beautiful UI, before/after business transformation)
3. Local business associations and chambers of commerce
4. Google search (SEO for "booking app Trinidad", "invoice software Caribbean")
5. In-person demos at business meetups

### E) Where We Stand vs. Competitors

**Advantages:**
- More comprehensive feature set than any single competitor at the target price
- Caribbean localization (unique, no competitor does this)
- Modern, beautiful UI (competitors look dated)
- AI-native architecture
- Event-driven automation backbone

**Gaps vs. Competitors:**
- No real payment collection (all competitors have this)
- No WhatsApp (critical for target market)
- No customer-facing notifications (booking confirmation, reminders)
- No mobile app (PWA exists but needs offline work)
- No real reporting/analytics

### Top 10 Highest-Leverage Opportunities

1. **Payment collection** (Stripe checkout) - Can't run a business without collecting money
2. **WhatsApp integration** - #1 communication channel for target market
3. **Customer notifications** (email + SMS) - Booking confirmations, payment reminders
4. **Mobile-first UX overhaul** - Thumb-zone navigation, gesture-based interactions
5. **AI Copilot chat** - Natural language business commands
6. **Real reporting dashboard** - Revenue, bookings, client retention metrics
7. **Recurring invoices** - Subscription/retainer business model support
8. **Offline mode** - Service workers for core features when connectivity is poor
9. **Quick onboarding flow** - "Business online in 2 minutes" - not 4-step wizard
10. **Public marketplace/directory** - Discover local businesses on KeyFlow

### Top 5 Risks If We Do Nothing

1. **No revenue collection = no value proposition** - Users leave when they can't actually collect payment
2. **No notifications = missed bookings** - Customers don't show up, business owners blame the app
3. **Mobile experience friction** - Target users are phone-first; if the mobile UX isn't exceptional, they'll abandon
4. **Competitor land-grab** - Square/Fresha expanding into Caribbean markets
5. **Technical debt accumulation** - 2,570-line page files become unmaintainable

### Unfair Advantages We Can Build

1. **Caribbean identity & localization** - No global player will prioritize this market
2. **AI-native architecture** - Competitors bolt on AI; we build around it
3. **Community-driven growth** - Caribbean business communities are tight-knit; word of mouth is powerful
4. **All-in-one simplicity** - Eliminate the "tool maze" (our core thesis)
5. **Beautiful, opinionated UX** - When the tool feels premium, it builds trust and loyalty

---

## PHASE 3 — MASTER PLAN

### North Star Metric
> **Monthly Active Businesses (MAB)** - Businesses that complete at least 1 booking OR send 1 invoice per month

**Supporting Metrics:**
1. **Time-to-First-Value (TTFV)** - Minutes from sign-up to first booking page live (target: <5 min)
2. **Revenue Processed** - Total TTD/USD flowing through KeyFlow monthly
3. **Booking Completion Rate** - % of public bookings that convert to completed appointments

---

### Product Roadmap

#### QUICK WINS (1-3 days each)

**QW-1: Empty States & Onboarding Nudges**
- **What:** Add helpful empty states with CTAs when modules have no data ("No bookings yet. Create your first service to start accepting bookings.")
- **Why:** New users see blank screens and don't know what to do next (critical drop-off point)
- **How:** Create reusable EmptyState component, add to all list/table views
- **Files:** New component + all page files (commerce, bookings, CRM, etc.)
- **Acceptance:** Every empty module shows a helpful message + primary action button

**QW-2: Loading Skeletons**
- **What:** Replace blank loading screens with shimmer/skeleton placeholders
- **Why:** Perceived performance improvement; reduces "is it broken?" moments
- **How:** Create SkeletonCard, SkeletonTable, SkeletonList components
- **Files:** New components + all pages that fetch data
- **Acceptance:** No blank screens during any data fetch

**QW-3: Mobile Touch Targets & Spacing**
- **What:** Audit all tap targets (minimum 44x44px per Apple HIG), increase spacing on mobile
- **Why:** Phone-first users need comfortable touch interaction
- **How:** Audit with mobile viewport, adjust padding/margins using Tailwind responsive classes
- **Files:** All page files, globals.css
- **Acceptance:** No tap target smaller than 44px on mobile viewport

**QW-4: Commerce Page Split**
- **What:** Break the 2,570-line commerce page into components (ProductsTab, InvoicesTab, QuotesTab, InvoiceBuilder, QuoteBuilder)
- **Why:** Unmaintainable monolith; slows development velocity
- **How:** Extract each tab + builder modal into separate component files
- **Files:** `apps/web/src/app/app/commerce/` directory with 5+ component files
- **Acceptance:** Commerce page under 200 lines, all functionality preserved

**QW-5: "Share Booking Link" Button**
- **What:** Add prominent "Share" button on bookings page that copies link or opens WhatsApp/SMS share
- **Why:** #1 growth loop - getting the booking link into customers' hands
- **How:** Web Share API (mobile-native share sheet) with fallback to clipboard copy
- **Files:** Bookings page, store page, settings
- **Acceptance:** One-tap share on mobile opens native share sheet; desktop copies to clipboard

#### SPRINT WINS (1-2 weeks each)

**SW-1: Customer Email Notifications**
- **What:** Send email on booking.created (confirmation), booking.confirmed, invoice.sent, invoice.overdue (reminder), payment.received (receipt)
- **Why:** Without notifications, customers miss appointments and forget invoices. Business owners look unprofessional.
- **How:** Add email service (Resend or SendGrid), event listeners on existing event bus, email templates with business branding
- **Files:** New EmailService, email templates, event listeners
- **Risks:** Email deliverability; mitigate with verified sender domain
- **Acceptance:** Customer receives branded email within 60 seconds of each event

**SW-2: Stripe Payment Integration**
- **What:** Full checkout flow - customer clicks "Pay" on invoice page, Stripe checkout session, webhook confirms payment, invoice status updates
- **Why:** Can't run a business without collecting money. This is the #1 feature gap.
- **How:** Stripe integration (checkout sessions), update pay/[invoiceId] page with real payment button, enhance webhook controller
- **Files:** Webhooks controller, commerce service, pay page, new Stripe service
- **Risks:** PCI compliance (mitigated by using Stripe hosted checkout)
- **Acceptance:** End-to-end: create invoice -> customer opens link -> pays with card -> invoice auto-marked paid

**SW-3: Real Reporting Dashboard**
- **What:** Replace stub with actual metrics: Revenue (this month/trend), Bookings (completed/no-show/cancelled), Top services, Client retention, Outstanding invoices
- **Why:** Business owners need to see if their business is growing. "Business at your fingertips."
- **How:** Backend aggregation endpoints, frontend charts (recharts or chart.js), date range filters
- **Files:** New ReportsService, reports controller, reports page rebuild
- **Acceptance:** 6 real KPI cards + 2 trend charts populated from actual business data

**SW-4: Mobile-First Navigation Redesign**
- **What:** Redesign bottom nav with 5 most-used items (Home, Bookings, + Create, Clients, More), swipe gestures between sections, floating action button for quick actions
- **Why:** Phone-primary users need thumb-friendly navigation. Current bottom nav has too many items.
- **How:** Reduce bottom nav to 5 items, add FAB for "New Booking / New Invoice / New Contact", implement swipe gestures
- **Files:** App layout, mobile nav component, new FAB component
- **Acceptance:** All primary actions reachable with one hand on mobile

**SW-5: Quick-Start Onboarding (2-Minute Flow)**
- **What:** Simplify onboarding to: 1) Business name + type, 2) Add your first service (name + price + duration), 3) Your booking page is live! Share it.
- **Why:** Current 4-step wizard feels like homework. Goal: value in under 2 minutes.
- **How:** Streamlined 3-screen flow with smart defaults (auto-generate slug, default availability), skip option for detailed setup
- **Files:** Onboarding page, identity service (bootstrap endpoint)
- **Acceptance:** New user has live booking page within 2 minutes of sign-up

#### MAJOR UPGRADES (3-8+ weeks)

**MU-1: WhatsApp Business Integration**
- **What:** Send booking confirmations, reminders, invoice links via WhatsApp. Receive replies.
- **Why:** WhatsApp has 95%+ penetration in Caribbean. It's how businesses communicate.
- **How:** WhatsApp Business API (via Twilio or Meta direct), message templates, event-driven triggers
- **Files:** New WhatsAppService, message templates, settings UI for connecting number
- **Risks:** WhatsApp Business API approval process (2-4 weeks); message template review
- **Acceptance:** Booking confirmation arrives via WhatsApp within 30 seconds

**MU-2: AI Business Copilot**
- **What:** Chat interface where business owners can ask questions and give commands in natural language
- **Why:** "Business at your fingertips" means talking to your business, not navigating menus
- **How:** OpenAI function calling with business data context, floating chat widget, command execution (create booking, send invoice, check revenue)
- **Files:** New CopilotService, chat UI component, function definitions for each module
- **Acceptance:** "How much did I make this week?" returns accurate answer; "Invoice Maria for $500" creates draft invoice

**MU-3: Offline-First PWA**
- **What:** Core features work without internet - view schedule, see contacts, queue actions for sync
- **Why:** Caribbean connectivity can be unreliable; field workers need access between appointments
- **How:** Service worker with Workbox, IndexedDB for local data cache, background sync API for queued actions
- **Files:** Service worker, sync manager, all data-fetching hooks (add offline fallback)
- **Acceptance:** User can view today's schedule and contact details with no internet connection

**MU-4: Recurring Invoices & Subscriptions**
- **What:** Auto-generate invoices on a schedule (weekly, monthly, custom) for retainer/subscription clients
- **Why:** Many service businesses have repeat clients on recurring schedules
- **How:** RecurringInvoice model, cron job for generation, notification on creation
- **Files:** New Prisma model, recurring invoice service, commerce UI additions
- **Acceptance:** Monthly recurring invoice auto-generates and notifies client on the 1st

**MU-5: Public Business Directory / Marketplace**
- **What:** Discover page where customers can find KeyFlow businesses by category and location
- **Why:** Network effect growth loop - more businesses = more customer discovery = more businesses
- **How:** Public business listing page, category tagging, location-based search, SEO optimization
- **Files:** New public pages, business profile enhancements, search service
- **Acceptance:** Google-indexable directory of businesses with booking links

**MU-6: Tiered Access & Billing System**
- **What:** Implement the Free/Flow/Flow Pro/Flow Business pricing tiers with feature gating
- **Why:** Revenue! Must monetize to sustain and grow.
- **How:** Subscription management (Stripe Billing), feature flags per tier, upgrade/downgrade flow, usage tracking
- **Files:** New SubscriptionService, feature gate middleware, billing UI, plan selection page
- **Acceptance:** Free user hits booking limit, sees upgrade prompt, can subscribe via Stripe

### Mobile-First UX Priorities

1. **Bottom sheet modals** instead of full-page forms (create booking, new contact)
2. **Pull-to-refresh** on all list views
3. **Haptic feedback** on key actions (booking confirmed, payment received)
4. **Swipe actions** on list items (swipe to call, swipe to invoice)
5. **Sticky headers** with context (today's date, booking count)
6. **Dark mode optimized** (already dark theme, but ensure WCAG AA contrast on all text)
7. **Keyboard avoidance** on all forms (input fields never hidden behind keyboard)
8. **Progressive image loading** (blur-up technique for contact photos, product images)

### "Highest Tech" Feature Candidates

| Feature | Feasibility | Cost | Competitive Advantage |
|---------|------------|------|----------------------|
| **AI Copilot (NL commands)** | High (OpenAI function calling) | ~$2-5/user/mo AI costs | High - no competitor in this market has it |
| **Smart Scheduling (AI)** | Medium (needs historical data) | Minimal (runs on existing data) | Medium - Jobber has basic version |
| **Predictive Cash Flow** | Medium (needs 3+ months data) | Minimal | High - powerful for financial planning |
| **WhatsApp Automation** | High (proven APIs) | $15-50/mo for API access | Very High - market essential |
| **Voice Commands** | Medium (Web Speech API) | Minimal (browser-native) | High - truly "at your fingertips" |
| **Auto Social Content** | High (GPT-4) | ~$1/post | Medium - nice-to-have, not core |
| **Business Card OCR** | Already built! | Already running | Already a differentiator |

---

## PHASE 4 — EXECUTION PACKAGE

### Next Milestone: "Revenue-Ready MVP" (4 weeks)

**Goal:** A new user can sign up, create services, accept bookings, send invoices, collect payment, and see their revenue - all from their phone.

### Task Breakdown (Priority Order)

| # | Task | Priority | Depends On | Effort |
|---|------|----------|-----------|--------|
| 1 | Commerce page component split | P0 | None | 1 day |
| 2 | Empty states + loading skeletons | P0 | None | 1 day |
| 3 | Quick-start onboarding (2-min flow) | P0 | None | 2 days |
| 4 | Share booking link (Web Share API) | P0 | None | 0.5 day |
| 5 | Mobile touch target audit + fixes | P0 | None | 1 day |
| 6 | Stripe payment integration | P0 | None | 3-4 days |
| 7 | Customer email notifications | P0 | #6 | 3 days |
| 8 | Real reporting dashboard | P1 | None | 3-4 days |
| 9 | Mobile nav redesign + FAB | P1 | None | 2 days |
| 10 | Recurring invoices | P1 | #6 | 2-3 days |
| 11 | WhatsApp integration | P1 | None | 5-7 days |
| 12 | AI Copilot v1 | P2 | None | 5-7 days |
| 13 | Offline PWA | P2 | None | 5-7 days |
| 14 | Tiered billing | P2 | #6 | 5-7 days |
| 15 | Public directory | P2 | None | 3-5 days |

### Milestone Timeline (Conservative)

| Week | Focus | Deliverable |
|------|-------|------------|
| 1 | Foundation | Commerce split, empty states, skeletons, touch targets, share button |
| 2 | Payments & Onboarding | Stripe integration, quick-start flow, mobile nav |
| 3 | Communication | Email notifications, reporting dashboard |
| 4 | Growth | WhatsApp v1, recurring invoices, polish & testing |

### Definition of Done Checklist

- [ ] All features work on mobile viewport (375px width)
- [ ] No empty screens - every module has empty state or skeleton
- [ ] Payment flow works end-to-end (create -> pay -> confirm)
- [ ] Booking creates customer notification (email minimum)
- [ ] Share button works on iOS Safari and Android Chrome
- [ ] Page load under 3 seconds on 3G connection
- [ ] No console errors in production
- [ ] All public endpoints have rate limiting
- [ ] WCAG AA contrast ratios on all text

### Post-Launch Monitoring Plan

1. **Error tracking** - Add Sentry or similar for frontend + backend error monitoring
2. **Performance** - Monitor Core Web Vitals (LCP, FID, CLS) via web-vitals library
3. **Funnel tracking** - Sign-up -> Onboarding complete -> First booking -> First invoice -> First payment
4. **Usage metrics** - Daily/weekly active businesses, feature adoption rates
5. **Revenue metrics** - MRR, churn rate, upgrade rate, ARPU
6. **Customer feedback** - In-app feedback widget, NPS surveys at key moments

---

## Summary

KEYFLOWOS has an impressive foundation - 31K lines of working code across a full business management suite with AI integration, beautiful design, and Caribbean identity. The core thesis ("eliminate the tool maze") is strong and the market timing is right.

**The three things that will make or break the next phase:**
1. **Payment collection** - Without it, the app is a demo, not a business tool
2. **Customer notifications** - Without them, bookings are unreliable
3. **Mobile-first UX** - Your users live on their phones; the experience must be exceptional there

The competitive landscape shows no one owning the Caribbean small business market. KEYFLOWOS has a genuine opportunity to become the default business OS for service businesses in the region, and then expand.

**Recommended immediate focus:** Quick wins (Week 1) + Stripe payments (Week 2) to create a "Revenue-Ready" version that proves the core loop works.
