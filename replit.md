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
- Compact UI elements, unified design language, enhanced data tables, and accessible design with ARIA compliance.
- Product detail and form components emphasize inline editing, real-time previews, validation, and performance.
- Standardized shared component library for common UI elements.
- Consolidated shell design across modules and defined CSS type scales and card variants for consistent styling.

**Technical Implementations & Features:**
- **AI-Powered Automation:** Business Autopilot System for archetype inference, revenue model detection, task orchestration, and legal/compliance.
- **Command Center:** Simplified "Today" surface with greeting header, cash flow forecast, priority queue, and collapsible AI briefing card.
- **Modules:**
    - **Commerce:** Comprehensive CRUD for Invoices, Quotes, Payments, and Recurring transactions with KPI tracking, AI-powered revenue analysis, and cash flow forecasting.
    - **CRM:** Simplified contact management with AI copilot for summarization, lead scoring, churn detection, natural language search, and "Next Actions" recommendations.
    - **Bookings:** Redesigned scheduling, catalog, and capacity management with priority lanes, staff management, and performance analytics. Features shareable booking links and AI-driven ScheduleHints.
    - **Marketing:** Campaign creation and scheduling, unified content calendar, audience health scoring, and consolidated AI features.
    - **Store:** Consolidated setup for storefront, product/hour management, performance analytics, SEO settings, and a Commerce Order Engine handling full order lifecycle (validation, promo, tax/shipping, order creation, payment, confirmation). Includes a section-based layout builder, FAQ manager, policy editor, and font pairing system.
    - **Expenses:** Modular structure for managing expenses, budgets, vendors, categories, and analytics.
    - **Projects:** Kanban board for project management with task tracking, due dates, assignments, and archiving.
    - **Automations:** Dedicated page for managing playbooks, templates, and activity logs. Playbook editor supports complex AND/OR condition grouping.
- **AI Copilot System:** Consolidated global AI entry point with route-aware module context detection, self-contained chat drawer, and AI suggestion nudges.
- **Billing & Payment:** Supports multi-method payments, shareable `PaymentLink`s, and subscription billing history.
- **Core Workflows:** Quote-to-Invoice, multi-gateway payment, subscription & billing, and expense tracking.
- **User & Security:** Multi-Tenant System with `businessId` isolation, personalized authentication (Google OAuth), notification system, input sanitization, DTO validation, rate limiting, and AI prompt injection guards.
- **Cross-Module Intelligence Agents:**
    - **Client Momentum Agent:** Calculates per-contact momentum scores for prioritized actions.
    - **Campaign Intelligence Agent:** Provides post-campaign analysis, AI briefings, and send-time optimization.
    - **Financial Copilot Agent:** Monitors revenue, expenses, and cash flow with anomaly detection, providing a Financial Pulse dashboard and weekly AI-powered briefings.
    - **Cross-Module Intelligence Agent:** An event-driven workflow engine that listens to key module events and triggers cross-module actions.
- **Data Integrity:** Ensures atomic operations for campaign sending, lead form submissions, and valid tax/discount bounds.
- **Store Module:** Redesigned with Storefront, Products & Hours, Fulfillment, Performance, and Reviews tabs. Features a consolidated setup surface for the storefront, detailed product and hour management, comprehensive performance analytics, SEO settings panel (meta title/description with Google search preview), Share Store button with URL copy, and a Reviews moderation panel for approving/hiding customer reviews with seller replies. Performance tab is a comprehensive Seller Dashboard with sub-tabs: Overview (KPI cards with trends, quick actions), Orders (order management with status flow, search/filter, detail side-sheet), Profits (revenue/cost/margin cards, per-product profitability table, 30-day trend chart), Customers (customer list with repeat buyer badges, expandable order history, sorting), Funnel (enhanced conversion analytics with abandoned cart tracking, per-product conversion rates), and Promos (promo code CRUD with usage stats, revenue tracking). Quick actions include copy link, WhatsApp share, QR code generation, store preview, and pause/resume store. Uses demo data for orders/promos/profits (backend endpoints pending Task 1). Commerce Order Engine with `StoreOrderService` for full order lifecycle (cart validation → promo code → tax/shipping → order creation → payment → confirmation), `PromoCodeService` (PERCENT/FIXED/FREE_SHIPPING with validity dates, usage limits, min order), guest checkout via public endpoints, payment gateway integration (WiPay, PayPal, CASH/MANUAL), seller order management with status tracking and refunds, and webhook events for order lifecycle changes. The Fulfillment tab provides delivery configuration (shipping, local pickup, digital, service booking), shipping zone management, and order fulfillment workflow (status transitions: PENDING→CONFIRMED→PROCESSING→SHIPPED→DELIVERED with cancel/refund support, tracking info, and shareable public order status page at `/order/[token]`). Email notifications are sent to customers on order status changes via TransactionalEmailService.
- **Public Storefront (`/book/[slug]`):** Premium, mobile-first, conversion-optimized storefront rebuild. Section-based layout with configurable section order and visibility (hero, trust, featured, categories, catalog, testimonials, faq, contact, policies). Product detail pages at `/book/[slug]/product/[productId]` with image zoom, quantity selector, breadcrumbs, related items, sticky mobile add-to-cart, WhatsApp inquiry, product reviews, localStorage wishlist, and social sharing (WhatsApp/Facebook/X/copy link). Category navigation with horizontal scrollable chips and URL-based filtering (`?category=services`). Featured products carousel. FAQ accordion section. Policy pages rendered as modals (refund, privacy, delivery, terms). Contact section with WhatsApp, email, phone, address cards. Testimonials section with star ratings. Structured data (JSON-LD) for Product, Organization, and BreadcrumbList schemas. Trust signals, secure checkout badges, seller verification. All interactive elements meet 44px minimum touch targets. Lazy image loading. Store status handling (active/paused). Footer with policy links, contact info, and "Powered by KeyFlowOS" attribution.
- **Expenses Module:** Decomposed into a modular structure with dedicated components for filters, stats, list, forms, budgets, vendors, categories, and analytics, organized into three tabs: Expenses, Budgets, and Analytics.
- **Projects Module:** Focused kanban board for project management with task tracking, due date pickers (project and task level), overdue indicators, task assignment support, and archive/unarchive functionality for completed projects.
- **Automations Module:** Dedicated `/app/automations` page with three tabs: My Automations (unified list of playbooks + cross-module intelligence workflows with search, toggle, and config), Templates (pre-built automation recipes with preview modal showing trigger→condition→action flow), and Activity Log (execution history with search/filter by status). Playbook editor supports AND/OR condition grouping for complex rules.
- **Settings Consolidation:** All configuration settings are centralized in a dedicated Settings section (Business, Team, Connections, Notifications, Compliance, Webhooks, Templates, Developers), with deep-links from other modules to avoid duplication. Profile is separated into its own top-level `/app/profile` route. `/app/settings` defaults to Business tab. `/app/settings/profile` redirects to `/app/profile`.
- **Cross-Module Contact Journey:** Enhanced `ContactJourneyTimeline` component provides a unified lifecycle timeline for contacts, merging events, notes, tasks, invoices, and bookings into chronological entries with cross-module CTAs.
- **Business Guidance Engine:** Scoring and financial analysis module (`apps/server/src/modules/business-guidance/`). Features GuidanceFinancialService (revenue estimates, gross profit, break-even, runway, contribution margin), GuidanceScoringService (6 dimension scores 0-100: Clarity, Readiness, Profitability, Operations, Growth, Risk/Safety), GuidanceFlagsService (business rule flags with severity levels), and GuidanceAssessmentService (orchestration pipeline: normalize → calculate financials → score → detect flags → persist). Stores results in GuidanceAssessmentResult with ProgressSnapshot history. Schema models: GuidanceProfile, GuidanceFinanceProfile, GuidanceOperationsProfile, GuidanceGrowthProfile, GuidanceAssessmentResult, GuidanceProgressSnapshot.
- **Financial Copilot Agent:** Monitors revenue, expenses, and cash flow with anomaly detection, providing a Financial Pulse dashboard and weekly AI-powered briefings.
- **Customer Notification System:** Transactional email system for sending branded customer-facing emails via connected Gmail. Supports 6 notification types with event-driven triggers, cron jobs, and customizable preferences.
- **Platform Features:** Gamification system, online store & public booking page (with product reviews, localStorage wishlist, and social sharing — WhatsApp/Facebook/X/copy link), module event bus, reusable keyboard shortcuts, and a webhook dispatcher system. Developer settings with API key management (scoped permissions, HMAC-signed keys) and expanded webhook events (29 events across Commerce, Bookings, CRM, Marketing, and Operations groups).
- **Tiered Monetization:** Plan comparison grid (Free/Flow/KeyFlow) with feature-by-feature breakdown across 7 categories, integrated into billing settings.
- **Observability:** Request correlation ID middleware, global logging interceptor, and health check endpoints.
- **Learn Module:** MasterClass functionality with My Learning, Catalog, and Certificates.
- **Business Guidance Module:** AI-powered recommendation engine and strategic advisor. Includes the Business Guidance Wizard (a 13-step profiling wizard collecting data across 10 sections like Founder Context, Revenue Model, and Operations), diagnostic scoring, financial analysis, and recommendations. Features include:
    - `GuidanceRecommendationService`: Generates categorized, prioritized recommendations based on scores, stage, and business type (~15 templates).
    - `GuidanceRoadmapService`: Sequences recommendations into a prioritized action plan (legal → viability → profitability → operations → growth).
    - `GuidanceAiFeedbackService`: Generates AI strategic summaries via OpenAI with template-based fallback.
    - Adapts to 5 business types and 6 stages. Prisma models: `BusinessGuidanceProfile`, `GuidanceAssessment`, `GuidanceRecommendation`, `RoadmapItem`.
    - Components: multi-step wizard with draft save/resume, visual stepper, and mobile-responsive targets (`apps/web/src/app/app/profile/components/`).
    - **Guidance Dashboard:** `GuidanceDashboard` component at `apps/web/src/app/app/profile/components/guidance-dashboard.tsx`. Premium business command center presenting 10 dashboard cards: Business Snapshot, Overall Health gauge, 6 dimension score cards (Clarity, Readiness, Profitability, Operational Maturity, Growth, Risk/Safety), Profitability metrics (TTD currency), Missing Essentials, Risk Alerts, Priority Roadmap (vertical timeline), Strategic Feedback (strengths/weaknesses), Opportunities, and Progress Tracking (Recharts area chart with score deltas). Integrated into profile page via tab toggle (Profile / Business Guidance). Uses backend `/business-guidance/:businessId/dashboard` as source of truth for assessment status. Score color-coding: red < 40, amber 40-69, green >= 70.
- **Profile Module:** Consolidated at `/app/profile` (previously under Settings). Manages personal information, professional identity (headline, bio, skills, businessStage, interests), password/security, avatar upload, AI profile generator, document guidance engine, and profile completeness ring. Accessible via user avatar dropdown in header and command palette. Public community profile view remains at `/app/community/profile/[businessId]`.
- **Community Module:** Features Feed and Cohorts with social functionalities. Clickable author names in posts/comments open ProfileCard slide-out panels, public profile page at `/app/community/profile/[businessId]`.
- **Navigation & Command System:** Sidebar navigation, breadcrumbs, Command Palette (⌘K) for quick actions and universal search, and persistent AI Copilot quick-action chips.
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