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
- All listing/grid views must be compact, minimizing vertical height and scrolling. Hover reveals additional info, click opens full detail interface.
- UI elements, unified design language, enhanced data tables, and accessible design with ARIA compliance.
- Product detail and form components emphasize inline editing, real-time previews, validation, and performance.
- Standardized shared component library and consolidated shell design.
- Simplified "Today" surface with greeting header, cash flow forecast, priority queue, and collapsible AI briefing card.
- Tiered navigation with Primary Rail + Secondary Panel, featuring four master surfaces: Cockpit, Workspaces, Studio, and Public.

**Technical Implementations & Features:**
- **AI-Powered Automation:** Business Autopilot System for archetype inference, revenue model detection, task orchestration, and legal/compliance, including a global AI entry point with route-aware context detection, chat drawer, and suggestion nudges.
- **Business Intelligence Context System:** Gathers comprehensive business context from 16 guidance sub-profiles, organized into labeled domain sections, with a 5-tier weighted completeness system, progressive deepening prompts, capability unlock mapping, and a Business Builder intake wizard.
- **Workspaces:**
    - **Revenue Workspace:** Restructured into 3-mode tabbed layout (Operations, Catalog, Setup) with a 6-metric revenue command strip, triage-driven action queue, and product segmentation.
    - **Clients Workspace:** Comprehensive client management with metrics, priority queue, enhanced list views, context-aware communication, and an upgraded AI Priority Queue Brain.
    - **Calendar Workspace:** Restructured into Schedule, Performance, and Setup tabs, featuring KPI strips, utilization charts, and AI insights.
    - **Content Workspace:** Full content OS with modes for Create & Schedule, Calendar, Audiences & Forms, including a social composer with AI Actions panel, Content Readiness indicator, and intelligent scheduling.
    - **Projects Workspace:** Premium delivery execution workspace with a 3-tab layout (Board, List, Templates), featuring a 6-stage kanban board, rich project cards with risk detection, and an AI hub.
    - **Expenses Workspace:** Elevated spending intelligence workspace with 4-tab layout (Transactions, Budgets, Categories, Insights), 7-metric KPI strip with Spending Health Score, inline category assignment with bulk categorization, period-over-period comparison bars with anomaly detection in Categories, margin/cost analysis with recurring vs variable split in Insights, vendor distribution with concentration scoring and diversification recommendations, and AI cost-control guidance with prioritized savings recommendations.
    - **Flows Workspace:** Intelligent orchestration surface with a 3-tab layout (My Flows, Templates, Activity Log), featuring a Flow Health Strip, Flow Coverage Map, and an upgraded Playbook Builder.
    - **Profile & Intelligence Workspace:** Five-mode layout redesigned as an identity and intelligence foundation layer with outcome-linked forms and cross-module impact visualization.
- **Core Business Functions:** Billing & Payment (multi-method payments, subscription billing, quote-to-invoice workflows), User & Security (Multi-Tenant System, personalized authentication, global input sanitization, AI prompt injection guards), Financial Copilot Agent (monitors revenue, expenses, cash flow with anomaly detection and AI briefings).
- **Communication & Content:** Customer Notification System (transactional email system), Unified Composer & Distribution UX (compose once, distribute intelligently experience in Content workspace with audience segment selection and pre-send email validation), Communications Delivery Engine (unified outbound publishing system with adapter-based architecture for Meta, Google, and WhatsApp providers, event bus integration), WhatsApp Business Integration (Meta Business API v19.0 adapter for text, template, and media messages), Audience Health Dashboard (email coverage, deliverability rates, suppression tracking, segment visualization in Audiences tab).
- **Commerce & Fulfillment:** Public Storefront (`/book/[slug]`) (premium, mobile-first, conversion-optimized storefront), Store Dashboard (flagship brand-aware e-commerce dashboard), Fulfillment Engine & Order Routing (intelligent orchestration for all major fulfillment models including local stock, dropship, preorder, hybrid, manual, service), Commerce Data Layer & Supplier Architecture (new Prisma models for SupplierConnection, SupplierProduct, ProductVariant, ProductSourceLink, ProductCostProfile, and Supplier adapter interface), Commerce Intelligence & AI (full commerce copilot layer with LandedCostEngine, MarginAnalysisService, SourceRiskService, InventoryRiskService, and AI product/pricing/fulfillment advisors).
- **Platform Utilities:** Cross-Module Intelligence Agents (Client Momentum, Campaign Intelligence, Financial Copilot), Gamification, online store, public booking page, module event bus, keyboard shortcuts, webhook dispatcher, developer settings, Universal Export System (all AI-generated content exportable), Business Documentation Engine (AI-powered document generation), Navigation & Command System (sidebar, Command Palette, persistent AI Copilot quick-action chips), System Diagnostics & Health Center.
- **Security:** Error Boundaries for core modules, `PublicRateLimitGuard` for unauthenticated endpoints.

## External Dependencies
- **Database:** PostgreSQL
- **Authentication:** Supabase Auth
- **AI:** OpenAI
- **Google Services:** Google Calendar, Google Sign-In, Gmail, Google Contacts, Google Drive
- **Payment Gateways:** WiPay, PayPal, Google Pay
- **Rich Text:** TipTap (React)
- **Charts:** Recharts
- **Package Manager:** pnpm