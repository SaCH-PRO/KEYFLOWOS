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
- **Commerce Module:** Manages Quotes, Invoices, Schedules, and Insights. Includes services for CRUD, KPIs with caching, and AI-driven analysis. Supports unified currency, recurring invoices, and a `TemplateStudio`.
- **CRM Module:** Modular CRM with contact management, duplicate detection, AI copilot, bulk editing, and notes/tasks system. Provides AI for contact summarization, lead scoring, and `CrmActionsService` for prioritized next actions.
- **Bookings Module:** Features Calendar, Products, and Insights tabs with AI for NL search, schedule optimization, and no-show prediction.
- **Marketing Module:** Combines Marketing and Social functionalities. Features a centralized `useMarketing` hook, `useMarketingAiHub` for AI suggestions, and cross-module event listening. Includes social post composer, enhanced content calendar, bulk actions, and a `MarketingLaunchpad` for onboarding.
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