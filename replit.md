# KEYFLOWOS Monorepo

## Overview
KEYFLOWOS is an AI-powered operating system designed to automate operations for service businesses, aiming for 80-90% automation. It provides pre-built Playbooks, a unified "Command" center with an AI-powered command bar, voice input, and integrated business intelligence. The system integrates six core engines: LaunchFlow, OperateAI, GrowthStack, ProfitLens, ScaleHub, and MasterClass Mode, offering a comprehensive solution for business automation, growth, and management. Its business vision is to provide a comprehensive, AI-driven platform for business automation, growth, and management, with a high degree of automation and pre-opinionated workflows.

## User Preferences
- Caribbean localization (TTD currency, Trinidad timezone)
- Refined dark theme with selective glassmorphism (Linear/Stripe/Notion-inspired)
- Event-driven architecture for automation
- Pre-opinionated flows (Playbooks)

## System Architecture
The project is a monorepo utilizing a Next.js 16 frontend (`apps/web`) and a NestJS backend API (`apps/server`), with PostgreSQL managed by Prisma. The backend uses SWC for transpilation, requiring explicit `@Inject(Token)` decorators for NestJS constructor injection.

**UI/UX Decisions:**
- Redesigned design system with a warm Caribbean color palette (orange `#F97316` primary, teal `#14B8A6` secondary), selective glassmorphism, clean elevation system, and PWA capabilities.
- **Compact UI Rule**: All listing/grid views must be compact, minimizing vertical height and scrolling. Hover reveals additional info (tooltips/overlays), click opens full detail interface.
- Compact UI elements, unified design language, enhanced data tables, and accessible design with ARIA compliance.
- Product detail and form components emphasize inline editing, real-time previews, validation, and performance.
- Standardized shared component library and consolidated shell design.

**Technical Implementations & Features:**
- **AI-Powered Automation:** Business Autopilot System for archetype inference, revenue model detection, task orchestration, and legal/compliance. Includes a global AI entry point with route-aware context detection, chat drawer, and suggestion nudges.
- **Command Center:** Simplified "Today" surface with greeting header, cash flow forecast, priority queue, and collapsible AI briefing card.
- **4-Surface Navigation Architecture:** Tiered navigation with Primary Rail + Secondary Panel. Four master surfaces: Cockpit, Workspaces, Studio, and Public.
- **Business Intelligence Context System:** Gathers comprehensive business context from 16 guidance sub-profiles, organized into labeled domain sections. Features a 5-tier weighted completeness system, progressive deepening prompts, and capability unlock mapping. Includes a Business Builder intake wizard.
- **Revenue Workspace (formerly Commerce):** Restructured into 3-mode tabbed layout (Operations, Catalog, Setup). Features a 6-metric revenue command strip, triage-driven action queue, inline status summaries per section (invoices/quotes/payments), product segmentation in Catalog mode, readiness indicators and cross-module links in Setup mode. All existing billing functionality preserved (invoices, quotes, payments, recurring, products).
- **Billing & Payment:** Multi-method payments, shareable PaymentLinks, subscription billing, quote-to-invoice workflows, and expense tracking.
- **User & Security:** Multi-Tenant System with `businessId` isolation, personalized authentication, notification system, global input sanitization, DTO validation, rate limiting on all public endpoints, and AI prompt injection guards.
- **Clients Workspace:** Comprehensive client management with metrics, priority queue, enhanced list views, context-aware communication, stage-change workflow panels, and activity timelines. Includes an upgraded AI Priority Queue Brain for intelligent client prioritization and action generation.
- **Calendar Workspace:** Restructured into Schedule, Performance, and Setup tabs. Features include KPI strips, utilization charts, service demand rankings, staff load cards, AI insights, and a setup builder with readiness indicators and dependency warnings.
- **Cross-Module Intelligence Agents:** Client Momentum, Campaign Intelligence, Financial Copilot, and an event-driven workflow engine.
- **Public Storefront (`/book/[slug]`):** Premium, mobile-first, conversion-optimized storefront with section-based layout, product detail pages, category navigation, and a Store Setup Wizard.
- **Store Dashboard:** Flagship brand-aware e-commerce dashboard with live stat cards, catalog preview, QR code generation, and accordion-based storefront configuration.
- **Financial Copilot Agent:** Monitors revenue, expenses, and cash flow with anomaly detection and weekly AI-powered briefings.
- **Customer Notification System:** Transactional email system for branded customer-facing emails with delivery status dashboard.
- **Platform Features:** Gamification, online store, public booking page, module event bus, keyboard shortcuts, webhook dispatcher, and developer settings.
- **Observability:** Request correlation ID, logging interceptor, and health checks.
- **System Diagnostics & Health Center:** Real-time on-demand diagnostics dashboard at `/admin/system`.
- **Learn Module:** MasterClass functionality with My Learning, Catalog, and Certificates.
- **Profile Module (Consolidated Hub):** Three-tab layout (Profile / Brand & Identity / Documents).
    - **Profile tab**: Personal/business info, security, compliance, integrated Business Intelligence Engine with multi-agent reasoning, intake wizard, and result tabs.
    - **Brand & Identity tab**: Logo uploader, business info, social media, branding/color customization.
    - **Documents tab**: Full document catalog, my documents, health dashboard, AI generator modal, and Google Drive browser integration.
- **Universal Export System:** All AI-generated content is exportable.
- **Business Documentation Engine:** AI-powered document generation, versioning, and health tracking across 18 categories and 96 document types, with risk-tiered editing and a Document Blueprint System.
- **Navigation & Command System:** Sidebar, breadcrumbs, Command Palette (⌘K), and persistent AI Copilot quick-action chips.
- **Project Templates:** Create reusable templates with pre-defined tasks; auto-project creation from invoice payment.
- **Automation Playbook Templates:** 18 pre-built automation recipes across all modules with one-click activation.
- **Error Boundaries:** Dedicated `error.tsx` boundaries for all core modules.
- **Security: PublicRateLimitGuard:** Reusable rate-limiting guard applied to all unauthenticated endpoints.
- **KeyflowOS Store Quick-Access:** Global sidebar icon with slide-out drawer showing 3-tier Business Progression System (Build, Grow, Scale).

## External Dependencies
- **Database:** PostgreSQL
- **Authentication:** Supabase Auth
- **AI:** OpenAI
- **Google Services:** Google Calendar, Google Sign-In, Gmail, Google Contacts, Google Drive
- **Payment Gateways:** WiPay, PayPal, Google Pay
- **Rich Text:** TipTap (React)
- **Charts:** Recharts
- **Package Manager:** pnpm