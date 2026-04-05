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
- **User & Security:** Multi-Tenant System with `businessId` isolation, personalized authentication (Google OAuth), notification system, and AI prompt injection guards.
- **Cross-Module Intelligence Agents:**
    - **Client Momentum Agent:** Calculates per-contact momentum scores for prioritized actions.
    - **Campaign Intelligence Agent:** Provides post-campaign analysis, AI briefings, and send-time optimization.
    - **Financial Copilot Agent:** Monitors revenue, expenses, and cash flow with anomaly detection and provides a Financial Pulse dashboard.
    - **Cross-Module Intelligence Agent:** Event-driven workflow engine triggering cross-module actions.
- **Business Guidance Engine:** Schema and backend foundation for structured business profiles with diagnostic scoring, financial analysis, and recommendations, including assessment results, guidance recommendations, and roadmap items.
- **Navigation & Command System:** Sidebar navigation, breadcrumbs, Command Palette (⌘K) for quick actions and universal search, and persistent AI Copilot quick-action chips.
- **Settings Consolidation:** All configuration settings centralized in a dedicated Settings section with deep-links. Profile is a separate top-level route.
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