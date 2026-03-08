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
- **Marketing Module:** Features Campaigns, Lead Forms, and Insights tabs with standard CRM patterns. Includes status filters, sort options, and a `MarketingGuide`. Utilizes `CampaignActionQueue` and `FormOptimizationQueue` for automation. All CRUD operations have toast notifications (success/error via sonner), delete confirmations, operation loading spinners (Loader2), and unsaved changes warnings on form modals. Campaign duplication (one-click clone to draft). Insights tab offers Recharts charts for campaign performance plus Lead-to-Revenue Funnel widget (Leads→Campaigns→Converted→Revenue). Integrates AI for NL search, campaign content generation, performance analysis, audience segmentation, subject line optimization, and lead form optimization. Emits events for `campaign` and `lead_form` lifecycle changes. **Email compliance:** Unsubscribe footer auto-appended to campaigns, public unsubscribe endpoint with tokenized links, suppression filtering (doNotContact/marketingOptIn), suppression count badges. **Rich text editor:** TipTap-based email editor with formatting toolbar (bold/italic/underline/link/headings/lists/alignment), HTML preview toggle, and 3 starter templates (Newsletter/Announcement/Promotion). **Campaign scheduling:** `CampaignSchedulerService` with 60s interval checks, schedule/cancel-schedule endpoints, datetime picker in UI. **Gmail integration:** `GmailService` wired into `EmailMarketingModule` for actual email delivery with rate limiting; falls back gracefully with warning toast when Gmail not connected. **Lead form builder:** 11 field types (text/email/phone/select/textarea/number/date/checkbox/radio/url/hidden), conditional visibility, field reordering, options for select/radio. **Campaign revenue attribution:** Invoice model has optional `campaignId` for attribution, `getCampaignRevenue` endpoint.
- **AI Command Hub System:** Unified AI access point per module with "Tools" (AI capabilities) and "Insights" (proactive AI suggestions).
- **Core Workflows:** Quote-to-Invoice workflow, multi-gateway payment system, subscription & billing, and expense tracking.
- **User & Security:** Multi-Tenant System with `businessId` isolation, personalized auth & onboarding (Google OAuth), notification system, input sanitization, DTO validation, rate limiting, and AI prompt injection guards.
- **Platform Features:** Gamification system, online store & public booking page, module event bus for cross-module communication, reusable keyboard shortcuts, and a webhook dispatcher system.
- **Observability:** Request correlation ID middleware, global logging interceptor, and health check endpoints.
- **Learn Module:** MasterClass functionality with My Learning, Catalog, and Certificates.
- **Community Module:** Features Feed and Cohorts with social functionalities.
- **Error Boundaries:** Dedicated `error.tsx` boundaries for all core modules.
- **Core Modules:** Identity, CRM, Commerce, Marketplace, Bookings, Social, Projects & Playbooks, Flow, Reports, Command, Expenses, Webhooks, AI, Email Marketing, Lead Forms, Templates, Education, Community.

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