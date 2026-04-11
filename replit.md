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
- **Modules:** Commerce (accordion layout: Invoices, Quotes, Payments, Recurring as collapsible sections), CRM (single Contacts view — removed Insights/Studio tabs), Bookings (Schedule + Setup tabs — removed Performance tab), Marketing (Create & Schedule, Calendar, Audiences & Forms — removed Performance tab), Store (My Store + Orders tabs — removed Insights tab), Expenses (accordion layout: Expenses + Budgets & Categories — removed Analytics tab), Projects (Kanban, task tracking). Automations/Learn/Community accessible via URL but removed from sidebar.
- **Sidebar Navigation:** 3 groups — CORE (Today, Contacts, Commerce, Bookings), GROW (Marketing, Store), MANAGE (Expenses, Projects, Reports). Settings in bottom section. Consolidated from 14 to 9 items.
- **ModuleAccordion Component:** Reusable `components/ui/module-accordion.tsx` for collapsible section layouts with animated expand/collapse, badge counts, and multi-open support.
- **Business Intelligence Context System:** `BusinessContextService` (`business-context.service.ts`) gathers a rich snapshot of all business data (services, products, contacts, bookings, revenue, social presence, location, hours) to power AI field generation. All AI content generation (tagline, description, skills, profile) uses the full business context for personalized, data-informed output.
- **AI Copilot System:** Global AI entry point with route-aware context detection, chat drawer, and suggestion nudges.
- **Billing & Payment:** Multi-method payments, shareable `PaymentLink`s, and subscription billing.
- **Core Workflows:** Quote-to-Invoice, multi-gateway payment, subscription & billing, and expense tracking.
- **User & Security:** Multi-Tenant System with `businessId` isolation, personalized authentication (Google OAuth), notification system, input sanitization, DTO validation, rate limiting, and AI prompt injection guards.
- **Cross-Module Intelligence Agents:** Client Momentum, Campaign Intelligence, Financial Copilot, and an event-driven workflow engine for cross-module actions.
- **Data Integrity:** Ensures atomic operations for campaign sending, lead forms, and tax/discount bounds.
- **Public Storefront (`/book/[slug]`):** Premium, mobile-first, conversion-optimized storefront with section-based layout, product detail pages, category navigation, featured products, FAQ, policy pages, contact section, testimonials, structured data, dynamic Google Font pairing loading, persistent checkout order summary, configurable tax rate (0 = hidden), and email capture for order notifications.
- **Store Setup Wizard:** 5-step guided setup (URL, catalog, design, hours, go-live) with done/pending status badges, step connectors, and completion celebration with share CTA. Replaces generic checklist.
- **Trust Bar:** Dynamic trust metrics with optional `completedOrdersCount` and `businessHoursToday` props, graceful fallbacks to static labels.
- **Financial Copilot Agent:** Monitors revenue, expenses, and cash flow with anomaly detection and weekly AI-powered briefings.
- **Customer Notification System:** Transactional email system for branded customer-facing emails.
- **Platform Features:** Gamification, online store, public booking page, module event bus, keyboard shortcuts, webhook dispatcher, and developer settings.
- **Tiered Monetization:** Plan comparison grid with feature breakdowns.
- **Observability:** Request correlation ID, logging interceptor, and health checks.
- **Learn Module:** MasterClass functionality with My Learning, Catalog, and Certificates.
- **Profile Module:** Two-tab layout (Profile / Documents) with URL query param sync (`?tab=documents`). Profile tab: personal-info-section, professional-profile-section, security-section with profile completeness ring, **Business Builder** (professional-grade AI-powered business planning system with 12-step intake wizard [9 text + 3 selection: Stage, Timeline, Legal Structure] → generates comprehensive Business Model Canvas, Legal & Compliance analysis (BIR/VAT/tax/contracts/insurance/compliance checklist with T&T legislation references), Competitive Analysis with SWOT matrix, Unit Economics (CAC/LTV/ARPU/margins/payback/break-even), execution roadmap, action plan, enhanced financial outlook (funding strategy, cash flow projection, 3-scenario revenue), and risk assessment (impact + likelihood + category + mitigation + contingency); 7 result tabs: Canvas, Legal, SWOT, Financials, Roadmap, Actions, Risks; 8000-token AI responses; results persist server-side in `BusinessPlan` model with versioning; section-level inline editing; task creation; module deep-links; 4-phase progress tracker; frontend + backend AI response validation with graceful fallbacks), CSS variable theming, and unsaved-changes protection. Documents tab: full document catalog, my documents list, health dashboard, AI generator modal with `?generate=<slug>` deep-link support, and Google Drive browser with inline doc viewing/editing (embedded via `documents-tab.tsx` + `google-drive-browser.tsx`). The standalone `/app/documents` route redirects to `/app/profile?tab=documents`; document detail pages remain at `/app/documents/[instanceId]`.
- **Google Drive Integration:** OAuth2 connection to user's Google Drive with `drive.file` scope (read + write files created by the app). Features: Browse/search/filter files, inline preview via embed URLs, **Save documents to Drive** (creates formatted Google Docs from generated documents), **Export HTML** for print/download. OAuth reuses CRM callback URL with `flow: 'drive'` state field for routing. Accessible from Documents tab > Google Drive view. Backend: `GoogleDriveModule` (`apps/server/src/modules/google-drive/`). Token fields: `driveEmail`, `driveAccessToken`, `driveRefreshToken`, `driveTokenExpiry` on Business model.
- **Universal Export System:** All AI-generated content is exportable via 4 actions: **Download** (client-side .txt), **Email** (transactional email to user's inbox), **Save to Drive** (Google Doc), **Print** (HTML print view). Documents use per-instance endpoints; all other generated content (Business Plans, etc.) uses generic export endpoints on the Drive controller: `POST /drive/businesses/:bid/email-content`, `POST /drive/businesses/:bid/save-document`, `POST /drive/businesses/:bid/export-html`. Payload format: `{ title, sections: [{ sectionName, content }], documentType, category, version }`. Business Builder results panel includes all 4 export actions in the header bar via `modelToSections()` converter.
- **Business Documentation Engine:** AI-powered document generation, versioning, and health tracking across 18 categories (6 Universal Core + 10 Triggered Core + 2 Advanced), 96 document types. Features: document generator with AI drafting via BusinessContextService, section-level editing with risk-tiered edit modes (GREEN/YELLOW/RED), AI tweak bar, version history, audit logs, review task resolution, health dashboard with impact detection. Profile changes automatically detect and flag impacted documents via ImpactRule system (81 seeded rules). **Document Blueprint System** (`document-blueprints.ts`): per-document-type section blueprints (20+ key documents), category-level quality directives (all 18 categories), and sensitivity-driven quality layers (legal, financial, brand, jurisdiction) that compose into comprehensive AI prompts. Generation uses elevated standards: comprehensive, applicable, modern, and reliable output with Caribbean/international jurisdiction awareness, structured clause numbering for legal docs, and industry-specific compliance references. Models: DocumentCategory, DocumentType, DocumentInstance, DocumentVersion, DocumentSection, ReviewTask, DocumentChangeLog, ImpactRule, OrgStandard, BusinessProfileVersion.
- **Community Module:** Feed and Cohorts with social functionalities and public profile views.
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