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
- **AI-Powered Automation:** Implements a Business Autopilot System for archetype inference, revenue model detection, task orchestration, legal/compliance, and a global AI entry point with route-aware context detection. The AI Business Office Foundations layer utilizes an Intent → Plan → Execute → Log pipeline with a 4-tier governance engine and a comprehensive audit trail. An AI Copilot UX Shell provides a Global Copilot Panel (AI Command Center), module-contextual quick actions, and a Pro Auto Monitoring Engine that scans 10 health domains for actionable suggestions.
- **Global AI Command Layer:** The Copilot Panel acts as the sole AI interaction surface across all workspaces, featuring plan-first chat execution, dynamic quick prompts, and unified cross-module queues. Context awareness is achieved via CustomEvents.
- **Business Intelligence Context System:** Gathers comprehensive business context from 16 guidance sub-profiles with a 5-tier weighted completeness system and a Business Builder intake wizard.
- **Control Tower Workspace:** The default home surface, offering a centralized operational HQ with inline Command Entry, Business Health overview, actionable Daily Priorities, Risk Alerts, Pending Approvals queue, AI Daily Plan, Storefront Intelligence, Growth Operations panel, and a Module Health Grid.
- **Workspaces:** Includes specialized workspaces for Revenue, Clients, Calendar, Content, Autopilot, Profile & Intelligence, Projects (Kanban, list views, health scores, cross-module data), and Expenses (spending intelligence, budgets, AI cost control).
- **Core Business Functions:** Incorporates Billing & Payment (multi-method, subscription), User & Security (Multi-Tenant, granular permissions, team activity log), and a Financial Copilot Agent.
- **Connector Framework & Event Normalization:** A unified connector framework (`apps/server/src/core/connectors/`) providing a standard interface (`IConnector`) for integrations, a ConnectorRegistryService, a canonical event schema, and an EntityResolutionService for deduplication.
- **Communication & Content:** Features a Customer Notification System, Unified Composer & Distribution UX, Communications Delivery Engine with adapter-based architecture, WhatsApp Business Integration, and an Audience Health Dashboard.
- **Commerce & Fulfillment:** Offers a Public Storefront, Store Dashboard, Fulfillment Engine & Order Routing, Commerce Data Layer with new Prisma models for supplier architecture, and Commerce Intelligence & AI with a full commerce copilot layer. A Canonical Graph API (`StoreReadinessService`) provides server-side product-service mapping, drift detection, and readiness scoring.
- **Autopilot Governed Delegation Engine:** Provides 5 pre-built delegation loop templates with governance-aware execution, learning loop integration, and a 5-minute scheduler.
- **Guided Store Qualification Engine:** Transforms the public store into a guided qualification and conversion experience with interactive package selectors, execution model tiers, AI quoting, asset intake flows, and a QualificationConfig UI.
- **Community Transactional Presence Network:** Transforms the community module into a business directory where every profile is a mini-storefront, featuring transactional presence fields, network connections, multi-filter search, and enhanced profile cards.
- **Multi-Model AI Gateway:** An infrastructure layer abstracting AI provider selection (OpenAI, Anthropic, xAI) behind a unified routing layer. Supports task-based routing, multiple AI modes, automatic fallback, BYOK encryption, strict typed output contracts, and streaming capabilities.
- **AI-Powered Business Matching:** Provides AI-powered business recommendations in the community directory using a hybrid approach of algorithmic scoring and AI-generated match explanations, with results persisted for fast access.
- **Community Trust & Reputation Signals:** Adds trust signals and reputation scoring to community profiles, including an Endorsement model, a computed reputation score, and six verified badges.
- **Community Phase 2: Direct Messaging & Collaboration Requests:** Enables B2B communication through the community with Conversation/DirectMessage models, CollaborationRequest model, and CommunityNotification model.
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