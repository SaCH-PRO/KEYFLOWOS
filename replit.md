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
- **AI-Powered Automation:** Implements a Business Autopilot System with an Intent → Plan → Execute → Log pipeline, a 4-tier governance engine, and a Global AI Command Layer for unified interaction. Includes an AI Copilot UX Shell for contextual quick actions and monitoring.
- **Business Intelligence Context System:** Gathers comprehensive business context from 16 guidance sub-profiles with a 5-tier weighted completeness system.
- **KEYFLOW COMMAND (Flagship Operator HQ):** The default home surface, centralizing Command Entry, Business Health, Priority Queue, AI Daily Plan, and module health. Includes a Unified Calendar, Keyflow Notes, and Jarvis Voice surface.
- **Workspaces:** Dedicated workspaces for Revenue, Clients, Calendar, Content, Autopilot, Profile & Intelligence, Projects (Kanban boards, health scores), and Expenses (spending intelligence, AI cost-control guidance).
- **Core Business Functions:** Incorporates Billing & Payment (multi-method payments, subscription billing), User & Security (Multi-Tenant System, personalized authentication, granular permissions, Team Activity Log), and a Financial Copilot Agent.
- **Connector Framework & Event Normalization:** A unified connector framework for integrations with a canonical event schema, entity resolution, health monitoring, and scheduled synchronization.
- **Communication & Content:** Features a Customer Notification System, Unified Composer & Distribution UX, Communications Delivery Engine with adapter-based architecture (Meta, Google, WhatsApp), and WhatsApp Business Integration.
- **Commerce & Fulfillment:** Offers a Public Storefront, Store Dashboard, Fulfillment Engine & Order Routing, Commerce Data Layer, and Commerce Intelligence & AI with a full commerce copilot layer. A Canonical Graph API provides product-service mapping.
- **Autopilot Governed Delegation Engine:** Provides 5 pre-built delegation loop templates with governance-aware execution and learning loop integration.
- **Guided Store Qualification Engine:** Transforms the public store into a guided qualification and conversion experience with interactive package selectors, execution model tiers, and AI quote generation.
- **Community Transactional Presence Network:** Transforms the community module into a business directory with mini-storefronts, transactional presence, network connection models, and directory search.
- **Multi-Model AI Gateway:** An infrastructure layer abstracting AI provider selection (OpenAI, Anthropic, xAI) behind a unified routing layer, supporting task-based routing, multiple AI modes, automatic fallback, and streaming capabilities.
- **AI-Powered Business Matching:** Provides AI-powered business recommendations in the community directory using a hybrid approach of algorithmic scoring and AI-generated match explanations.
- **Community Trust & Reputation Signals:** Adds trust signals and reputation scoring to community profiles, including an Endorsement model, a computed reputation score, and verified badges.
- **Strategic Intelligence & Forecasting:** Utilizes 7 AI-powered engines for Revenue Forecasting, Profitability Analysis, Pricing Advice, Seasonal Pattern Detection, Opportunity Scanning, Risk Scanning, and Weekly Planning.
- **Second-Wave Connectors & Growth Intelligence:** Adds 10 new connectors (accounting, email marketing, expanded social, forms) and introduces a Growth Intelligence Module for journey tracking, attribution, and insight generation.
- **SEO Operations Engine:** Operational SEO module wired into the Business Graph, providing page inventory sync, keyword tracking, ranking history, automated issue detection, content gap analysis, and revenue attribution. Integrates with Google Search Console and GA4.
- **Platform Utilities:** Includes Cross-Module Intelligence Agents, Gamification, online store, public booking page, module event bus, keyboard shortcuts, webhook dispatcher, developer settings, Universal Export System, Business Documentation Engine, Navigation & Command System, and System Diagnostics & Health Center.
- **Community Relationship & Transaction Actions:** Business-to-business relationship features including quote requests, referrals, collaboration proposals, direct messaging, and business shortlisting with notifications.
- **Community Visible AI Matchmaking:** Finds and notifies top candidate providers for community posts (`QUESTION`/`OPPORTUNITY`/`HELP`/`NEED`).
- **Community Trust & Reputation Engine:** Adds peer reviews (`CommunityReview`) and a computed `BusinessReputation` snapshot including average rating, completed transactions, on-time rate, and reputation score.
- **Community Network Activity & Growth Layer:** Five-system growth layer for the community marketplace: Opportunity Board, Partner Programs, Resource Marketplace, Network Activity Feed, and Network Analytics.
- **Security:** Implements Error Boundaries for core modules and rate limiting for unauthenticated endpoints.
- **Server-Driven Email Verification (Resend):** Signup flow with email verification via Resend.
- **Launch & Maintenance Hardening:** Both apps validate environment with Zod, expose health endpoints (`/healthz`, `/readyz`, `/api/healthz`), and include scripts for production deployment and smoke tests.
- **Release Version Surfacing:** Health endpoints and boot logs report the real git SHA.
- **Web App Lint Policy:** Configures ESLint to demote certain React 19 compiler-aware hook rules and `@typescript-eslint/no-explicit-any` to warnings for specific legacy code areas, while maintaining strictness for new code.
- **Dev Auth Bypass:** Opt-in development-only feature for auto-authentication as a seeded `SUPER_ADMIN` profile.

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