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
- Custom Glassmorphism ConfirmDialog and skeleton loading states.
- Consistent module patterns: PageHeader, TabNav, keyboard shortcuts (1-N for tabs, N=new, R=refresh, Escape=close), mobile swipe navigation, and EmptyState components.
- Pipeline Kanban Board View with HTML5 drag-and-drop and persistent view preferences.
- Enhanced database tables with column visibility, responsive auto-hiding, multi-word search, and "Saved Views".
- Product detail and form components emphasize inline editing, real-time previews, validation, and performance optimizations using `React.memo`, `useMemo`, and `useCallback`.
- Accessible design with ARIA compliance and graceful error handling.

**Technical Implementations & Features:**
- **AI-Powered Automation:** Business Autopilot System with archetype inference, revenue model detection, task orchestration, and a Legal & Compliance Module.
- **Command Center:** Unified page with AI command bar, voice input, AI chat, and business metrics.
- **Commerce Module (3 tabs: Products | Billing | Insights):** Re-architected with `CommerceService` (CRUD), `CommerceStatsService` (KPIs with caching), and `CommerceAiService` (revenue analysis, cash flow forecast, NL interpreter). Includes a unified currency system, recurring invoice scheduler, product import system (CSV & AI Vision), and a unified billing panel. Features shared `BillingCard` and `BillingDetailModal` components for quotes/invoices (identical design, color-coded: quotes=violet, invoices=cyan), with `BILLING_DOC_THEME` theming, `formatAmount()` currency helper, sorting, expanded search, VOID status, aging buckets, and a pluggable architecture using `CommerceSlots`. Billing tab includes action queues (PaymentFollowUpQueue, QuoteActionQueue, AiSmartReminders) for actionable billing tasks. Insights tab includes RevenueRecoveryPlanner for aged receivables analytics. Invoice/Quote Template System with 3 selectable templates (Classic, Modern, Minimal) using brand colors, available in `commerce/components/invoice-templates/`. Template preference stored on Business model (`invoiceTemplate` field) and configurable in Settings > Branding. Templates render on the public payment page (`/pay/[invoiceId]`).
- **CRM Module (4 tabs: Pipeline | Database | Insights | Engage):** Modular CRM with Contact Lists/Groups, Duplicate Detection, and AI copilot. Includes bulk edit, inline editing, import field mapping, virtual scrolling, and a pluggable notes and tasks system. Insights tab is contact-focused (lead scoring, engagement heatmap, conversion timeline, data quality) with a cross-link to Commerce Insights for financial analytics. Engage tab includes a BillingActivityCard showing overdue invoices and pending quotes with navigation to Commerce Billing.
- **Cross-Module Integration:** CRM Engage surfaces billing activity from Commerce (overdue invoices, pending quotes) without duplicating financial widgets. Commerce Billing consolidates all billing action queues formerly in a separate Engage tab. CRM Insights defers deep financial analytics to Commerce Insights via cross-link cards.
- **CRM AI Intelligence Suite:** AI Contact Summarizer, Smart Lead Scoring, AI Note Intelligence, Predictive Churn Detection, Natural Language CRM Search, Data Quality Scan, Duplicate Finder, Re-engagement Planner, and AI Follow-up Drafter.
- **AI Command Hub System:** Unified AI access point per module with "Tools" (AI capabilities) and "Insights" (proactive AI suggestions).
- **Core Workflows:** Quote-to-Invoice workflow, multi-gateway payment system (WiPay, PayPal), subscription & billing, and expense tracking.
- **User & Security:** Multi-Tenant System with `businessId` isolation, personalized auth & onboarding (Google OAuth), and a notification system. CRM security includes input sanitization, DTO validation, rate limiting, and AI prompt injection guards.
- **Platform Features:** Gamification system, online store & public booking page, module event bus for cross-module communication, reusable keyboard shortcuts, and a webhook dispatcher system.
- **Observability:** Request correlation ID middleware, global logging interceptor, and health check endpoints.
- **Core Modules:** Identity, CRM, Commerce, Marketplace, Bookings, Social, Projects & Playbooks, Flow, Reports, Command, Expenses, Webhooks, AI, Email Marketing, Lead Forms, Templates, Education, Community.

## External Dependencies
- **Database:** PostgreSQL
- **Authentication:** Supabase Auth
- **AI:** OpenAI via Replit AI Integrations
- **Google Services:** Google Calendar, Google Sign-In, Gmail, Google Contacts OAuth
- **Payment Gateways:** WiPay, PayPal
- **Charts:** Recharts
- **Package Manager:** pnpm
- **Storage:** App Storage