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
- **Content Workspace (formerly Marketing):** Full content OS with 3 top modes (Create & Schedule, Calendar, Audiences & Forms) and 4 submodes (Compose, Campaigns, Posts, Scheduled). Features include: social composer with Objective/Audience/Tone selectors and AI Actions panel (Generate Draft, Improve Hook, CTA, Hashtags, Rewrite), Content Readiness indicator, Content Intelligence Strip, Business Pulse Strip (cross-module insights from CRM pipeline, revenue, and bookings), calendar density indicators (month + week views with overload warnings), scheduled submode with timing conflict/gap/cadence detection and AI best-time suggestions, audience health with 4-tier states, segment quick actions with progress bars, lead forms with linked field indicators. AI hub enriched with cross-module business context for smarter suggestions.
- **Cross-Module Intelligence Agents:** Client Momentum, Campaign Intelligence, Financial Copilot, and an event-driven workflow engine.
- **Public Storefront (`/book/[slug]`):** Premium, mobile-first, conversion-optimized storefront with section-based layout, product detail pages, category navigation, and a Store Setup Wizard.
- **Store Dashboard:** Flagship brand-aware e-commerce dashboard with live stat cards, catalog preview, QR code generation, and accordion-based storefront configuration.
- **Financial Copilot Agent:** Monitors revenue, expenses, and cash flow with anomaly detection and weekly AI-powered briefings.
- **Customer Notification System:** Transactional email system for branded customer-facing emails with delivery status dashboard.
- **Platform Features:** Gamification, online store, public booking page, module event bus, keyboard shortcuts, webhook dispatcher, and developer settings.
- **Observability:** Request correlation ID, logging interceptor, and health checks.
- **System Diagnostics & Health Center:** Real-time on-demand diagnostics dashboard at `/admin/system`.
- **Learn Module:** MasterClass functionality with My Learning, Catalog, and Certificates.
- **Profile & Intelligence Workspace (Fully Overhauled — Phases 1-5 Complete):** Five-mode layout (Overview / Business / Professional / Documents & Intelligence / Security & Preferences). Redesigned as identity and intelligence foundation layer with outcome-linked forms and cross-module impact visualization.
    - **Overview mode**: Strategic landing with Business Foundation progress, Intelligence Readiness summary, "What KEYFLOWOS Sees" context display, Cross-Module Impact grid (data coverage per module), Recommended Next Steps engine with priority badges, AI-Powered Actions panel, Recommended Documents with module linkage, and Key Unlocks status.
    - **Business mode**: Business Profile Completion strip (Identity/Team/Hours/Brand status grid). Business Identity forms with AI-generated tagline/description, Team & Scale, Operating Hours, Brand & Identity. Each section has per-accordion completion indicators (X/Y fields), inline field impact notes ("→ Appears on invoices..."), and "What this powers" downstream module annotations with module chips.
    - **Professional mode**: Professional Profile Completion strip (Personal/Identity/Industry/Skills/Location). Personal info and professional profile sections. Each section has completion strips, "powers" indicators with impact descriptions, and a field-to-module impact banner.
    - **Documents & Intelligence mode**: Premium surface with Intelligence Engine header (Premium badge), Intelligence Confidence panel (data-point checklist with impact ratings), Business Intelligence Engine (5-tier completeness), Smart Suggestions, Intelligence Package generation, Document-to-Module Links (showing which documents strengthen which modules), module connection map with per-module color coding, and full document catalog with health dashboard and Google Drive integration.
    - **Security & Preferences mode**: Password change with strength indicator, appearance/theme selector. Isolated from strategic business planning with explicit isolation messaging banner.
- **Universal Export System:** All AI-generated content is exportable.
- **Business Documentation Engine:** AI-powered document generation, versioning, and health tracking across 18 categories and 96 document types, with risk-tiered editing and a Document Blueprint System.
- **Navigation & Command System:** Sidebar, breadcrumbs, Command Palette (⌘K), and persistent AI Copilot quick-action chips.
- **Projects Workspace:** Premium delivery execution workspace with 3-tab layout (Board, List, Templates). Features Delivery Pulse execution summary strip (active/due this week/blocked/overdue/completed/unlinked metrics), 6-stage kanban board (Not Started, In Progress, Waiting on Client, Review, Blocked, Completed + Archived), rich project cards with risk detection (healthy/at-risk/overdue/blocked), linked client/invoice/booking chips, progress bars, overdue task indicators, search filtering, and sortable list view. Full 10-tab project detail workspace (Overview with metrics/recommendations, Tasks with priority/overdue filters, Milestones with completion tracking, Timeline event log, Notes, Client link, Revenue link, Calendar/dates, Flows/automations, Deliverables). AI hub with 6 tools (Generate Plan, Prioritize Tasks, Assess Risk, Detect Bottlenecks, Draft Client Update, Suggest Flows) and intelligent suggestions (blocked/overdue/unlinked detection). Reusable project templates with task pre-definition; auto-project creation from invoice payment.
- **Flows Workspace (formerly Automations, route: `/app/automations`):** Intelligent orchestration surface with 3-tab layout (My Flows, Templates, Activity Log). Features Flow Health Strip (active/paused/triggered/needs-attention metrics), Flow Coverage Map (per-module automation %), Recommended Flows (gap-based suggestions), upgraded flow cards with module-touched chips and health indicators, redesigned Playbook Builder with step-block visual chain and natural-language summaries, enriched Template Gallery with businessProblem/expectedOutcome/prerequisites/complexity filters, and Execution Diagnostics with stats strip, time-range filters, rerun/inspect actions. 19+ strategic automation templates across all modules.
- **Automation Playbook Templates:** 19+ pre-built automation recipes across all modules with one-click activation, enriched with business context, complexity ratings, and module coverage metadata.
- **Error Boundaries:** Dedicated `error.tsx` boundaries for all core modules.
- **Security: PublicRateLimitGuard:** Reusable rate-limiting guard applied to all unauthenticated endpoints.
- **KeyflowOS Store Quick-Access:** Global sidebar icon with slide-out drawer showing 3-tier Business Progression System (Build, Grow, Scale).
- **Communications Delivery Engine (Mission 1 — Task #74/#75):** Unified outbound publishing system with 6 Prisma models (ChannelConnection → ChannelDestination → OutboundContent → OutboundVariant → OutboundDelivery → DeliveryEvent). Adapter-based architecture with `AdapterRegistryService` resolving META (Facebook Page + Instagram Business via MetaAdapter) and GOOGLE (Gmail via EmailAdapter) providers. `DeliveryQueueService` polls every 30s for due deliveries, executes through adapters, records `DeliveryEvent` audit trail, and supports exponential backoff retry (60s × 2^retryCount). Full REST API at `/communications/` for connections, destinations, content, variants, publish-now, schedule, reschedule, cancel, retry, and delivery summary. Event bus integration emits `content.published`, `content.failed`, `delivery.completed`, `delivery.failed`. Status lifecycle: Draft → Scheduled → Queued → Sending → Published/Failed → RetryPending.

## External Dependencies
- **Database:** PostgreSQL
- **Authentication:** Supabase Auth
- **AI:** OpenAI
- **Google Services:** Google Calendar, Google Sign-In, Gmail, Google Contacts, Google Drive
- **Payment Gateways:** WiPay, PayPal, Google Pay
- **Rich Text:** TipTap (React)
- **Charts:** Recharts
- **Package Manager:** pnpm