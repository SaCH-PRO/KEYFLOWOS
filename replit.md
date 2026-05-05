# KEYFLOWOS Monorepo

## Overview
KEYFLOWOS is an AI-powered operating system designed to automate operations for service businesses, aiming for 80-90% automation. It provides pre-built Playbooks, a unified "Command" center with an AI-powered command bar, voice input, and integrated business intelligence. The system integrates six core engines: LaunchFlow, OperateAI, GrowthStack, ProfitLens, ScaleHub, and MasterClass Mode, offering a comprehensive solution for business automation, growth, and management. Its business vision is to provide a comprehensive, AI-driven platform for business automation, growth, and management, with a high degree of automation and pre-opinionated workflows.

## User Preferences
- Caribbean localization (TTD currency, Trinidad timezone)
- Refined dark theme with selective glassmorphism (Linear/Stripe/Notion-inspired)
- Event-driven architecture for automation
- Pre-opinionated flows (Playbooks)

## System Architecture
The project is a monorepo utilizing a Next.js 16 frontend (`apps/web`) and a NestJS backend API (`apps/server`), with PostgreSQL managed by Prisma. The codebase is host-agnostic.

**UI/UX Decisions:**
- Redesigned design system with a warm Caribbean color palette (orange `#F97316` primary, teal `#14B8A6` secondary), selective glassmorphism, clean elevation system, and PWA capabilities.
- Compact listing/grid views with hover-revealed details and click-to-full-detail.
- Standardized shared component library and consolidated shell design.
- Simplified "Today" surface with greeting, cash flow forecast, priority queue, and AI briefing.
- Tiered navigation with Primary Rail + Secondary Panel, featuring five master surfaces: Cockpit, KEYFLOW, Workspaces, Studio, and Public.

**Technical Implementations & Features:**
- **AI-Powered Automation:** Implements a Business Autopilot System for archetype inference, revenue model detection, task orchestration, legal/compliance, and a global AI entry point with route-aware context detection. The AI Business Office Foundations layer utilizes an Intent → Plan → Execute → Log pipeline with a 4-tier governance engine and audit trail. An AI Copilot UX Shell provides a Global Copilot Panel (AI Command Center), module-contextual quick actions, and a Pro Auto Monitoring Engine scanning health domains for suggestions.
- **Global AI Command Layer:** The Copilot Panel acts as the sole AI interaction surface across all workspaces, featuring plan-first chat execution, dynamic quick prompts, and unified cross-module queues with context awareness.
- **Business Intelligence Context System:** Gathers comprehensive business context from 16 guidance sub-profiles with a 5-tier weighted completeness system and a Business Builder intake wizard.
- **KEYFLOW (Flagship Operator HQ):** The default home surface, centralizing Command Entry, Business Health overview, Priority Queue, Risk Alerts, Pending Approvals, AI Daily Plan, Storefront Intelligence, Growth Operations, and Module Health Grid. Includes a Unified Calendar, Keyflow Notes drawer, and Jarvis Voice surface with Whisper STT and GPT-4o-mini-TTS streaming.
- **Workspaces:** Dedicated workspaces for Revenue, Clients, Calendar, Content, Autopilot, Profile & Intelligence, Projects, and Expenses.
- **Core Business Functions:** Incorporates Billing & Payment, User & Security (Multi-Tenant System, granular permissions, Team Activity Log), and a Financial Copilot Agent.
- **Connector Framework & Event Normalization:** A unified connector framework providing a standard interface for integrations, including a `ConnectorRegistryService`, canonical event schema, `EntityResolutionService` for deduplicating external contacts, `ConnectorHealthMonitorService`, and a `ConnectorSyncSchedulerService` for nightly syncs.
- **Communication & Content:** Features a Customer Notification System, Unified Composer & Distribution UX, Communications Delivery Engine with adapter-based architecture (Meta, Google, WhatsApp), WhatsApp Business Integration, and an Audience Health Dashboard.
- **Commerce & Fulfillment:** Offers a Public Storefront, Store Dashboard, Fulfillment Engine & Order Routing, Commerce Data Layer, and Commerce Intelligence & AI with a full commerce copilot layer. A Canonical Graph API provides server-side product-service mapping and readiness scoring.
- **Autopilot Governed Delegation Engine:** Provides 5 pre-built delegation loop templates with governance-aware execution, learning loop integration, a 5-minute scheduler, and a dedicated Autopilot dashboard.
- **Guided Store Qualification Engine:** Transforms the public store into a guided qualification and conversion experience with interactive package selectors, execution model tiers, AI quote-from-conversation, asset intake, and a QualificationConfig UI.
- **Community Transactional Presence Network:** Transforms the community module into a business directory where every profile is a mini-storefront with transactional presence fields, network connection models, directory search, and enhanced profile cards.
- **Multi-Model AI Gateway:** An infrastructure layer abstracting AI provider selection behind a unified routing layer. Supports task-based routing, multiple AI modes, automatic fallback, per-provider health tracking, BYOK support, strict typed output contracts, and streaming capabilities via SSE. Includes per-provider cost budget caps and observability.
- **AI-Powered Business Matching:** Provides AI-powered business recommendations in the community directory using a hybrid approach of algorithmic scoring and AI-generated match explanations, persisted in a DB with a refresh scheduler.
- **Community Trust & Reputation Signals:** Adds trust signals and reputation scoring to community profiles, including an Endorsement model, a computed reputation score, and six verified badges.
- **Strategic Intelligence & Forecasting:** Utilizes a `StrategicIntelligenceService` with 7 AI-powered engines for Revenue Forecasting, Profitability Analysis, Pricing Advice, Seasonal Pattern Detection, Opportunity Scanning, Risk Scanning, and Weekly Planning.
- **Second-Wave Connectors & Growth Intelligence:** Adds 10 new connectors to the framework: accounting (Quickbooks, Xero), email marketing (Mailchimp, Klaviyo), expanded social (LinkedIn, TikTok, Twitter), and forms (Typeform, Jotform, Webhook Form). Includes `GrowthIntelligenceModule` for journey tracking, attribution, and insight generation.
- **SEO Operations Engine:** Operational SEO module wired into the Business Graph. Integrates with Google Search Console and GA4 for keyword tracking, ranking history, automated issue detection, and content gap analysis. `SeoContentService` uses AI for content brief generation. `SeoListenerService` reacts to SEO events by creating `AutopilotTask` items. Includes seven SEO tools in the Flow tool registry.
- **Platform Utilities:** Includes Cross-Module Intelligence Agents, Gamification, online store, public booking page, module event bus, keyboard shortcuts, webhook dispatcher, developer settings, Universal Export System, Business Documentation Engine, Navigation & Command System, and System Diagnostics & Health Center.
- **Community Relationship & Transaction Actions:** Business-to-business relationship features including quote requests, referrals, collaboration proposals, direct messaging, and business shortlisting.
- **Community Trust & Reputation Engine:** Adds peer reviews and a computed `BusinessReputation` snapshot including average rating, sub-ratings, total completed transactions, on-time rate, repeat-client rate, referral conversion rate, and a 0–100 reputation score.
- **Community Network Activity & Growth Layer:** Five-system growth layer for the community marketplace: Opportunity Board, Partner Programs, Resource Marketplace, Network Activity Feed, and Network Analytics.
- **Security:** Implements Error Boundaries for core modules and rate limiting for unauthenticated endpoints.
- **Server-Driven Email Verification:** Signup flow with email verification via Resend.
- **Launch & Maintenance Hardening:** Both apps validate environment with Zod at startup. API exposes `GET /healthz` and `GET /readyz`. Web exposes `GET /api/healthz`. Production deploy uses `scripts/start-prod.sh`. `scripts/verify-up.sh` provides one-command smoke tests. `scripts/post-merge.sh` detects Prisma schema drift.
- **Release Version Surfacing:** Health endpoints and boot logs report the real git SHA. Admin **System Health** page warns if Web/API commits diverge.
- **Web App Dead-Code Cleanup:** Eliminated all `@typescript-eslint/no-unused-vars` warnings in `apps/web`.
- **Uptime monitoring:** `scripts/uptime-monitor.sh` provides a dependency-free shell poller for health endpoints.
- **Web App Lint Policy:** `apps/web/eslint.config.mjs` demotes specific React 19 compiler-aware hook rules and `@typescript-eslint/no-explicit-any` to warnings to prevent blocking builds while tracking refactors.
- **Tier-2 Auth Hardening (production-ready):** Enhanced login flows with stable error codes, sliding-window rate limits, and an `AuthAuditLog`. `PasswordPolicyService` enforces strong password requirements and utilizes the HaveIBeenPwned k-anonymity API. An admin **Settings → Security** page allows viewing the `AuthAuditLog`.
- **Calendar Module API (C2):** Provides a unified `CalendarEvent` projection via a REST surface with authentication and module-scope guards. Includes endpoints for fetching, creating, updating, and deleting events, as well as agenda, conflicts, and insights.
- **Per-contact Audit Log + GDPR Export & Forget (M7):** Implements `ContactAuditEntry`, `ContactExportJob`, `ContactForgetRequest` models for comprehensive contact data privacy. Provides auditing of contact events, signed-URL JSON+ZIP export to S3-compatible storage, soft-delete forget requests with a configurable grace window, and a purge scheduler for hard-deletion and audit log scrubbing.

## External Dependencies
- **Database:** PostgreSQL
- **Authentication:** Supabase Auth
- **AI:** OpenAI, Anthropic, xAI
- **Email:** Resend
- **Google Services:** Google Calendar, Google Sign-In, Gmail, Google Contacts, Google Drive, Google Search Console, Google Analytics 4
- **Payment Gateways:** Stripe, WiPay, PayPal, Google Pay
- **Object Storage:** Any S3-compatible service
- **Rich Text:** TipTap (React)
- **Charts:** Recharts
- **Package Manager:** pnpm
- **Web e2e Tests:** Playwright