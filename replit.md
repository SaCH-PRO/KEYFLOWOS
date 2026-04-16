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
- Standardized shared component library and consolidated shell design.
- Simplified "Today" surface with greeting header, cash flow forecast, priority queue, and collapsible AI briefing card.
- Tiered navigation with Primary Rail + Secondary Panel, featuring five master surfaces: Cockpit, Control Tower, Workspaces, Studio, and Public.

**Technical Implementations & Features:**
- **AI-Powered Automation:** Features a Business Autopilot System for archetype inference, revenue model detection, task orchestration, and legal/compliance. It includes a global AI entry point with route-aware context detection, chat drawer, and suggestion nudges. The AI Business Office Foundations layer implements an Intent → Plan → Execute → Log pipeline with a 4-tier governance engine and a comprehensive audit trail. An AI Copilot UX Shell provides a Global Copilot Panel (AI Command Center), module-contextual quick actions, and a Pro Auto Monitoring Engine that scans 10 health domains for actionable suggestions.
- **Global AI Command Layer (Phase 3):** The Copilot Panel is the sole AI interaction surface across all workspaces. Features: plan-first chat execution with structured plan steps (approve/reject per step), dynamic quick prompts generated from ProAutoInsights and business graph state (not hardcoded), unified cross-module Queue tab showing pending approvals + action queue items with module badges and priority sorting, Activity tab with per-action execution logs showing success/failure status and module context. Module AI hubs broadcast their context via `kf:module-context-update` CustomEvents consumed by the `AiContextProvider` (`apps/web/src/contexts/ai-context.tsx`), enabling the global command layer to be context-aware without direct coupling.
- **Business Intelligence Context System:** Gathers comprehensive business context from 16 guidance sub-profiles with a 5-tier weighted completeness system and a Business Builder intake wizard.
- **Control Tower Workspace (Universal Business Brain):** The default home surface, offering a centralized operational HQ with inline Command Entry, Business Health overview, actionable Daily Priorities, Risk Alerts, Pending Approvals queue, AI Daily Plan, Storefront Intelligence, Growth Operations panel, and a Module Health Grid.
- **Workspaces:**
    - **Revenue, Clients, Calendar, Content, Flows, Profile & Intelligence Workspaces:** Each offers specialized dashboards, metrics, and tools for their respective domains, often featuring AI-driven insights and streamlined workflows.
    - **Projects Workspace:** A delivery execution workspace with Kanban boards, list views, rich project cards, health scores, and a 10-tab project detail view integrating cross-module data connections (Client, Revenue, Calendar, Flows).
    - **Expenses Workspace:** Provides spending intelligence with transactions, budgets, categories, and insights. It includes KPI strips, inline categorization, period-over-period comparisons, margin analysis, vendor distribution, and AI cost-control guidance.
- **Core Business Functions:** Includes Billing & Payment (multi-method payments, subscription billing), User & Security (Multi-Tenant System, personalized authentication, granular per-module permission scopes, Team Activity Log), and a Financial Copilot Agent.
- **Communication & Content:** Features a Customer Notification System, Unified Composer & Distribution UX, Communications Delivery Engine with adapter-based architecture (Meta, Google, WhatsApp), WhatsApp Business Integration, and an Audience Health Dashboard.
- **Commerce & Fulfillment:** Offers a Public Storefront, Store Dashboard, Fulfillment Engine & Order Routing, Commerce Data Layer with new Prisma models for supplier architecture, and Commerce Intelligence & AI with a full commerce copilot layer for pricing, margin analysis, and inventory management.
- **Strategic Intelligence & Forecasting:** Utilizes a StrategicIntelligenceService with 7 AI-powered engines for Revenue Forecasting, Profitability Analysis, Pricing Advice, Seasonal Pattern Detection, Opportunity Scanning, Risk Scanning, and Weekly Planning.
- **Platform Utilities:** Includes Cross-Module Intelligence Agents, Gamification, online store, public booking page, module event bus, keyboard shortcuts, webhook dispatcher, developer settings, Universal Export System, Business Documentation Engine, Navigation & Command System, and System Diagnostics & Health Center.
- **Design System Consistency:** Ensures unified error boundaries, standardized skeleton components, shared empty state and loading components, consistent typography, radius utilities, and card hierarchies.
- **Security:** Implements Error Boundaries for core modules and rate limiting for unauthenticated endpoints.

## External Dependencies
- **Database:** PostgreSQL
- **Authentication:** Supabase Auth
- **AI:** OpenAI
- **Google Services:** Google Calendar, Google Sign-In, Gmail, Google Contacts, Google Drive
- **Payment Gateways:** WiPay, PayPal, Google Pay
- **Rich Text:** TipTap (React)
- **Charts:** Recharts
- **Package Manager:** pnpm