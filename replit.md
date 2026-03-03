# KEYFLOWOS Monorepo

## Overview
KEYFLOWOS is an AI-powered operating system designed to automate operations for service businesses, aiming for 80-90% automation. It provides pre-built Playbooks and a unified "Command" center with an AI-powered command bar, voice input, and integrated business intelligence. The system integrates six core engines: LaunchFlow, OperateAI, GrowthStack, ProfitLens, ScaleHub, and MasterClass Mode, offering a comprehensive solution for business automation, growth, and management.

## User Preferences
- Caribbean localization (TTD currency, Trinidad timezone)
- Glassmorphism UI with dark theme
- Event-driven architecture for automation
- Pre-opinionated flows (Playbooks)

## System Architecture
The project is a monorepo utilizing a Next.js 16 frontend (`apps/web`) and a NestJS backend API (`apps/server`), with PostgreSQL managed by Prisma. Backend uses SWC for transpilation, requiring explicit `@Inject(Token)` decorators for NestJS constructor injection.

**UI/UX Decisions:**
- Custom design system with a warm Caribbean-inspired color palette, Glassmorphism elements, and a dark theme.
- PWA capabilities, mobile-optimized navigation, and a redesigned, icon-first, collapsible sidebar.
- Premium design token system with elevation shadows, glass surfaces, micro-transitions, and context-aware notifications.
- Custom Glassmorphism ConfirmDialog for confirmations and skeleton loading states.
- Unified CRM Design Language across Pipeline, Database, Insights, and Engage tabs, featuring standardized cards, glass search inputs, popover dropdowns, and gradient accents.
- `TabNav` component with folder-tab styling, keyboard navigation, and `useSwipeTabs` hook for touch swipe. Directional slide animations on both CRM and Commerce pages.
- Pipeline Kanban Board View with HTML5 drag-and-drop, persistent view preferences, and detailed contact cards.
- Enhanced database tables with column visibility, responsive auto-hiding, multi-word search, keyboard navigation, and localStorage-persisted "Saved Views".
- **Product Detail Panel:** Centered dialog (not bottom-sheet) with inline editing mode. `ProductDetailPanel` accepts `onSave(form, imageFile)` for async inline saves via `handleInlineSave` in `use-products.ts`. `ProductsPanel` syncs `selectedProduct` with the products array via `useEffect`. Save button shows loading state and only exits edit mode on success.
- **Product Form Modal (Competitive):** Live preview card, completion ring (%), inline per-field validation on blur, autofocus, Ctrl/Cmd+Enter save shortcut, save button loading spinner, description char counter (500 max), unsaved changes warning, enhanced drag-drop with scale animation, animated toggle switch, category layoutId animation, field success states (green border + checkmark), error banner with icon. `saving` state in `use-products.ts` wraps save handlers with try/finally.
- **Products Tab Performance:** All product components (`ProductCard`, `ProductDetailPanel`, `ProductsPanel`) wrapped with `React.memo`. Shared `PRODUCT_CATEGORY_CONFIG` extracted to `commerce-types.ts`. Single-pass `categoryCounts`, memoized `productStats` (revenue/invoiceCount/quoteCount), memoized detail panel handlers, lazy image loading, view-mode-aware skeleton loading.
- Extensive use of `useMemo` and `useCallback` for performance optimization.
- Graceful error handling with Next.js error boundaries and comprehensive ARIA accessibility.

**Technical Implementations & Features:**
- **Business Autopilot System:** AI-powered operations with onboarding, archetype inference, revenue model detection, task orchestration, and a Legal & Compliance Module.
- **Command Center:** Unified page with AI command bar, voice input, AI chat, dashboard metrics, daily briefing, cash flow forecast, and prioritized tasks.
- **Online Store & Public Booking Page:** Modular storefront and a 4-step public booking flow.
- **Notification System:** Real-time notifications for key business events.
- **Gamification System:** Global tiered missions system with XP rewards.
- **Personalized Auth & Onboarding:** Redesigned Glassmorphism sign-up/sign-in, Google OAuth, and an onboarding wizard.
- **Quote-to-Invoice Workflow:** Comprehensive quote management with tax and discount systems.
- **Multi-Gateway Payment System:** Integration with WiPay (Caribbean) and PayPal (international).
- **Subscription & Billing System:** 3-tier plans with free trial and module limits.
- **Multi-Tenant System:** Data isolation using `businessId` with `BusinessGuard` protection.
- **Commerce Module Overhaul (v2):** Re-architected with `CommerceService` (core CRUD), `CommerceStatsService` (server-side KPIs with 60s TTL cache), and `CommerceAiService` (revenue analysis, cash flow forecast, NL command interpreter). Features `CommerceAiSearchBar`, `useCommerceAiHub`, and a unified currency system with 24 supported currencies. Includes a shared `LineItemsEditor` component, decomposed commerce hooks, and typed form states. Recurring invoice scheduler runs hourly. Product Import System supports CSV upload and AI Vision image scan (GPT-4o) with a preview step. Unified Billing Panel (`BillingPanel`) hosts segment navigation for Quotes | Invoices | Schedules inside a single rounded card with segment-specific accent colors, animated tab indicator, swipeable content via `useSwipeTabs`, KPI chips, and keyboard navigation.
- **Commerce Insights Tab:** Bento Grid layout with Hero Stats, Recharts AreaChart for revenue trend, Invoice Status Breakdown, Quote Funnel, Top Products, AI Cash Flow Forecast, Alert Cards, and period selector.
- **Commerce Engage Tab:** Hero Stats, Payment Follow-Up Queue, Quote Action Queue, AI Smart Reminders, Revenue Recovery Planner, and Quick Actions.
- **Cross-Module Injection System:** Composable component architecture enabling seamless data flow between modules. Form prefill hooks (`prefillQuote`/`prefillInvoice`) accept `{ contactId, items, notes }` and open builders pre-populated. URL param injection (`?tab=billing&segment=quotes&contactId=xxx&productIds=a,b,c`) parsed on mount. ModuleEventBus events (`commerce:create_quote_for_contact`, `commerce:create_invoice_for_contact`, `contact:quick_created`) enable cross-module triggering. CRM quick actions ("Create Invoice"/"Send Quote") emit events + navigate with params. `ContactSelect` quick-add emits `contact:quick_created`. AI command types `create_quote_for_contact`/`create_invoice_for_contact` with contactId/productIds routing.
- **Unified Contact Capture:** Single modal with multiple capture modes: Manual, Scan (AI Vision OCR), File Upload, Google Sync, URL Import.
- **Contacts Module (Pluggable):** Modular CRM with reusable components, Contact Lists/Groups, Duplicate Detection, Pipeline, Database, Insights, Engage tabs, CRM Momentum gamification, and AI copilot. Includes bulk edit, inline editing, import field mapping, and virtual scrolling.
- **Settings Feature:** Modular business settings including branding, social links, and a connections hub.
- **Contextual Connection System:** Reusable `ConnectionBanner` and `useConnections` hook for relevant connection prompts.
- **Expense Tracking:** Comprehensive expense management with categories, vendors, budgets, alerts, and recurring expense support.
- **AI Co-Founder (KeyFlow AI):** OpenAI-powered business advisor integrated into the Command page.
- **Email Marketing:** Campaign management with segmentation and delivery tracking.
- **Lead Capture Forms:** Form builder with custom fields and auto-CRM contact creation.
- **Business Templates:** 10 industry-specific presets.
- **MasterClass (Education):** Micro-course catalog with progress tracking.
- **Community Hub:** Peer discussion forum and cohort-based founder circles.
- **Projects & Playbooks (Merged):** Unified page with Kanban board for tasks and event-driven automations.
- **AI Usage Billing:** Centralized AI metering with token/cost logging and a tiered credit system.
- **Server-Side Pagination:** Standardized pagination for commerce and marketplace list endpoints.
- **Global HTTP Exception Filter:** Consistent error response format for backend errors with correlation ID tracing.
- **Pluggable Notes System:** Contact notes with categories, composer, actions, search, filters, pinned notes, and quick templates.
- **Pluggable Tasks System:** Contact tasks with priority levels, composer, due date/reminder inputs, quick templates, search/filter/sort options, and per-task actions.
- **CRM Insights Tab:** Production-grade `insights-tab.tsx` using 12-column Bento Grid layout with Framer Motion animations and **Recharts** for interactive data visualization. Includes a date range picker and export functionality.
- **CRM AI Command Center:** AI Analyst section within the Insights tab for querying contacts/pipeline, with pre-built quick prompts, structured AI responses, suggested actions, and auto-generated tasks.
- **CRM Engage Tab:** Production-grade `engage-tab.tsx` with Bento-inspired layout, Framer Motion animations, and **Multi-Step Engagement Sequences**. Features a **Journey-Aware Action Engine** and a comprehensive Sequences System with full CRUD, enrollment, visual builder, and audit logging.
- **Autopilot AI System:** `AutopilotAiService` generates personalized AI message drafts using `gpt-4o-mini`, with an `ApprovalCard` and `AutopilotSettingsPanel`.
- **Contact Form Enhancements:** Social links, referredBy field, nextScheduledInteraction date picker, and Custom Fields (JSON column).
- **Contact Detail Enrichment:** Data completeness percentage, lifecycle stage badge, days-since-last-interaction, and Related Contacts.
- **CRM AI Command Executor:** Natural language command system that interprets user commands and executes CRM actions via backend `interpretCommand()` in `CrmAiService`.
- **CRM AI Intelligence Suite:** AI-powered features integrated into the Contacts/CRM module via `CrmAiService` + `AiUsageService.callAi()`: AI Contact Summarizer, Smart Lead Scoring, AI Note Intelligence, Predictive Churn Detection, Natural Language CRM Search, Data Quality Scan, Duplicate Finder, Re-engagement Planner, Revenue Opportunity Scanner, and AI Follow-up Drafter.
- **AI Command Hub System:** Unified AI access point per module—a single floating button that expands into a full-featured panel with two modes: **Tools** (categorized AI capabilities) and **Insights** (proactive AI suggestions).
- **CRM Sequence Scheduler:** Runs every 60s, processes due `CrmSequenceEnrollment` records, auto-advances `wait` steps, creates `needs_approval` ContactEvents, and `ContactTask` for call steps.
- **CRM Event → Notification Wiring:** `FlowListener` handles various contact and sequence events, creating user-visible notifications.
- **Contact Polling:** Lightweight `GET /contacts/poll` endpoint returns `{ lastUpdatedAt, totalCount }`. Frontend polls every 30s, triggers silent refresh on changes.
- **Webhook Dispatcher System:** `WebhookDispatcherService` listens to `EventEmitter2` events and fires registered webhook URLs with HMAC-SHA256 signatures, including retry with exponential backoff.
- **Reusable Keyboard Shortcuts System:** `useKeyboardShortcuts` hook with `ShortcutGroup` definitions.
- **Module Event Bus:** Frontend `ModuleEventBus` class for decoupled cross-module communication with typed events.
- **CRM Security Hardening:** Input sanitization, DTO validation, per-endpoint rate limiting, AI prompt injection guard, and feature flag guard.
- **CRM Performance:** In-memory 60s TTL cache on `crm-stats.service.ts` and `crm-flow.service.ts` with cache invalidation on write operations.
- **Observability System:** Request correlation ID middleware, global `LoggingInterceptor`, and CRM health check endpoint.
- **CRM Architecture (v2):** `crm-flow.service.ts` split into focused services, AI prompts extracted, shared constants, controller split into four, centralized `contactWhereBase`/`contactWhereWithId` helpers, `ContactListMember` join table, email/phone normalization + duplicate detection, interactive transactions for contact operations, DB-level sort for `leadScore`, and missing indexes.
- **CRM UX Polish:** Type-to-confirm "DELETE", Undo toast with revert action on Kanban drag-and-drop, Kanban keyboard navigation, and accessible chart widgets.
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