# KEYFLOWOS Monorepo

## Overview
KEYFLOWOS is an AI-powered operating system designed for service businesses to streamline operations and eliminate the "tool maze." It provides pre-built Playbooks for common workflows, features a "Cockpit" dashboard with a Flow Graph visualization, an AI-driven Flow Feed, and a comprehensive CRM acting as the intelligence layer. The system aims to achieve 80-90% automation of business operations. It's envisioned as an Operating System for business ownership, comprising 6 interconnected engines: LaunchFlow, OperateAI, GrowthStack, ProfitLens, ScaleHub, and MasterClass Mode.

## User Preferences
- Caribbean localization (TTD currency, Trinidad timezone)
- Glassmorphism UI with dark theme
- Event-driven architecture for automation
- Pre-opinionated flows (Playbooks)

## System Architecture
The project is structured as a monorepo containing a Next.js 16 frontend (`apps/web`) and a NestJS backend API (`apps/server`). It leverages PostgreSQL via Prisma for database management.

**UI/UX Decisions:**
- A complete design system overhaul with a unique KeyFlow identity, using a warm Caribbean-inspired palette (Sunset Orange primary, Caribbean Teal secondary).
- Progressive Web App (PWA) capabilities for installability and offline support.
- Glassmorphism UI elements and a dark theme.
- Redesigned sidebar with icon-first navigation and a collapsible width.
- Unified component classes (e.g., `kf-card`, `kf-btn-primary`).
- Mobile-optimized navigation including bottom bar, slide-out drawer, and header elements.
- Context-aware notification displays (bottom-sheet on mobile, dropdown on desktop).
- Flow-themed animations and momentum indicators.

**Technical Implementations & Features:**
- **Business Autopilot System:** AI-powered autonomous operations with quick-start onboarding, business archetype inference, revenue model detection, task orchestration, and a Legal & Compliance Module.
- **Real-Time Cockpit Dashboard:** Provides live business intelligence including momentum calculation, bottleneck detection, AI suggestions, prioritized tasks, and revenue insights. Deep links to WhatsApp are integrated.
- **Online Store & Public Booking Page:** Features a modular component architecture for storefront management (customization, product catalog, hours, settings) and a public booking flow (catalog grid, item details, cart, 4-step checkout). Includes merchandising panels, social proof, analytics, and WhatsApp sharing.
- **Notification System:** Real-time notifications with an unread count badge, dropdown panel, and mark-all-read functionality, triggered by key business events.
- **Gamification System:** Implements points, levels, achievements, daily streaks, and challenges to boost user engagement.
- **Personalized Auth & Onboarding:** Redesigned glassmorphism sign-up (2-step progressive flow) and sign-in pages, with Google OAuth integration and an onboarding wizard for first-time users. Dynamic brand color integration across the UI.
- **Quote-to-Invoice Workflow:** Comprehensive quote management (CRUD, tax/discount calculations, product picker) with conversion to invoices.
- **Invoice Tax & Discount System:** Supports editable tax rates and percentage/fixed discounts with live calculation previews.
- **Professional Invoice Template:** Branded public payment page with business logo and line item breakdown.
- **Multi-Gateway Payment System:** Integrates WiPay (Caribbean local/regional) and PayPal (international) for payment processing, with gateway selection on the public payment page.
- **Subscription & Billing System:** Offers 3-tier plans (Free, Flow, KeyFlow) with a free trial, managed through a dedicated module handling activation, cancellation, and enforcing subscription limits across modules.
- **Multi-Tenant System:** Ensures data isolation by associating all operations with the logged-in user's `businessId`, enforcing ownership and membership.
- **Commerce Module Overhaul (v2):** Re-architected into 8 focused modules for improved maintainability, featuring a KPI dashboard, animated tab navigation, glassmorphism product cards, and preserved existing CRUD and payment flows.
- **Recurring Invoices:** Auto-generating invoices on WEEKLY/BIWEEKLY/MONTHLY/QUARTERLY/YEARLY schedules with line items, tax, and discount support.
- **Contacts Page Overhaul:** Modular component architecture with a split-view layout and reusable components.
- **Settings Feature:** Production-ready modular business settings including basic info, social links, branding, logo upload, and Google Calendar OAuth integration.
- **Expense Tracking:** Full CRUD for business expenses with categories, vendor tracking, analytics summary (by category breakdown, monthly trends), and receipt management.
- **AI Co-Founder (KeyFlow AI):** OpenAI-powered business advisor with full business context injection, multi-turn chat, daily briefing generation, and predictive cash flow forecasting.
- **Email Marketing:** Campaign management with draft/send workflow, contact segmentation by tags/status, and delivery tracking (sent/opened/clicked stats).
- **Lead Capture Forms:** Form builder with custom fields (text/email/phone/select/textarea), public submission endpoint with auto-CRM contact creation, and embed code generation.
- **Business Templates:** 10 industry-specific presets (Freelancer, Restaurant/Food, Salon/Beauty, E-commerce, Consulting/Agency, Fitness/Wellness, Photography/Creative, Cleaning/Home Services, Tutoring/Education, Event Planning) that seed products, services, and expense categories.
- **Landing Page Builder:** Template-based page builder with section types (hero/features/testimonials/cta/text/gallery), publish/unpublish toggle, and public page serving.
- **MasterClass (Education):** Micro-course catalog with difficulty levels, lesson-by-lesson progress tracking, enrollment management, and certificate generation.
- **Community Hub:** Peer discussion forum with post types (Discussion/Question/Win/Resource), likes, comments, and cohort-based founder circles with membership management.
- **Core Modules:**
    - **Identity:** User authentication, team, business settings.
    - **CRM:** Contacts, timeline, lead scoring.
    - **Commerce:** Products, invoices, quotes, payments, recurring invoices.
    - **Bookings:** Services, staff, availability, calendar.
    - **Social:** Posts, scheduling, multi-platform channel integration (Facebook, Instagram, LinkedIn, Twitter, TikTok) with analytics.
    - **Automations:** Playbooks, triggers, actions, with an AutomationExecutorService.
    - **Projects:** Full CRUD for projects with tasks and a Kanban board UI.
    - **Flow (Activity & Search):** Unified activity feed and universal search across all modules.
    - **Reports:** KPIs, analytics.
    - **Cockpit:** Flow Graph, Flow Feed, live momentum bar, universal search, and prioritized tasks.
    - **Expenses:** Expense tracking with categories, analytics, receipt file upload, and tax estimation calculator (Trinidad VAT default).
    - **Webhooks:** External webhook registration with event subscriptions (invoice.paid, contact.created, booking.created, etc.) for third-party integrations.
    - **AI:** Co-Founder chat, daily briefing, cash flow prediction, business simulation (what-if scenarios), SEO scoring.
    - **Email Marketing:** Campaign management with segmentation and analytics.
    - **Lead Forms:** Form builder with public submissions and CRM integration.
    - **Templates:** Industry-specific business presets.
    - **Education:** MasterClass courses with progress tracking and certificates.
    - **Community:** Forum posts, comments, likes, and cohort management.
    - **Landing Pages:** Page builder with section types, public serving, and SEO scoring.

## Recent Changes (Feb 20, 2026)
- **CRM Contacts Overhaul:**
  - Enhanced ContactCard with source badges (booking/store/lead-form/import/google), 1-tap communication (email/phone/WhatsApp), pin/favorite, multi-select for broadcast
  - Enhanced ContactDetail with Quick Compose panel (WhatsApp/Email templates), communication actions bar, financial summary card (totalRevenue, invoiceCount, bookingCount)
  - Built BroadcastDrawer for bulk WhatsApp/email messaging with templates, personalization tokens, preview, and eligibility tracking
  - Added Recent/Pinned contacts tabs with localStorage persistence, multi-select mode with broadcast button
  - Backend: Added totalRevenue, invoiceCount, bookingCount to ContactMeta type and populated across list/detail views
  - Source tracking verified across all channels: booking, store, lead-form, import, google, manual
- **UI Standardization Sprint:**
  - Created 4 shared UI components: PageHeader, TabNav, StatCards, EmptyState in `apps/web/src/components/ui/`
  - Updated 12+ pages (Expenses, Social, Bookings, Marketing, MasterClass, Advisor, Automations, Community, Projects, Reports, Commerce, Pages) to use shared components
  - Fixed color inconsistencies: standardized purple accents to orange/teal brand colors across Advisor and MasterClass
  - Redesigned MasterClass page: removed gradient hero, applied dark glassmorphism with accent strips on course cards
  - All pages now follow consistent pattern: PageHeader (icon+title+subtitle+action), TabNav, StatCards, EmptyState
- **Production Readiness Sprint:**
  - Fixed critical CRM flow service bugs: `expiresAt` → `expiryDate` on Quote queries (3 occurrences), restored `deletedAt: null` soft-delete filters on Contact queries (19 occurrences)
  - Enhanced PWA manifest for app store installability: added `id`, `scope`, `lang`, `dir`, `prefer_related_applications` fields, removed non-existent screenshot references
  - Configured production deployment (autoscale): Prisma generate + server/web builds, concurrent server + frontend start
  - Verified Service Worker registration and PWA compliance
- **Gap Bridge Sprint:** Bridged all buildable gaps from the research brief:
  - Added 6 new business templates (total 10): Consulting/Agency, Fitness/Wellness, Photography/Creative, Cleaning/Home Services, Tutoring/Education, Event Planning
  - Built Business Simulation mode (AI-powered what-if scenarios) on the Advisor page
  - Added Voice-First Operations via Web Speech API for voice input to AI chat
  - Built Tax Estimation Calculator on the Expenses page (Trinidad VAT 12.5% default)
  - Added Receipt File Upload for expenses using object storage
  - Built SEO Scoring for landing pages (heuristic-based: title, description, content, URL, keywords)
  - Enhanced LaunchFlow onboarding with business formation checklist (entity type, tax ID, banking, compliance)
  - Built Webhook Management in Settings (CRUD, event subscriptions, secret management)
  - Added Webhook model to Prisma schema
- Previous: Expanded Prisma schema with 9+ new modules, built 8 NestJS backend modules, 8 frontend pages, AI module with Co-Founder chat and cash flow forecasting

## External Dependencies
- **Database:** PostgreSQL (Replit built-in)
- **Authentication:** Supabase Auth
- **AI:** OpenAI via Replit AI Integrations (gpt-5.2 model for AI Co-Founder)
- **Google Services:**
    - Google Calendar Integration (OAuth 2.0 with `calendar.events` scope)
    - Google Sign-In (via Supabase OAuth)
    - Gmail Integration for Quote Sending (OAuth 2.0 with `gmail.send` scope)
    - Google Contacts OAuth Sync
- **Payment Gateways:**
    - WiPay (Caribbean - TTD, JMD, BBD, GYD, XCD)
    - PayPal (International - USD) - `@paypal/paypal-server-sdk v2.2.0`
- **Package Manager:** pnpm
- **Storage:** App Storage (for logo uploads)
