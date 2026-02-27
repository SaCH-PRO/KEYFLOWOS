# KEYFLOWOS Monorepo

## Overview
KEYFLOWOS is an AI-powered operating system designed to streamline operations for service businesses, aiming for 80-90% automation. It eliminates the "tool maze" by offering pre-built Playbooks, a unified "Command" center with AI-powered command bar, voice input, and integrated business intelligence. The system is envisioned as an Operating System for business ownership, integrating six core engines: LaunchFlow, OperateAI, GrowthStack, ProfitLens, ScaleHub, and MasterClass Mode.

## User Preferences
- Caribbean localization (TTD currency, Trinidad timezone)
- Glassmorphism UI with dark theme
- Event-driven architecture for automation
- Pre-opinionated flows (Playbooks)

## System Architecture
The project is a monorepo utilizing a Next.js 16 frontend (`apps/web`) and a NestJS backend API (`apps/server`), with PostgreSQL managed by Prisma.

**UI/UX Decisions:**
- Custom design system with a unique KeyFlow identity, featuring a warm Caribbean-inspired color palette (Sunset Orange, Caribbean Teal).
- PWA capabilities, Glassmorphism elements, and a dark theme.
- Redesigned, icon-first, collapsible sidebar with grouped sections (CORE, GROW, MANAGE) and left accent bar active state.
- Unified component classes and mobile-optimized navigation with matching grouped structure.
- Premium design token system with elevation shadows, glass surfaces, and micro-transitions.
- Context-aware notifications and flow-themed animations.
- Toast notification system (sonner) with glassmorphism styling for all CRUD feedback.
- Glassmorphism ConfirmDialog component replacing all native browser confirm() dialogs.
- Skeleton loading states (stat cards, tables, charts, kanban, dashboards) replacing generic spinners.
- Next.js error.tsx, loading.tsx, and not-found.tsx boundaries for graceful error recovery.
- Search debouncing (300ms) on all search inputs to reduce API calls.
- Client-side pagination with page size selector on lists (expenses, CRM contacts, marketplace).
- Core accessibility: ARIA labels, roles (tablist/tab, navigation, main, dialog), aria-selected on tabs.
- Component decomposition: Marketplace (9 files), Reports (8 files), Store (6 files) extracted from monolithic pages.

**Technical Implementations & Features:**
- **Business Autopilot System:** AI-powered operations with quick-start onboarding, business archetype inference, revenue model detection, task orchestration, and a Legal & Compliance Module.
- **Command Center (formerly Cockpit):** Unified command page at /app with AI command bar, voice input, integrated KeyFlow AI chat, dashboard metrics, daily briefing, cash flow forecast, what-if simulator, prioritized tasks, and revenue insights with WhatsApp deep links. KeyFlow AI is fully embedded into Command (no separate page).
- **Online Store & Public Booking Page:** Modular storefront management and a 4-step public booking flow with merchandising, social proof, analytics, and WhatsApp sharing.
- **Notification System:** Real-time notifications for key business events.
- **Gamification System:** Points, levels, achievements, streaks, and challenges for engagement.
- **Personalized Auth & Onboarding:** Redesigned glassmorphism sign-up/sign-in, Google OAuth, and an onboarding wizard.
- **Quote-to-Invoice Workflow:** Comprehensive quote management (CRUD, tax/discount) with conversion to invoices.
- **Invoice Tax & Discount System:** Editable tax rates and percentage/fixed discounts with live previews.
- **Professional Invoice Template:** Branded public payment page.
- **Multi-Gateway Payment System:** Integration with WiPay (Caribbean) and PayPal (international).
- **Subscription & Billing System:** 3-tier plans (Free, Flow, KeyFlow) with free trial, managing activation, cancellation, and module limits.
- **Multi-Tenant System:** Data isolation using `businessId` for all operations. Hardened BusinessGuard rejects requests when businessId is missing, Prisma is unavailable, or DB queries fail (no dev fallbacks). All controllers with business-specific endpoints use `@UseGuards(AuthGuard, BusinessGuard)`.
- **Commerce Module Overhaul (v2):** Re-architected into 8 focused modules with KPI dashboard, animated navigation, and glassmorphism product cards.
- **Recurring Invoices:** Auto-generating invoices on various schedules with full item, tax, and discount support.
- **Contacts Page Overhaul:** Modular split-view layout with reusable components.
- **Settings Feature:** Modular business settings including basic info, social links, branding, logo upload, and Google Calendar OAuth.
- **Expense Tracking (v2):** Comprehensive expense management with category/vendor/payment method tracking, budget system with alerts, vendor analytics, period-over-period comparison, CSV export, receipt upload/preview, tag system, recurring expense support, tax estimator, and tabbed UI (Overview, Budgets, Vendors, Categories).
- **AI Co-Founder (KeyFlow AI):** OpenAI-powered business advisor integrated into Command page with multi-turn chat, daily briefings, predictive cash flow forecasting, and what-if scenario simulation.
- **Email Marketing:** Campaign management with segmentation and delivery tracking.
- **Lead Capture Forms:** Form builder with custom fields, public submission, auto-CRM contact creation, and embed code generation.
- **Business Templates:** 10 industry-specific presets to seed business data.
- **MasterClass (Education):** Micro-course catalog with progress tracking and certificate generation.
- **Community Hub:** Peer discussion forum with various post types, likes, comments, and cohort-based founder circles.
- **Projects & Playbooks (Merged):** Unified page at /app/projects with tabbed navigation. Projects tab: Kanban board with task management. Playbooks tab: event-driven automations with triggers and actions. Contextual "How this works" explainer buttons in each tab.
- **Global Commerce / Marketplace:** International selling pipeline at /app/marketplace with 8 tabs: Dashboard (KPI overview), Catalog (product listings with LOCAL/REGIONAL/INTERNATIONAL reach), Orders (cross-border marketplace orders), Shipments (carrier tracking with status timeline), Customs (import/export declarations with HS codes, duties, clearance), Warehousing (multi-warehouse inventory management with reorder alerts), Pre-Orders (deposit tracking, fulfillment), Purchase Orders (supplier procurement). Supports multi-currency, shipping zones, and customs clearance workflow.
- **AI Usage Billing:** Centralized AI metering via AiUsageService. All AI calls tracked with token/cost logging. Tiered credit system (Free: 10/mo, Flow: 100/mo, KeyFlow: unlimited). Overage billing at TT$2.50/US$0.35 per credit. Billing dashboard in settings.
- **Server-Side Pagination:** Commerce (products, invoices, quotes) and Marketplace (listings, orders, shipments, customs, pre-orders, purchase-orders) list endpoints return `{data, total, page, pageSize, totalPages}` envelope with defaults page=1, pageSize=50, max 100. Frontend API functions unwrap the envelope for backward compatibility.
- **Global HTTP Exception Filter:** All backend errors return consistent `{statusCode, message, error, timestamp, path}` shape via `GlobalHttpExceptionFilter`. Unknown errors logged at error level and return 500.
- **CORS Configuration:** Environment-aware CORS — production restricts to specific origins (REPLIT_DEV_DOMAIN, localhost), development allows all origins.
- **Mass Assignment Protection:** Marketplace service update methods (shipping zones, warehouses, shipments, customs, pre-orders, purchase orders) use explicit field mapping instead of raw object spread to prevent attackers from overwriting internal fields. Order/pre-order prices sourced from database product records, not user input.
- **Accessibility (ARIA):** Dialog and Drawer shared components include `role="dialog"`, `aria-modal="true"`, `aria-labelledby`, Escape key dismissal, and keyboard-accessible backdrop. Command palette has `role="dialog"` and `aria-label`.
- **Error Boundaries:** Root-level `error.tsx` and `not-found.tsx` for graceful recovery outside the app layout. App-level `error.tsx`, `loading.tsx`, and `not-found.tsx` for dashboard-scoped errors.
- **Core Modules:** Identity, CRM, Commerce, Marketplace, Bookings, Social, Projects & Playbooks, Flow (Activity & Search), Reports, Command, Expenses, Webhooks, AI, Email Marketing, Lead Forms, Templates, Education, Community.

## External Dependencies
- **Database:** PostgreSQL
- **Authentication:** Supabase Auth
- **AI:** OpenAI via Replit AI Integrations (gpt-5.2)
- **Google Services:** Google Calendar Integration, Google Sign-In, Gmail Integration, Google Contacts OAuth Sync
- **Payment Gateways:** WiPay, PayPal
- **Package Manager:** pnpm
- **Storage:** App Storage