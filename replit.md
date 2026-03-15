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
- Standardized shared component library for UI elements like `StatusBadge`, `SideSheet`, `FilterBar`, `KfButton`, `DataTable`, `MetricCard`, `InspectorPanel`, `FeatureGuide`, and `ShareLinkModal`.
- Consolidated shell design across modules, removing redundant elements and replacing custom guides with a shared `FeatureGuide`.
- Defined CSS type scales for text and radius values, and card variants for consistent styling.

**Technical Implementations & Features:**
- **Onboarding Wizard:** Redesigned as a 3-step visual wizard for business type selection, service/product creation with TTD-priced templates, and publishing/sharing. AI concierge is an optional slide-out drawer.
- **AI-Powered Automation:** Business Autopilot System for archetype inference, revenue model detection, task orchestration, and legal/compliance.
- **Command Center (Today View):** Simplified "Today" surface with a compact greeting header, priority queue (Now/Today/This Week), and a collapsible AI briefing card.
- **Commerce Module:** Redesigned with four focused tabs: Invoices, Quotes, Payments, and Recurring. Features comprehensive CRUD, KPI tracking, AI-powered revenue analysis, cash flow forecasting, NL interpretation, and a unified currency system. Supports recurring invoices, partial payments, and customizable templates.
- **CRM Module:** Provides Contacts, Insights, and Studio. Features simplified contact cards, progressive disclosure, AI copilot for summarization, lead scoring, churn detection, and natural language search. Includes an AI-powered "Next Actions" service.
- **Bookings Module:** Redesigned with Schedule, Catalog & Capacity, and Performance tabs. Features priority lanes, collapsible schedule filters, side-sheet booking creation, staff management, and consolidated performance analytics. Includes a prominent "Share Booking Link" feature with multiple sharing options and an enhanced public booking confirmation page.
- **Marketing Module:** Redesigned with Create & Schedule, Calendar, Audiences & Forms, and Performance tabs. Features a mode selector for campaign creation, a unified content calendar, and audience health scoring. Consolidates AI features into an AI hub.
- **Client Momentum Agent:** Relationship intelligence system calculating per-contact momentum scores for prioritized action recommendations.
- **Campaign Intelligence Agent:** Provides post-campaign analysis, AI-powered performance briefings, pre-send validation, and send-time optimization.
- **AI Command Hub System:** Unified AI access point per module with "Tools" (AI capabilities) and "Insights" (proactive AI suggestions).
- **Billing & Payment System:** Supports multi-method payments (WiPay, PayPal, Google Pay, bank transfer, cash) and features `PaymentLink` for shareable links, a public payment page, and redesigned payment settings. Manages subscription billing history.
- **Core Workflows:** Quote-to-Invoice, multi-gateway payment, subscription & billing, and expense tracking.
- **User & Security:** Multi-Tenant System with `businessId` isolation, personalized authentication (Google OAuth), notification system, input sanitization, DTO validation, rate limiting, and AI prompt injection guards.
- **Data Integrity:** Ensures atomic operations for campaign sending, lead form submissions, and valid tax/discount bounds.
- **Store Module:** Redesigned with Storefront, Products & Hours, and Performance tabs. Features a consolidated setup surface for the storefront, detailed product and hour management, and comprehensive performance analytics with AI Command Hub capabilities.
- **Expenses Module:** Decomposed into a modular structure with dedicated components for filters, stats, list, forms, budgets, vendors, categories, and analytics, organized into three tabs: Expenses, Budgets, and Analytics.
- **Projects Module:** Decomposed into a modular structure with components for project board (kanban), task list, playbook panel, and workflow configuration, organized into two tabs: Projects and Playbooks.
- **Settings Consolidation:** All configuration settings are centralized in a dedicated Settings section, with deep-links from other modules to avoid duplication.
- **Cross-Module Contact Journey:** Enhanced `ContactJourneyTimeline` component provides a unified lifecycle timeline for contacts, merging events, notes, tasks, invoices, and bookings into chronological entries with cross-module CTAs.
- **Financial Copilot Agent:** Monitors revenue, expenses, and cash flow with anomaly detection, providing a Financial Pulse dashboard and weekly AI-powered briefings.
- **Customer Notification System:** Transactional email system for sending branded customer-facing emails via connected Gmail. Supports 6 notification types with event-driven triggers, cron jobs, and customizable preferences.
- **Cross-Module Intelligence Agent:** An event-driven workflow engine that listens to key module events and triggers cross-module actions.
- **Platform Features:** Gamification system, online store & public booking page, module event bus, reusable keyboard shortcuts, and a webhook dispatcher system.
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