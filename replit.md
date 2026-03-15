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
- Compact UI elements, unified design language across modules, enhanced data tables with advanced features, and accessible design with ARIA compliance.
- Product detail and form components emphasize inline editing, real-time previews, validation, and performance.
- Standardized shared component library (`apps/web/src/components/ui/`): `StatusBadge`, `SideSheet`, `FilterBar`, `KfButton`, `DataTable`, `MetricCard`, `InspectorPanel`, `FeatureGuide`.
- Shell declutter: Momentum badge removed from global header; per-module AI search bars removed (CRM, Bookings, Marketing); custom getting-started guides replaced with shared `FeatureGuide` across CRM, Bookings, Marketing, Commerce, and Store modules.
- CSS type scale: `kf-text-micro` (10px), `kf-text-caption` (12px), `kf-text-body` (13px), `kf-text-emphasis` (14px), `kf-text-heading` (16px), `kf-text-title` (18px).
- CSS radius: `kf-radius-sm` (6px), `kf-radius-md` (8px), `kf-radius-lg` (12px).
- CSS card variants: `kf-card-metric`, `kf-card-action`, `kf-card-list-row`.

**Technical Implementations & Features:**
- **AI-Powered Automation:** Business Autopilot System for archetype inference, revenue model detection, task orchestration, and legal/compliance.
- **Command Center:** Unified page with AI command bar, voice input, AI chat, and business metrics.
- **Commerce Module:** Manages Quotes, Invoices, Schedules, and Insights. Features comprehensive CRUD, KPI tracking with caching, AI-powered revenue analysis, cash flow forecasting, NL interpretation, and a unified currency system. Supports recurring invoices, partial payments, and customizable invoice/quote templates via a `TemplateStudio`.
- **CRM Module:** Provides Contacts (pipeline, inline actions), Insights (analytics), and Studio (database/bulk ops). Features simplified contact cards, progressive disclosure of details, AI copilot for summarization, lead scoring, churn detection, and natural language search. Includes an AI-powered "Next Actions" service for prioritized recommendations.
- **Bookings Module:** Offers Calendar, Products, and Insights. Includes calendar views, product catalog management, staff panels, and a Booking Optimizer Agent for schedule health, promotion detection, cancellation risk scoring, and rebooking suggestions. Integrates AI for NL search and schedule optimization.
- **Marketing Module:** Combines marketing and social features with tabs for Social, Campaigns, Lead Forms, and Insights. Features a centralized `useMarketing` hook for state management, `useMarketingAiHub` for AI suggestions, and cross-module event listeners. Includes a post composer, enhanced content calendar, and analytics with a Lead-to-Revenue Funnel.
- **Client Momentum Agent:** Relationship intelligence system calculating per-contact momentum scores for prioritized action recommendations.
- **Campaign Intelligence Agent:** Provides post-campaign analysis, AI-powered performance briefings, pre-send validation with audience health scoring, and send-time optimization recommendations.
- **AI Command Hub System:** Unified AI access point per module with "Tools" (AI capabilities) and "Insights" (proactive AI suggestions).
- **Billing & Payment System:** Supports multi-method payments (WiPay, PayPal, Google Pay, bank transfer, cash) and features `PaymentLink` for shareable links, a public payment page, and redesigned payment settings. Manages subscription billing history.
- **Core Workflows:** Quote-to-Invoice, multi-gateway payment, subscription & billing, and expense tracking.
- **User & Security:** Multi-Tenant System with `businessId` isolation, personalized authentication (Google OAuth), notification system, input sanitization, DTO validation, rate limiting, and AI prompt injection guards.
- **Data Integrity:** Ensures atomic operations for campaign sending, lead form submissions, and valid tax/discount bounds.
- **Store Module:** A virtual storefront builder with tabs for Overview, Products, Hours, Settings, and Customize. Features a Storefront Readiness Score, Conversion Insights Panel with weekly reports, funnel visualization, product/SEO health scores, and AI-powered advice. Includes an AI Command Hub with Store Optimizer and SEO Advisor tools.
- **Financial Copilot Agent:** Monitors revenue, expenses, and cash flow with anomaly detection, providing a Financial Pulse dashboard and weekly AI-powered briefings. Event-driven triggers for financial milestones and expense tracking.
- **Cross-Module Intelligence Agent:** An event-driven workflow engine that listens to key module events and triggers cross-module actions like CRM task creation, contact tagging, and notifications, configurable per business.
- **Platform Features:** Gamification system, online store & public booking page, module event bus for cross-module communication, reusable keyboard shortcuts, and a webhook dispatcher system.
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