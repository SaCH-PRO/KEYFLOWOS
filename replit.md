# KEYFLOWOS Monorepo

## Overview
KEYFLOWOS is an AI-powered operating system designed to automate operations for service businesses, aiming for 80-90% automation. It provides pre-built Playbooks and a unified "Command" center with an AI-powered command bar, voice input, and integrated business intelligence. The system integrates six core engines: LaunchFlow, OperateAI, GrowthStack, ProfitLens, ScaleHub, and MasterClass Mode, offering a comprehensive solution for business automation, growth, and management.

## User Preferences
- Caribbean localization (TTD currency, Trinidad timezone)
- Glassmorphism UI with dark theme
- Event-driven architecture for automation
- Pre-opinionated flows (Playbooks)

## System Architecture
The project is a monorepo utilizing a Next.js 16 frontend (`apps/web`) and a NestJS backend API (`apps/server`), with PostgreSQL managed by Prisma.

**UI/UX Decisions:**
- Custom design system with a warm Caribbean-inspired color palette, Glassmorphism elements, and a dark theme.
- PWA capabilities, mobile-optimized navigation, and a redesigned, icon-first, collapsible sidebar.
- Premium design token system with elevation shadows, glass surfaces, micro-transitions, and context-aware notifications.
- Custom Glassmorphism ConfirmDialog for all confirmations and skeleton loading states.
- Unified CRM Design Language across Pipeline, Database, Insights, and Engage tabs, featuring standardized cards, glass search inputs, popover dropdowns, and gradient accents.
- Pipeline Kanban Board View with HTML5 drag-and-drop for status updates, persistent view preferences, and detailed contact cards.
- Enhanced database tables with column visibility, responsive auto-hiding, multi-word search, keyboard navigation, and localStorage-persisted "Saved Views".
- Contact cards with lead score badges, revenue indicators, and status-colored borders.
- Extensive use of `useMemo` and `useCallback` for performance optimization.
- Graceful error handling with Next.js error boundaries and comprehensive ARIA accessibility.

**Technical Implementations & Features:**
- **Business Autopilot System:** AI-powered operations with onboarding, archetype inference, revenue model detection, task orchestration, and a Legal & Compliance Module.
- **Command Center:** Unified page with AI command bar, voice input, AI chat, dashboard metrics, daily briefing, cash flow forecast, and prioritized tasks.
- **Online Store & Public Booking Page:** Modular storefront and a 4-step public booking flow.
**Notification System:** Real-time notifications for key business events.
- **Gamification System:** Global tiered missions system with XP rewards.
- **Personalized Auth & Onboarding:** Redesigned Glassmorphism sign-up/sign-in, Google OAuth, and an onboarding wizard.
- **Quote-to-Invoice Workflow:** Comprehensive quote management with tax and discount systems.
- **Multi-Gateway Payment System:** Integration with WiPay (Caribbean) and PayPal (international).
- **Subscription & Billing System:** 3-tier plans with free trial and module limits.
- **Multi-Tenant System:** Data isolation using `businessId` with `BusinessGuard` protection.
- **Commerce Module Overhaul (v3):** Re-architected with `useCommerce()` hook (mirrors CRM pattern), thin page.tsx orchestration shell (~200 lines), shared `TabNav`, extracted `ProductFormModal`, `ConnectionStatus`, and `CommerceGuide` (15 steps across 4 collapsible sections with localStorage persistence). KPI dashboard with `formatTTD()`, glassmorphism product cards, and recurring invoices.
- **Unified Contact Capture:** Single modal with multiple capture modes: Manual, Scan (AI Vision OCR), File Upload, Google Sync, URL Import.
- **Contacts Module (Pluggable):** Modular CRM with reusable components, Contact Lists/Groups, Duplicate Detection, Pipeline, Database, Insights, Engage tabs, CRM Momentum gamification, and AI copilot. Features bulk edit, inline note/task editing, import field mapping, and virtual scrolling.
- **Settings Feature:** Modular business settings including branding, social links, and a connections hub.
- **Contextual Connection System:** Reusable `ConnectionBanner` and `useConnections` hook for relevant connection prompts.
- **Expense Tracking (v2):** Comprehensive expense management with categories, vendors, budgets, alerts, and recurring expense support.
- **AI Co-Founder (KeyFlow AI):** OpenAI-powered business advisor integrated into the Command page.
- **Email Marketing:** Campaign management with segmentation and delivery tracking.
- **Lead Capture Forms:** Form builder with custom fields and auto-CRM contact creation.
- **Business Templates:** 10 industry-specific presets.
- **MasterClass (Education):** Micro-course catalog with progress tracking.
- **Community Hub:** Peer discussion forum and cohort-based founder circles.
- **Projects & Playbooks (Merged):** Unified page with Kanban board for tasks and event-driven automations.
- **Global Commerce / Marketplace:** International selling pipeline with multi-currency and customs clearance support.
- **AI Usage Billing:** Centralized AI metering with token/cost logging and a tiered credit system.
- **Server-Side Pagination:** Standardized pagination for commerce and marketplace list endpoints.
- **Global HTTP Exception Filter:** Consistent error response format for backend errors.
- **Pluggable Notes System:** Contact notes with categories, composer, actions, search, filters, pinned notes, and quick templates.
- **Pluggable Tasks System:** Contact tasks with priority levels, composer, due date/reminder inputs, quick templates, search/filter/sort options, and per-task actions.
- **CRM Insights Tab:** Production-grade `insights-tab.tsx` using 12-column Bento Grid layout with Framer Motion animations and **Recharts** for interactive data visualization (HeroStats, Pipeline Funnel, Revenue Forecast, Contact Growth, Data Quality, Lead Scores, Health Stats, Revenue by Client, Engagement Heatmap, Conversion Timeline, Tag Performance, Sources/Channels). Includes a date range picker and export functionality.
- **CRM AI Command Center:** AI Analyst section within the Insights tab for querying contacts/pipeline, with pre-built quick prompts, structured AI responses, suggested actions, and auto-generated tasks.
- **CRM Engage Tab:** Production-grade `engage-tab.tsx` with Bento-inspired layout, Framer Motion animations, and **Multi-Step Engagement Sequences**. Features a **Journey-Aware Action Engine** (`crm-flow.service.ts`) for contextual actions, including manual next actions and autopilot actions requiring approval. Includes a comprehensive Sequences System with full CRUD, enrollment, a visual builder, pre-built templates, sequence editing, duplication/cloning, ConfirmDialog for destructive actions, debounced contact search, enrollment status filters (All/Active/Done/Left), and ContactEvent audit logging (sequence_enrolled, sequence_step_advanced, sequence_unenrolled). **Sequences → Autopilot Integration:** Due sequence steps (email/whatsapp) automatically surface as `needs_approval` Autopilot actions; due call steps appear as high-priority NextActions. **Autopilot AI System:** `AutopilotAiService` generates personalized AI message drafts (Caribbean-friendly tone, TTD awareness) using `gpt-4o-mini` via `AiUsageService.callAi()`. Upgraded `ApprovalCard` with expandable AI draft preview, "Open WhatsApp" / "Open Email" execution buttons, clipboard copy, and "Mark Done" flow. `AutopilotSettingsPanel` slide-over with master toggle, per-trigger toggles (follow_up, birthday, payment_reminder, check_in, offer), auto-approve selector, and quiet hours. Settings stored in `Business.metaData.autopilot`.
- **Contact Form Enhancements:** Social links, referredBy field, nextScheduledInteraction date picker, and Custom Fields (JSON column).
- **Contact Detail Enrichment:** Data completeness percentage, lifecycle stage badge, days-since-last-interaction, and Related Contacts.
- **CRM AI Command Executor:** Natural language command system in the AI search bar (`ai-search-bar.tsx`) that interprets user commands and executes CRM actions. Backend `interpretCommand()` in `CrmAiService` parses commands into structured action intents. Supports 20+ action types: add/edit/delete/view contacts, change status, add notes/tasks, log communications, switch tabs, filter pipeline, open broadcast, import contacts, show favorites, toggle favorite, bulk tag, and trigger AI features (summary, lead score, prep brief, tag suggestions). The AI search bar now serves as a dual-purpose interface: natural language search AND command execution with confidence-scored action confirmation before execution. Credit cost: `crm_command: 1`. Endpoint: `POST /businesses/:businessId/ai-command`.
- **CRM AI Intelligence Suite:** Five AI-powered features integrated into the Contacts/CRM module via `CrmAiService` + `AiUsageService.callAi()`: (1) **AI Contact Summarizer** (`ai-contact-summary.tsx`) — on-demand briefing with sentiment, relationship health, key insights, and recommended action; (2) **Smart Lead Scoring** (`ai-lead-score.tsx`) — AI-analyzed score 0-100 with factor breakdown, reasoning, and score persistence; (3) **AI Note Intelligence** (`ai-note-intelligence.tsx`) — per-note sentiment detection, action item extraction with one-click task creation, suggested tags, risk flags, and entity extraction; (4) **Predictive Churn Detection** (`ai-churn-detection.tsx`) — business-wide churn risk analysis with probability scores, reasons, recommended actions, and estimated revenue loss; (5) **Natural Language CRM Search** (`ai-search-bar.tsx`) — plain English queries translated to structured CRM filters via AI, with inline contact results, example prompts, and "Apply filters" integration. AI credit costs: `contact_summary: 1`, `ai_lead_score: 1`, `note_intelligence: 1`, `churn_detection: 2`, `nl_search: 1`. Endpoints: `POST /contacts/:id/ai-summary`, `POST /contacts/:id/ai-score`, `POST /contacts/:id/ai-note-analysis`, `GET /ai-churn-risk`, `POST /ai-search`.
- **Core Modules:** Identity, CRM, Commerce, Marketplace, Bookings, Social, Projects & Playbooks, Flow, Reports, Command, Expenses, Webhooks, AI, Email Marketing, Lead Forms, Templates, Education, Community.

## External Dependencies
- **Database:** PostgreSQL
- **Authentication:** Supabase Auth
- **AI:** OpenAI via Replit AI Integrations
- **Google Services:** Google Calendar Integration, Google Sign-In, Gmail Integration, Google Contacts OAuth Sync
- **Payment Gateways:** WiPay, PayPal
- **Charts:** Recharts
- **Package Manager:** pnpm
- **Storage:** App Storage