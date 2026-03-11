# KEYFLOWOS Monorepo

## Overview
KEYFLOWOS is an AI-powered operating system designed to automate operations for service businesses, aiming for 80-90% automation. It provides pre-built Playbooks and a unified "Command" center with an AI-powered command bar, voice input, and integrated business intelligence. The system integrates six core engines: LaunchFlow, OperateAI, GrowthStack, ProfitLens, ScaleHub, and MasterClass Mode, offering a comprehensive solution for business automation, growth, and management.

## User Preferences
- Caribbean localization (TTD currency, Trinidad timezone)
- Glassmorphism UI with dark theme
- Event-driven architecture for automation
- Pre-opinionated flows (Playbooks)

## System Architecture
The project is a monorepo utilizing a Next.js 16 frontend (`apps/web`) and a NestJS backend API (`apps/server`), with PostgreSQL managed by Prisma. The backend uses SWC for transpilation, requiring explicit `@Inject(Token)` decorators for NestJS constructor injection.

**UI/UX Decisions:**
- Custom design system with a warm Caribbean-inspired color palette, Glassmorphism elements, and a dark theme, including PWA capabilities and mobile-optimized navigation.
- Unified Design Language across all modules: TabNav with folder-tab styling, `useSwipeTabs` hook, `useKeyboardShortcuts`, framer-motion directional slide transitions, error boundaries, and bespoke skeleton loaders.
- Consistent module patterns: PageHeader, TabNav, keyboard shortcuts, mobile swipe navigation, and EmptyState components.
- Pipeline Kanban Board View with HTML5 drag-and-drop and persistent view preferences.
- Enhanced database tables with column visibility, responsive auto-hiding, multi-word search, and "Saved Views".
- Product detail and form components emphasize inline editing, real-time previews, validation, and performance optimizations.
- Accessible design with ARIA compliance and graceful error handling.

**Technical Implementations & Features:**
- **AI-Powered Automation:** Business Autopilot System with archetype inference, revenue model detection, task orchestration, and a Legal & Compliance Module.
- **Command Center:** Unified page with AI command bar, voice input, AI chat, and business metrics.
- **Commerce Module:** Features `CommerceService` (CRUD), `CommerceStatsService` (KPIs with caching), and `CommerceAiService` (revenue analysis, cash flow forecast, NL interpreter, NL search, product health scan, client payment intelligence, quote win analysis). Includes a unified currency system, recurring invoice scheduler, product import system, and a unified billing panel. Offers Invoice/Quote Template System with customizable templates and a `TemplateStudio`. Emits events for `product`, `quote`, and `invoice` lifecycle changes. **Partial payments:** `recordPayment` and `listPayments` endpoints, payment progress bars on invoice cards, Record Payment modal with method/reference/notes, PARTIALLY_PAID status support.
- **CRM Module:** Modular CRM with Contact Lists/Groups, Duplicate Detection, AI copilot, bulk edit, inline editing, and a pluggable notes and tasks system. Provides contact-focused insights and integrates billing activity from Commerce. Features AI for contact summarization, lead scoring, note intelligence, churn detection, and natural language search. **AI Next Actions:** Dedicated `CrmActionsService` with `getAiNextActions` endpoint using OpenAI to analyze stale contacts, high-score leads, overdue invoices, and new leads — returns prioritized action cards in the Engage tab with "Do it" navigation buttons.
- **Bookings Module:** Offers Calendar, Services, and Insights tabs with standard CRM patterns. Includes Calendar view with status color coding, services management, and staff panel. Insights tab features Recharts charts for booking analytics. Integrates AI for NL search, schedule optimization, no-show prediction, and revenue insights. Emits events for `booking` lifecycle changes.
- **Marketing Module (Unified):** Merged Marketing + Social into one comprehensive module with 4 tabs: Social (default), Campaigns, Lead Forms, and Insights. Social tab features post composer with content templates, posts feed, and content calendar (Posts/Calendar sub-views). **Connections dropdown:** Compact header dropdown showing Gmail + social platform connection status with Manage Connections link to settings. Includes `MarketingGuide`, `CampaignActionQueue`, `FormOptimizationQueue`. All CRUD with toast notifications, delete confirmations, loading spinners, unsaved changes warnings. Campaign duplication. Insights tab: unified analytics with Recharts charts, Lead-to-Revenue Funnel, social KPIs. AI tools: NL search, content generation, performance analysis, audience segmentation, subject line optimization, lead form optimization. **AI Marketing Strategy:** `StrategyPanel` for business metrics input (industry, revenue, audience, budget, goals, competitive landscape, business stage) generating AI-powered marketing plans with short-term actions, long-term strategy, channel recommendations, budget allocation, KPI targets, and financial projections via `POST /marketing/businesses/:businessId/marketing/ai-strategy`. **Email compliance:** Unsubscribe footer, tokenized links, suppression filtering. **Rich text editor:** TipTap-based with formatting toolbar, HTML preview, 3 starter templates. **Campaign scheduling:** `CampaignSchedulerService` with 60s interval. **Gmail integration:** `GmailService` for email delivery. **Lead form builder:** 11 field types, conditional visibility. **Keyboard shortcuts:** 1-4 tabs (Social/Campaigns/Lead Forms/Insights), n new, r refresh, f search.
- **AI Command Hub System:** Unified AI access point per module with "Tools" (AI capabilities) and "Insights" (proactive AI suggestions).
- **Core Workflows:** Quote-to-Invoice workflow, multi-gateway payment system, subscription & billing, and expense tracking.
- **User & Security:** Multi-Tenant System with `businessId` isolation, personalized auth & onboarding (Google OAuth), notification system, input sanitization, DTO validation, rate limiting, AI prompt injection guards, and HMAC-signed unsubscribe tokens (fails closed if secret missing).
- **Data Integrity:** Atomic campaign send with `updateMany` idempotency guard (DRAFT/SCHEDULED→SENDING claim), transactional lead form submissions (contact+submission atomic), tax/discount bounds validation (0-100% tax, non-negative discount, percent discount ≤100%).
- **Store Module (Overhauled):** Virtual storefront builder with 5 tabs: Overview (KPIs + analytics), Customize (appearance + live preview), Products (catalog manager + merchandising), Hours (business hours editor), Settings (URL slug + social proof). Uses standard `PageHeader`, `TabNav`, `useSwipeTabs`, `useKeyboardShortcuts` (1-5 tabs, r refresh, g guide, Shift+A AI hub), directional slide transitions, `toast` notifications (sonner), error boundary, and module event bus. Features AI Command Hub with Store Optimizer, SEO Advisor, Pricing Advisor, and Storefront Analyzer tools plus proactive suggestions. Includes `StoreGuide` with 6-step onboarding, `StoreHeaderActions` with Live/Draft toggle and Share dropdown (Copy Link, WhatsApp, Open Store), commerce-store price drift detection with one-click sync, and `StoreSkeleton` loader. Public storefront at `/book/[slug]` with theme engine, catalog grid, cart drawer, and checkout flow.
- **Platform Features:** Gamification system, online store & public booking page, module event bus for cross-module communication, reusable keyboard shortcuts, and a webhook dispatcher system.
- **Observability:** Request correlation ID middleware, global logging interceptor, and health check endpoints.
- **Learn Module:** MasterClass functionality with My Learning, Catalog, and Certificates.
- **Community Module:** Features Feed and Cohorts with social functionalities.
- **Error Boundaries:** Dedicated `error.tsx` boundaries for all core modules.
- **Core Modules:** Identity, CRM, Commerce, Marketplace, Bookings, Projects & Playbooks, Flow, Reports, Command, Expenses, Webhooks, AI, Email Marketing, Lead Forms, Templates, Education, Community.

## External Dependencies
- **Database:** PostgreSQL
- **Authentication:** Supabase Auth
- **AI:** OpenAI via Replit AI Integrations
- **Google Services:** Google Calendar, Google Sign-In, Gmail, Google Contacts OAuth
- **Payment Gateways:** WiPay, PayPal
- **Rich Text:** TipTap (React) with StarterKit, Link, Placeholder, TextAlign, Underline extensions
- **Charts:** Recharts
- **Package Manager:** pnpm
- **Storage:** App Storage