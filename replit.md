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
- Tiered navigation with Primary Rail + Secondary Panel, featuring five master surfaces: Cockpit, KEYFLOW COMMAND, Workspaces, Studio, and Public.
- Consistent design system elements for error boundaries, loading states, typography, radius utilities, and card hierarchies.

**Technical Implementations & Features:**
- **AI-Powered Automation:** Business Autopilot System for archetype inference, revenue model detection, task orchestration, legal/compliance, and global AI entry point with route-aware context. Utilizes an Intent → Plan → Execute → Log pipeline with 4-tier governance and audit trail. AI Copilot UX Shell provides a Global Copilot Panel and module-contextual quick actions.
- **Global AI Command Layer:** Copilot Panel acts as the sole AI interaction surface with plan-first chat execution, dynamic prompts, and unified cross-module queues.
- **Business Intelligence Context System:** Gathers business context from 16 guidance sub-profiles with a 5-tier weighted completeness system and a Business Builder intake wizard.
- **KEYFLOW COMMAND (Flagship Operator HQ):** Default home surface, centralizing Command Entry, Business Health, Priority Queue, Risk Alerts, Approvals, AI Daily Plan, Storefront Intelligence, Growth Operations, Module Health, Unified Calendar, Keyflow Notes, and Jarvis Voice surface with Whisper STT and GPT-4o-mini-TTS.
- **Workspaces:** Dedicated workspaces for Revenue, Clients, Calendar, Content, Autopilot, Profile & Intelligence, Projects (Kanban, cards, health scores), and Expenses (spending intelligence, budgets, AI cost-control).
- **Core Business Functions:** Billing & Payment (multi-method, subscription), User & Security (Multi-Tenant, personalized auth, granular permissions, Team Activity Log), and a Financial Copilot Agent.
- **Connector Framework & Event Normalization:** Unified connector framework with `ConnectorRegistryService`, canonical event schema, `EntityResolutionService` for deduplication, `ConnectorStatus`, `ConnectorHealthMonitorService`, `ConnectorSyncSchedulerService`, and a Health Dashboard.
- **Communication & Content:** Customer Notification System, Unified Composer & Distribution UX, Communications Delivery Engine with adapters (Meta, Google, WhatsApp), WhatsApp Business Integration, and Audience Health Dashboard.
- **Commerce & Fulfillment:** Public Storefront, Store Dashboard, Fulfillment Engine & Order Routing, Commerce Data Layer, and Commerce Intelligence & AI with a full commerce copilot layer. Canonical Graph API for product-service mapping and readiness scoring.
- **Autopilot Governed Delegation Engine:** 5 pre-built delegation loop templates with governance, learning loop integration, 5-minute scheduler, and dedicated Autopilot dashboard.
- **Guided Store Qualification Engine:** Transforms public store into a guided qualification and conversion experience with interactive package selectors, execution model tiers, AI quote-from-conversation, asset intake, and a QualificationConfig UI.
- **Community Transactional Presence Network:** Community module as a business directory with mini-storefront profiles, transactional fields, network connection models, directory search, and enhanced profile cards.
- **Multi-Model AI Gateway:** Infrastructure layer abstracting AI provider selection (OpenAI, Anthropic, xAI) behind a unified routing layer. Supports task-based routing, multiple AI modes, automatic fallback, health tracking, BYOK, strict typed output contracts, and streaming. Includes cost budget caps and observability.
- **AI-Powered Business Matching:** AI-powered business recommendations in the community directory using algorithmic scoring and AI-generated match explanations.
- **Community Trust & Reputation Signals:** Trust signals and reputation scoring for community profiles, including Endorsement model, computed reputation score, and verified badges.
- **Strategic Intelligence & Forecasting:** `StrategicIntelligenceService` with 7 AI-powered engines for Revenue Forecasting, Profitability Analysis, Pricing Advice, Seasonal Pattern Detection, Opportunity Scanning, Risk Scanning, and Weekly Planning.
- **Second-Wave Connectors & Growth Intelligence:** Adds 10 new connectors (accounting, email marketing, expanded social, forms) and 4 new Prisma models (`CustomerJourney`, `JourneyTouchpoint`, `AttributionResult`, `GrowthInsight`). Includes `GrowthIntelligenceModule` for journey tracking, attribution, and heuristic insight generation. Per-business credentials are stored encrypted in `ConnectorStatus.metadata.encryptedCredentials` via `ConnectorCredentialsService` (AES-GCM). Owners connect each connector through a unified Connect dialog on `/app/connect`: API-key connectors (QuickBooks, Xero, Mailchimp, Klaviyo, Typeform, Jotform) show a credential form; OAuth connectors (LinkedIn, TikTok, Twitter) redirect through the social OAuth start endpoint; `webhook_form` exposes a per-business webhook URL + auto-generated secret. Form ingest goes through `POST /webhooks/forms/:businessId/:type` with HMAC signature validation.
- **SEO Operations Engine:** Operational SEO module wired into the Business Graph with Prisma models for `SeoPage`, `SeoKeyword`, `RankingSnapshot`, `SeoIssue`, `ContentBrief`. `SeoService` covers page inventory sync, keyword tracking, ranking history, automated issue detection, content gap analysis, and revenue attribution. Integrates with Google Search Console and GA4.
- **Platform Utilities:** Cross-Module Intelligence Agents, Gamification, online store, public booking page, module event bus, keyboard shortcuts, webhook dispatcher, developer settings, Universal Export System, Business Documentation Engine, Navigation & Command System, and System Diagnostics & Health Center.
- **Community Relationship & Transaction Actions:** Business-to-business features including quote requests, referrals, collaboration proposals, direct messaging, and business shortlisting.
- **Community Visible AI Matchmaking:** `CommunityService` notifies matched providers for posts (`QUESTION`/`OPPORTUNITY`/`HELP`/`NEED`).
- **Community Trust & Reputation Engine:** Peer reviews (`CommunityReview`) and computed `BusinessReputation` snapshot including average rating, sub-ratings, transaction metrics, and reputation score.
- **Community Network Activity & Growth Layer:** Five-system growth layer: Opportunity Board, Partner Programs, Resource Marketplace, Network Activity Feed, and Network Analytics.
- **Security:** Error Boundaries for core modules and rate limiting for unauthenticated endpoints.
- **Server-Driven Email Verification (Resend):** Email verification during signup with confirmation links sent via Resend, including resend functionality and "Email not confirmed" handling on login.
- **Launch & Maintenance Hardening:** Environment validation with Zod at startup. API exposes `GET /healthz` and `GET /readyz`. Web exposes `GET /api/healthz`. Production deploy uses `scripts/start-prod.sh`. `scripts/verify-up.sh` for smoke tests. `scripts/post-merge.sh` for Prisma migration drift detection.
- **Release Version Surfacing:** Health endpoints and boot logs report the real git SHA.
- **Web App Lint Policy:** Configures ESLint to demote certain React 19 compiler-aware hook rules and `@typescript-eslint/no-explicit-any` to warnings for specific legacy code areas, while maintaining strictness for new code.
- **Dev Auth Bypass (development only, opt-in):** Local development authentication bypass as a fixed seeded `keyflowdev` `SUPER_ADMIN` profile.

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
- **Email:** Resend