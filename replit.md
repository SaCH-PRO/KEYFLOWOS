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

**Technical Implementations & Features:**
- **AI-Powered Automation:** Business Autopilot System for archetype inference, revenue model detection, task orchestration, and legal/compliance.
- **Command Center:** Simplified "Today" surface with greeting header, cash flow forecast, priority queue, and collapsible AI briefing card.
- **Modules:** Commerce, CRM, Bookings, Marketing, Store, Expenses, Projects, and Reports. Automations/Learn/Community accessible via URL.
- **Sidebar Navigation:** Consolidated navigation with CORE (Today, Contacts, Commerce, Bookings), GROW (Marketing, Store), and MANAGE (Expenses, Projects, Reports) groups. Settings are in the bottom section.
- **Business Intelligence Context System:** Gathers comprehensive business context from 16 guidance sub-profiles, organized into labeled domain sections. Features a 5-tier weighted completeness system, progressive deepening prompts, and capability unlock mapping. Includes a Business Builder intake wizard.
- **AI Copilot System:** Global AI entry point with route-aware context detection, chat drawer, and suggestion nudges.
- **Billing & Payment:** Multi-method payments, shareable PaymentLinks, and subscription billing.
- **Core Workflows:** Quote-to-Invoice, multi-gateway payment, subscription & billing, and expense tracking.
- **User & Security:** Multi-Tenant System with `businessId` isolation, personalized authentication (Google OAuth), notification system, input sanitization, DTO validation, rate limiting, and AI prompt injection guards.
- **Cross-Module Intelligence Agents:** Client Momentum, Campaign Intelligence, Financial Copilot, and an event-driven workflow engine for cross-module actions.
- **Public Storefront (`/book/[slug]`):** Premium, mobile-first, conversion-optimized storefront with section-based layout, product detail pages, category navigation, featured products, FAQ, policy pages, contact section, testimonials, structured data, dynamic Google Font pairing loading, persistent checkout order summary, configurable tax rate, and email capture.
- **Store Setup Wizard:** 5-step guided setup process for storefront configuration.
- **Financial Copilot Agent:** Monitors revenue, expenses, and cash flow with anomaly detection and weekly AI-powered briefings.
- **Customer Notification System:** Transactional email system for branded customer-facing emails.
- **Platform Features:** Gamification, online store, public booking page, module event bus, keyboard shortcuts, webhook dispatcher, and developer settings.
- **Tiered Monetization:** Plan comparison grid with feature breakdowns.
- **Observability:** Request correlation ID, logging interceptor, and health checks.
- **System Diagnostics & Health Center:** Real-time on-demand diagnostics dashboard at `/admin/system` with checks across Infrastructure, Modules, Integrations, Cross-Module Flows, and Environment Variables.
- **Learn Module:** MasterClass functionality with My Learning, Catalog, and Certificates.
- **Profile Module (Consolidated Hub):** Three-tab layout (Profile / Brand & Identity / Documents).
    - **Profile tab**: Personal and business information, security, compliance, and an integrated Business Intelligence Engine for autonomous business intelligence and execution. This engine includes a multi-agent reasoning system, a 17-step intake wizard, 12000-token AI responses, and 9 result tabs (Overview, Canvas, Legal, SWOT, Financials, Roadmap, Actions, Risks, Governance). It supports a Premium Build Mode, truth/evidence/assumption labeling, and versioning.
    - **Brand & Identity tab**: Logo uploader, business information, social media links, and branding/color customization.
    - **Documents tab**: Full document catalog, my documents list, health dashboard, AI generator modal, and Google Drive browser integration.
- **Google Drive Integration:** OAuth2 connection for browsing, searching, filtering, inline preview, saving generated documents, and exporting HTML.
- **Universal Export System:** All AI-generated content is exportable via Download, Email, Save to Drive, and Print options.
- **Business Documentation Engine:** AI-powered document generation, versioning, and health tracking across 18 categories and 96 document types. Features include AI drafting, section-level editing with risk-tiered modes, AI tweak bar, version history, audit logs, review tasks, and impact detection. Uses a Document Blueprint System for structured generation.
- **Navigation & Command System:** Sidebar, breadcrumbs, Command Palette (⌘K), and persistent AI Copilot quick-action chips.
- **Error Boundaries:** Dedicated `error.tsx` boundaries for all core modules.

## External Dependencies
- **Database:** PostgreSQL
- **Authentication:** Supabase Auth
- **AI:** OpenAI
- **Google Services:** Google Calendar, Google Sign-In, Gmail, Google Contacts, Google Drive
- **Payment Gateways:** WiPay, PayPal, Google Pay
- **Rich Text:** TipTap (React)
- **Charts:** Recharts
- **Package Manager:** pnpm
- **Storage:** App Storage