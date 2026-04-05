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
- **Store Module:** Redesigned with Storefront, Products & Hours, and Performance tabs. Features a consolidated setup surface for the storefront, detailed product and hour management, comprehensive performance analytics, SEO settings panel (meta title/description with Google search preview), and Share Store button with URL copy.
- **Expenses Module:** Decomposed into a modular structure with dedicated components for filters, stats, list, forms, budgets, vendors, categories, and analytics, organized into three tabs: Expenses, Budgets, and Analytics.
- **Projects Module:** Focused kanban board for project management with task tracking, due date pickers (project and task level), overdue indicators, task assignment support, and archive/unarchive functionality for completed projects.
- **Automations Module:** Dedicated `/app/automations` page with three tabs: My Automations (unified list of playbooks + cross-module intelligence workflows with search, toggle, and config), Templates (pre-built automation recipes with preview modal showing trigger→condition→action flow), and Activity Log (execution history with search/filter by status). Playbook editor supports AND/OR condition grouping for complex rules.
- **Settings Consolidation:** All configuration settings are centralized in a dedicated Settings section (Business, Team, Connections, Notifications, Compliance, Webhooks, Templates, Developers), with deep-links from other modules to avoid duplication. Profile is separated into its own top-level `/app/profile` route. `/app/settings` defaults to Business tab. `/app/settings/profile` redirects to `/app/profile`.
- **Cross-Module Contact Journey:** Enhanced `ContactJourneyTimeline` component provides a unified lifecycle timeline for contacts, merging events, notes, tasks, invoices, and bookings into chronological entries with cross-module CTAs.
- **Customer Notification System:** Transactional email system for sending branded customer-facing emails via connected Gmail. Supports 6 notification types with event-driven triggers, cron jobs, and customizable preferences.
- **Platform Features:** Gamification system, online store & public booking page, module event bus, reusable keyboard shortcuts, and a webhook dispatcher system. Developer settings with API key management (scoped permissions, HMAC-signed keys) and expanded webhook events (29 events across Commerce, Bookings, CRM, Marketing, and Operations groups).
- **Tiered Monetization:** Plan comparison grid (Free/Flow/KeyFlow) with feature-by-feature breakdown across 7 categories, integrated into billing settings.
- **Observability:** Request correlation ID middleware, global logging interceptor, and health check endpoints.
- **Learn Module:** MasterClass functionality with My Learning, Catalog, and Certificates.
- **Business Guidance Module:** AI-powered recommendation engine and strategic advisor. Includes the Business Guidance Wizard (a 13-step profiling wizard collecting data across 10 sections like Founder Context, Revenue Model, and Operations), diagnostic scoring, financial analysis, and recommendations. Features include:
    - `GuidanceRecommendationService`: Generates categorized, prioritized recommendations based on scores, stage, and business type (~15 templates).
    - `GuidanceRoadmapService`: Sequences recommendations into a prioritized action plan (legal → viability → profitability → operations → growth).
    - `GuidanceAiFeedbackService`: Generates AI strategic summaries via OpenAI with template-based fallback.
    - Adapts to 5 business types and 6 stages. Prisma models: `BusinessGuidanceProfile`, `GuidanceAssessment`, `GuidanceRecommendation`, `RoadmapItem`.
    - Components: multi-step wizard with draft save/resume, visual stepper, and mobile-responsive targets (`apps/web/src/app/app/profile/components/`).
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