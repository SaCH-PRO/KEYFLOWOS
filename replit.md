# KEYFLOWOS Monorepo

## Overview
KEYFLOWOS is an AI-powered operating system designed to automate operations for service businesses, aiming for 80-90% automation. It provides pre-built Playbooks and a unified "Command" center with an AI-powered command bar, voice input, and integrated business intelligence. The system integrates six core engines: LaunchFlow, OperateAI, GrowthStack, ProfitLens, ScaleHub, and MasterClass Mode, offering a comprehensive solution for business automation, growth, and management.

## User Preferences
- Caribbean localization (TTD currency, Trinidad timezone)
- Refined dark theme with selective glassmorphism (Linear/Stripe/Notion-inspired)
- Event-driven architecture for automation
- Pre-opinionated flows (Playbooks)

## System Architecture
The project is a monorepo utilizing a Next.js 16 frontend (`apps/web`) and a NestJS backend API (`apps/server`), with PostgreSQL managed by Prisma. The backend uses SWC for transpilation, requiring explicit `@Inject(Token)` decorators for NestJS constructor injection.

**UI/UX Decisions:**
- Redesigned design system with a warm Caribbean color palette (orange `#F97316` primary, teal `#14B8A6` secondary), selective glassmorphism, clean elevation system, and PWA capabilities.
- Compact UI elements including sidebar, header, and TabNav.
- Unified Design Language across all modules with consistent patterns for PageHeader, TabNav, keyboard shortcuts, mobile swipe navigation, and EmptyState components.
- Enhanced data tables with column visibility, responsive auto-hiding, multi-word search, and "Saved Views".
- Product detail and form components emphasize inline editing, real-time previews, validation, and performance.
- Accessible design with ARIA compliance and graceful error handling.

**Technical Implementations & Features:**
- **AI-Powered Automation:** Business Autopilot System for archetype inference, revenue model detection, task orchestration, and legal/compliance.
- **Command Center:** Unified page with AI command bar, voice input, AI chat, and business metrics.
- **Commerce Module (Restructured):** 4 top-level tabs: Quotes, Invoices, Schedules, Insights (no more Products tab — products moved to Bookings). Features `CommerceService` (CRUD), `CommerceStatsService` (KPIs with caching), and `CommerceAiService` (revenue analysis, cash flow forecast, NL interpreter, NL search, product health scan, client payment intelligence, quote win analysis). Includes a unified currency system, recurring invoice scheduler, and a BillingPanel (with `hideSegmentNav` + `activeSegment` props for external tab control). Offers Invoice/Quote Template System with customizable templates and a `TemplateStudio`. Emits events for `product`, `quote`, and `invoice` lifecycle changes. **Partial payments:** `recordPayment` and `listPayments` endpoints, payment progress bars on invoice cards, Record Payment modal with method/reference/notes, PARTIALLY_PAID status support.
- **CRM Module:** Restructured 3-surface architecture: **Contacts** (pipeline + inline engage actions), **Insights** (analytics), **Studio** (database/bulk ops). Simplified contact cards (avatar, name, status dot, lead score, last interaction, action buttons). Detail panel uses progressive disclosure with collapsible AI Intelligence section. Engage tab content merged into Contacts as a collapsible Actions bar. AI copilot, duplicate detection, bulk editing, notes/tasks remain. Features AI for contact summarization, lead scoring, note intelligence, churn detection, and natural language search. **AI Next Actions:** Dedicated `CrmActionsService` with `getAiNextActions` endpoint using OpenAI to analyze stale contacts, high-score leads, overdue invoices, and new leads — returns prioritized action cards in the Engage tab with "Do it" navigation buttons.
- **Bookings Module:** Offers Calendar, Products, and Insights tabs with standard CRM patterns. Includes Calendar view with status color coding, product catalog management (shared `ProductsPanel` from Commerce), and staff panel. Insights tab features Recharts charts for booking analytics plus a **Booking Optimizer Agent** (`BookingOptimizerService`) providing: Schedule Health card (utilization rate, cancellation rate with trend, avg revenue/slot, peak/slowest day KPIs, 7-day utilization chart), promotion opportunity detection for underbooked days, cancellation risk scoring per upcoming booking, rebooking suggestions based on per-contact-per-service booking patterns, and a `booking.completed` event listener for auto-creating rebooking notification. Four optimizer API endpoints: `schedule-health`, `no-show-risks`, `reminders`, `rebooking-suggestions`. Integrates AI for NL search, schedule optimization, no-show prediction, and revenue insights. Emits events for `booking` lifecycle changes.
- **Marketing Module (Overhauled):** Merged Marketing + Social into one comprehensive module with 4 tabs: Social (default), Campaigns, Lead Forms, and Insights. **Architecture:** Centralized `useMarketing` hook (`hooks/use-marketing.ts`) encapsulates all state, data loading, CRUD callbacks, cross-module event listeners, and computed stats; page.tsx is thin layout (~180 lines). `useMarketingAiHub` provides enriched AI suggestions using social posts, cross-module signals, and campaign/form data. Backend split: `MarketingAiService` (NL search, content gen, performance, audience, subject lines, form optimizer) and `MarketingStrategyService` (strategy, brief, snapshot). **Stats endpoint:** `GET /businesses/:businessId/marketing/stats` with 5-min TTL cache + invalidation on create/delete/send/schedule mutations. **Cross-module pluggability:** Listens for `contact:created`, `contact:imported`, `commerce:invoice_paid`, `booking:created` events; emits 13+ marketing lifecycle events (campaign CRUD, form CRUD, social post lifecycle, strategy generated, brief submitted). **Bulk actions:** Multi-select with `MarketingBulkBar` for campaigns (delete/send) and lead forms (delete/activate/deactivate). **UX consistency:** Tab-aware `MarketingSkeleton` with staggered animations, per-tab `EmptyState` components with CTAs, KPI summary cards in page header. Social tab features post composer with content templates, posts feed, and an enhanced content calendar with Month/Week/Day views, unified event display (social posts + bookings), click-to-create quick booking modal with date/time inputs, event detail popovers, event type filtering (All/Posts/Bookings), color-coded legend, and current-time indicator. **Connections dropdown:** Compact header dropdown showing Gmail + social platform connection status. Includes `MarketingGuide`, `CampaignActionQueue`, `FormOptimizationQueue`. Campaign duplication. Insights tab: unified analytics with Recharts charts, Lead-to-Revenue Funnel, social KPIs.
- **Client Momentum Agent:** Relationship intelligence system calculating per-contact momentum scores based on weighted factors to generate prioritized action recommendations.
- **AI Command Hub System:** Unified AI access point per module with "Tools" (AI capabilities) and "Insights" (proactive AI suggestions).
- **Billing & Payment System:** Multi-method payment support (WiPay, PayPal, Google Pay, bank transfer, cash) and `PaymentLink` model for shareable payment links. Public payment page with redesigned UI and secure checkout.
- **Core Workflows:** Quote-to-Invoice, multi-gateway payment, subscription & billing, and expense tracking.
- **User & Security:** Multi-Tenant System with `businessId` isolation, Google OAuth, notification system, input sanitization, DTO validation, rate limiting, and AI prompt injection guards.
- **Data Integrity:** Atomic operations for campaign sends, transactional lead form submissions, and validation for tax/discount bounds.
- **Store Module:** Virtual storefront builder with sections for Overview, Products, Hours, Settings, and Customize (appearance with live preview). Features AI Command Hub with Store Optimizer, SEO Advisor, Pricing Advisor, and Storefront Analyzer tools. Includes premium templates and a redesigned public storefront with theme engine, `CatalogGrid`, `CartDrawer`, and `CheckoutFlow`.
- **Cross-Module Intelligence Agent:** Event-driven workflow engine that listens to key module events and triggers configurable cross-module actions (e.g., CRM task creation, contact tagging).
- **Platform Features:** Gamification, online store & public booking page, module event bus, reusable keyboard shortcuts, and webhook dispatcher.
- **Observability:** Request correlation ID middleware, global logging interceptor, and health check endpoints.
- **Learn Module:** MasterClass functionality with My Learning, Catalog, and Certificates.
- **Community Module:** Features Feed and Cohorts with social functionalities.
- **Error Boundaries:** Dedicated `error.tsx` boundaries for all core modules.

## External Dependencies
- **Database:** PostgreSQL
- **Authentication:** Supabase Auth
- **AI:** OpenAI via Replit AI Integrations
- **Google Services:** Google Calendar, Google Sign-In, Gmail, Google Contacts OAuth
- **Payment Gateways:** WiPay, PayPal, Google Pay (via Payment Request API)
- **Rich Text:** TipTap (React)
- **Charts:** Recharts
- **Package Manager:** pnpm
- **Storage:** App Storage