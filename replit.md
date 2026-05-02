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
- Compact listing/grid views with hover-revealed additional info and click-to-detail.
- Standardized shared component library and consolidated shell design.
- Simplified "Today" surface with greeting, cash flow forecast, priority queue, and AI briefing.
- Tiered navigation with Primary Rail + Secondary Panel, featuring five master surfaces: Cockpit, KEYFLOW COMMAND, Workspaces, Studio, and Public.
- Consistent design system elements: error boundaries, skeleton/empty/loading states, typography, radius utilities, and card hierarchies.

**Technical Implementations & Features:**
- **AI-Powered Automation:** Business Autopilot System for archetype inference, revenue model detection, task orchestration, legal/compliance, and a global AI entry point with route-aware context. The AI Business Office Foundations layer uses an Intent → Plan → Execute → Log pipeline with a 4-tier governance engine and audit trail. An AI Copilot UX Shell provides a Global Copilot Panel (AI Command Center), module-contextual quick actions, and a Pro Auto Monitoring Engine.
- **Global AI Command Layer:** The Copilot Panel serves as the sole AI interaction surface with plan-first chat execution, dynamic prompts, and unified cross-module queues.
- **Business Intelligence Context System:** Gathers business context from 16 guidance sub-profiles with a 5-tier weighted completeness system and a Business Builder intake wizard.
- **KEYFLOW COMMAND (Flagship Operator HQ):** The default home surface, centralizing Command Entry, Business Health, Priority Queue, Risk Alerts, Pending Approvals, AI Daily Plan, Storefront Intelligence, Growth Operations, Module Health Grid, Unified Calendar, Keyflow Notes drawer, and Jarvis Voice surface with Whisper STT and GPT-4o-mini-TTS.
- **Workspaces:** Dedicated workspaces for Revenue, Clients, Calendar, Content, Autopilot, Profile & Intelligence, Projects (Kanban, cards, health scores), and Expenses (spending intelligence, budgets, categories, AI cost-control).
- **Core Business Functions:** Billing & Payment (multi-method, subscription), User & Security (Multi-Tenant, authentication, granular permissions, Team Activity Log), and a Financial Copilot Agent.
- **Connector Framework & Event Normalization:** Unified connector framework with `ConnectorRegistryService`, canonical event schema, `EntityResolutionService`, `ConnectorStatus` table, `ConnectorHealthMonitorService`, and Health Dashboard.
- **Communication & Content:** Customer Notification System, Unified Composer & Distribution UX, Communications Delivery Engine with adapter-based architecture (Meta, Google, WhatsApp), WhatsApp Business Integration, and an Audience Health Dashboard.
- **Commerce & Fulfillment:** Public Storefront, Store Dashboard, Fulfillment Engine & Order Routing, Commerce Data Layer, and Commerce Intelligence & AI with a full commerce copilot layer. A Canonical Graph API provides server-side product-service mapping and readiness scoring.
- **Autopilot Governed Delegation Engine:** 5 pre-built delegation loop templates with governance-aware execution, learning loop integration, a 5-minute scheduler, and a dedicated Autopilot dashboard.
- **Guided Store Qualification Engine:** Transforms the public store into a guided qualification and conversion experience with interactive package selectors, execution model tiers, AI quote-from-conversation, asset intake, and a QualificationConfig UI.
- **Community Transactional Presence Network:** Transforms the community module into a business directory where every profile is a mini-storefront with transactional presence, network connection models, directory search, and enhanced profile cards.
- **Multi-Model AI Gateway:** Infrastructure layer abstracting AI provider selection (OpenAI, Anthropic, xAI) behind a unified routing layer. Supports task-based routing, multiple AI modes, automatic fallback, per-provider health tracking, BYOK, strict typed output contracts, and streaming via SSE. Includes cost budget caps and observability.
- **AI-Powered Business Matching:** Provides AI-powered business recommendations in the community directory using algorithmic scoring and AI-generated match explanations.
- **Community Trust & Reputation Signals:** Adds trust signals and reputation scoring to community profiles, including an Endorsement model, computed reputation score, and verified badges.
- **Strategic Intelligence & Forecasting:** `StrategicIntelligenceService` with 7 AI-powered engines for Revenue Forecasting, Profitability Analysis, Pricing Advice, Seasonal Pattern Detection, Opportunity Scanning, Risk Scanning, and Weekly Planning.
- **Second-Wave Connectors & Growth Intelligence:** Adds accounting (Quickbooks, Xero), email marketing (Mailchimp, Klaviyo), expanded social (LinkedIn, TikTok, Twitter), and forms (Typeform, Jotform, Webhook). Introduces `CustomerJourney`, `JourneyTouchpoint`, `AttributionResult`, and `GrowthInsight` Prisma models. Includes `GrowthIntelligenceModule` for journey tracking, attribution, and insight generation.
- **SEO Operations Engine:** Operational SEO module wired into the Business Graph. Prisma models: `SeoPage`, `SeoKeyword`, `RankingSnapshot`, `SeoIssue`, `ContentBrief`. `SeoService` covers page inventory sync, keyword tracking, ranking history, automated issue detection, content gap analysis, and revenue attribution. Integrates with Google Search Console and GA4. `SeoContentService` uses AI for content brief generation. `SeoListenerService` reacts to SEO events by creating `AutopilotTask` items.
- **Platform Utilities:** Cross-Module Intelligence Agents, Gamification, online store, public booking page, module event bus, keyboard shortcuts, webhook dispatcher, developer settings, Universal Export System, Business Documentation Engine, Navigation & Command System, and System Diagnostics & Health Center.
- **Community Relationship & Transaction Actions:** Business-to-business relationship features including quote requests, referrals, collaboration proposals, direct messaging, and business shortlisting.
- **Community Visible AI Matchmaking:** `CommunityService` finds and notifies matched providers for posts.
- **Community Trust & Reputation Engine:** Peer reviews (`CommunityReview`) and computed `BusinessReputation` snapshot including average rating, sub-ratings, transaction metrics, and a reputation score.
- **Community Network Activity & Growth Layer:** Opportunity Board, Partner Programs, Resource Marketplace, Network Activity Feed, and Network Analytics.
- **Security:** Error Boundaries for core modules and rate limiting for unauthenticated endpoints.
- **Server-Driven Email Verification (Resend):** Signup flow with email verification via Resend. Login auto-detects unconfirmed emails and offers resend options.
- **Launch & Maintenance Hardening:** Environment validation with Zod at startup. API exposes `GET /healthz` and `GET /readyz`. Web exposes `GET /api/healthz`. Production deploy uses `scripts/start-prod.sh`. `scripts/verify-up.sh` for smoke tests. `scripts/post-merge.sh` checks for Prisma schema drift.
- **Dev Auth Bypass:** Development-only feature to auto-authenticate as a seeded `keyflowdev` `SUPER_ADMIN` profile.

## External Dependencies
- **Database:** PostgreSQL (e.g., Supabase, RDS, Neon)
- **Authentication:** Supabase Auth
- **AI:** OpenAI, Anthropic, xAI
- **Email:** Resend
- **Google Services:** Google Calendar, Google Sign-In, Gmail, Google Contacts, Google Drive, Google Search Console, Google Analytics 4
- **Payment Gateways:** Stripe, WiPay, PayPal, Google Pay
- **Object Storage:** Any S3-compatible service (e.g., AWS S3, Cloudflare R2, MinIO)
- **Rich Text:** TipTap (React)
- **Charts:** Recharts
- **Package Manager:** pnpm
- **Web e2e Tests:** Playwright