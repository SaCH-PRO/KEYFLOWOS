# KEYFLOWOS Monorepo

## Overview
KEYFLOWOS is an AI-powered operating system designed to automate operations for service businesses, aiming for 80-90% automation. It provides pre-built Playbooks, a unified "Command" center with an AI-powered command bar, voice input, and integrated business intelligence. The system integrates six core engines: LaunchFlow, OperateAI, GrowthStack, ProfitLens, ScaleHub, and MasterClass Mode, offering a comprehensive solution for business automation, growth, and management.

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
- Standardized shared component library and consolidated shell design.
- Defined CSS type scales and card variants for consistent styling.

**Technical Implementations & Features:**
- **AI-Powered Automation:** Business Autopilot System for archetype inference, revenue model detection, task orchestration, and legal/compliance.
- **Command Center:** Simplified "Today" surface with greeting header, cash flow forecast, priority queue, and collapsible AI briefing card.
- **Modules:** Commerce (invoices, payments, revenue analysis), CRM (contact management, lead scoring, churn detection), Bookings (scheduling, capacity, staff management), Marketing (campaigns, content calendar, audience scoring), Store (accordion-based filing tab UI with collapsible grouped sections — Setup/Design/Content/Settings — 3 top tabs: My Store, Orders, Insights), Expenses (budgets, vendors, analytics), Projects (Kanban, task tracking), and Automations (playbook editor, templates, activity logs).
- **Business Intelligence Context System:** `BusinessContextService` (`business-context.service.ts`) gathers a rich snapshot of all business data (services, products, contacts, bookings, revenue, social presence, guidance insights, location, hours) to power AI field generation. All AI content generation (tagline, description, skills, profile) uses the full business context for personalized, data-informed output.
- **AI Copilot System:** Global AI entry point with route-aware context detection, chat drawer, and suggestion nudges.
- **Billing & Payment:** Multi-method payments, shareable `PaymentLink`s, and subscription billing.
- **Core Workflows:** Quote-to-Invoice, multi-gateway payment, subscription & billing, and expense tracking.
- **User & Security:** Multi-Tenant System with `businessId` isolation, personalized authentication (Google OAuth), notification system, input sanitization, DTO validation, rate limiting, and AI prompt injection guards.
- **Cross-Module Intelligence Agents:** Client Momentum, Campaign Intelligence, Financial Copilot, and an event-driven workflow engine for cross-module actions.
- **Data Integrity:** Ensures atomic operations for campaign sending, lead forms, and tax/discount bounds.
- **Public Storefront (`/book/[slug]`):** Premium, mobile-first, conversion-optimized storefront with section-based layout, product detail pages, category navigation, featured products, FAQ, policy pages, contact section, testimonials, and structured data.
- **Business Guidance Engine:** AI-powered recommendation engine and strategic advisor with a 13-step profiling wizard, diagnostic scoring, financial analysis, and roadmap generation. Includes a Guidance Dashboard with key metrics and insights.
- **Financial Copilot Agent:** Monitors revenue, expenses, and cash flow with anomaly detection and weekly AI-powered briefings.
- **Customer Notification System:** Transactional email system for branded customer-facing emails.
- **Platform Features:** Gamification, online store, public booking page, module event bus, keyboard shortcuts, webhook dispatcher, and developer settings.
- **Tiered Monetization:** Plan comparison grid with feature breakdowns.
- **Observability:** Request correlation ID, logging interceptor, and health checks.
- **Learn Module:** MasterClass functionality with My Learning, Catalog, and Certificates.
- **Profile Module:** Modular accordion-based UI (personal-info-section, professional-profile-section, security-section) with profile completeness ring, CSS variable theming, and unsaved-changes protection. Business Guidance Engine dashboard with AI health scores and roadmap.
- **Community Module:** Feed and Cohorts with social functionalities and public profile views.
- **Navigation & Command System:** Sidebar, breadcrumbs, Command Palette (⌘K), and persistent AI Copilot quick-action chips.
- **Error Boundaries:** Dedicated `error.tsx` boundaries for all core modules.

## External Dependencies
- **Database:** PostgreSQL
- **Authentication:** Supabase Auth
- **AI:** OpenAI
- **Google Services:** Google Calendar, Google Sign-In, Gmail, Google Contacts
- **Payment Gateways:** WiPay, PayPal, Google Pay
- **Rich Text:** TipTap (React)
- **Charts:** Recharts
- **Package Manager:** pnpm
- **Storage:** App Storage