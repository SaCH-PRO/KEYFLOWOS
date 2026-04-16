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
- **AI-Powered Automation:** Implements a Business Autopilot System for archetype inference, revenue model detection, task orchestration, legal/compliance, and a global AI entry point with route-aware context detection. The AI Business Office Foundations layer utilizes an Intent → Plan → Execute → Log pipeline with a 4-tier governance engine. An AI Copilot UX Shell provides a Global Copilot Panel (AI Command Center), module-contextual quick actions, and a Pro Auto Monitoring Engine that scans health domains for actionable suggestions.
- **Global AI Command Layer:** The Copilot Panel acts as the sole AI interaction surface, offering plan-first chat execution with structured steps, dynamic quick prompts, and unified cross-module queues for approvals and actions. Context awareness is maintained via custom events.
- **Business Intelligence Context System:** Gathers comprehensive business context from 16 guidance sub-profiles with a 5-tier weighted completeness system.
- **Control Tower Workspace:** The default home surface, offering a centralized operational HQ with inline Command Entry, Business Health overview, actionable Daily Priorities, Risk Alerts, Pending Approvals, AI Daily Plan, Storefront Intelligence, Growth Operations, and a Module Health Grid.
- **Workspaces:** Includes Revenue, Clients, Calendar, Content, Autopilot (formerly Flows), Profile & Intelligence, Projects (with Kanban, health scores, cross-module data integration), and Expenses (with spending intelligence, KPI strips, AI cost-control guidance).
- **Core Business Functions:** Incorporates Billing & Payment (multi-method, subscription), User & Security (Multi-Tenant System, granular permissions, Team Activity Log), and a Financial Copilot Agent.
- **Communication & Content:** Features a Customer Notification System, Unified Composer & Distribution UX, Communications Delivery Engine with adapter-based architecture (Meta, Google, WhatsApp), and an Audience Health Dashboard.
- **Commerce & Fulfillment:** Offers a Public Storefront, Store Dashboard, Fulfillment Engine & Order Routing, Commerce Data Layer, and Commerce Intelligence & AI for pricing, margin analysis, and inventory management. A Canonical Graph API (`StoreReadinessService`) provides server-side product-service mapping, drift detection, and readiness scoring.
- **Autopilot Governed Delegation Engine:** Provides 5 pre-built delegation loop templates (e.g., Payment Recovery, Lead Reactivation) with governance-aware execution, learning loop integration, and a dedicated Autopilot dashboard.
- **Guided Store Qualification Engine:** Transforms the public store into a guided qualification and conversion experience with an interactive package selector, execution model tiers, AI quote-from-conversation endpoint, asset intake flow, and a QualificationConfig UI with flow builder.
- **Community Transactional Presence Network:** Transforms the community module into a business directory where every profile is a mini-storefront, featuring transactional presence fields, network connections, multi-filter search, enhanced profile cards, and profile completeness incentives.
- **Multi-Model AI Gateway:** An infrastructure layer that abstracts AI provider selection (OpenAI, Anthropic, xAI) behind a unified routing layer. Supports task-based routing across 7 categories, 3 AI modes (Balanced/Premium/Fast) with model selection per task, automatic fallback chains, BYOK support, strict typed output contracts, and streaming capabilities. Includes per-provider cost budget caps and comprehensive observability.
- **AI-Powered Business Matching:** Provides AI-powered business recommendations in the community directory using a hybrid approach of algorithmic scoring and AI-generated match explanations. Results are cached.
- **Community Trust & Reputation Signals:** Adds trust signals and reputation scoring to community profiles, including an Endorsement model, a computed reputation score, and six verified badges.
- **Strategic Intelligence & Forecasting:** Utilizes a StrategicIntelligenceService with 7 AI-powered engines for Revenue Forecasting, Profitability Analysis, Pricing Advice, Seasonal Pattern Detection, Opportunity Scanning, Risk Scanning, and Weekly Planning.
- **Platform Utilities:** Includes Cross-Module Intelligence Agents, Gamification, online store, public booking page, module event bus, keyboard shortcuts, webhook dispatcher, developer settings, Universal Export System, Business Documentation Engine, Navigation & Command System, and System Diagnostics & Health Center.
- **Design System Consistency:** Ensures unified error boundaries, standardized skeleton components, shared empty state and loading components, consistent typography, radius utilities, and card hierarchies.
- **Security:** Implements Error Boundaries for core modules and rate limiting for unauthenticated endpoints.

## External Dependencies
- **Database:** PostgreSQL
- **Authentication:** Supabase Auth
- **AI:** Multi-Model Gateway (OpenAI, Anthropic, xAI)
- **Google Services:** Google Calendar, Google Sign-In, Gmail, Google Contacts, Google Drive
- **Payment Gateways:** WiPay, PayPal, Google Pay
- **Rich Text:** TipTap (React)
- **Charts:** Recharts
- **Package Manager:** pnpm