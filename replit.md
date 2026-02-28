# KEYFLOWOS Monorepo

## Overview
KEYFLOWOS is an AI-powered operating system designed to automate operations for service businesses, aiming for 80-90% automation. It offers pre-built Playbooks and a unified "Command" center with an AI-powered command bar, voice input, and integrated business intelligence. The system integrates six core engines: LaunchFlow, OperateAI, GrowthStack, ProfitLens, ScaleHub, and MasterClass Mode.

## User Preferences
- Caribbean localization (TTD currency, Trinidad timezone)
- Glassmorphism UI with dark theme
- Event-driven architecture for automation
- Pre-opinionated flows (Playbooks)

## System Architecture
The project is a monorepo utilizing a Next.js 16 frontend (`apps/web`) and a NestJS backend API (`apps/server`), with PostgreSQL managed by Prisma.

**UI/UX Decisions:**
- Custom design system with a warm Caribbean-inspired color palette (Sunset Orange, Caribbean Teal), Glassmorphism elements, and a dark theme.
- PWA capabilities and mobile-optimized navigation.
- Redesigned, icon-first, collapsible sidebar with grouped sections (CORE, GROW, MANAGE).
- Premium design token system with elevation shadows, glass surfaces, and micro-transitions.
- Context-aware notifications, flow-themed animations, and a glassmorphism toast notification system.
- Custom Glassmorphism ConfirmDialog component for all confirmations.
- Skeleton loading states for improved user experience.
- Graceful error handling with Next.js `error.tsx`, `loading.tsx`, and `not-found.tsx` boundaries.
- Search debouncing (300ms) and client-side pagination with page size selector.
- Core accessibility features including ARIA labels and roles.
- Component decomposition for modularity (e.g., Marketplace, Reports, Store, CRM Pipeline, ContactDetail).
- CRM Pipeline architecture: `useContactsPipeline` hook → thin `page.tsx` → per-tab components → `contact-detail-tabs.tsx` slim orchestrator with `TabErrorBoundary` → `notes-tab-panel.tsx`, `tasks-tab-panel.tsx`, `timeline-tab-panel.tsx` → shared `tab-constants.ts`.
- CRM Database architecture: `useDatabaseState` hook (state/handlers/refs) → thin `contacts-database.tsx` orchestrator → `DatabaseTable` (`React.memo`), `DatabaseBulkBar` (`React.memo`), `ContactLists`. Ref-based patterns (`selectedIdsRef`, `filteredContactsRef`, `cachedContactsRef`), `useMediaQuery` for SSR-safe responsive `pageSize`, `ConfirmDialog` for bulk delete (no native `confirm()`), typed `ContactListPayload` (no `as any`), proper `<button>` for list click handlers (no async `onClick` on `<div>`), ARIA: `role="grid"` table, `aria-sort` headers, `aria-selected` rows, `role="toolbar"` bulk bar, `role="list/listitem"` contact lists, `role="menu/menuitem"` list actions. `PipelineTabContent` wrapped in `React.memo`.
- **Database Table production-grade upgrades**: Column visibility toggle (localStorage-persisted `kf_db_visible_cols`, checkbox picker dropdown, minimum 2 columns enforced). Responsive column auto-hiding (`mobileHidden` flag on ColumnDef). Search text highlighting (`HighlightedText` component with merged overlapping ranges). Multi-word search (all terms must match). Keyboard-navigable rows (ArrowUp/Down focus, Enter/Space opens detail, X toggles selection). Select-all-across-pages banner ("Select all N contacts" link). Status filter counts (per-status badge). Focus trap on export dialog (Tab/Shift-Tab cycling + Escape). Click-outside dismiss for bulk bar dropdowns. Loading spinners (`Loader2` replaces spinning Cloud). Enhanced empty states (SearchX/UserX icons with contextual hints). Column definitions exported from `use-database-state.ts` as `ALL_COLUMNS`/`ColumnDef`/`ColumnKey`.
- Contact Lists enhanced with: bulk "Add to List" action in `DatabaseBulkBar` (select contacts → pick list from dropdown), expandable member panels (chevron toggle shows/hides members with names, emails, statuses), per-member removal with `ConfirmDialog` (no native `confirm()`), `ListSummary` interface shared between `use-database-state.ts` and `contact-lists.tsx` via `onListsChanged` callback, `refreshToken` prop for cross-component sync (bulk add triggers list reload), ref-based callback stabilization (`onListsLoadedRef`, `onListsChangedRef`). `BulkAction` type extended to `"status" | "tags" | "addToList" | null`.
- ContactDetail UX improvements include quick actions, smart empty states, recent activity display, compact mobile layout, and lead score explainers.
- All three detail tabs (Notes, Tasks, Timeline) render simultaneously with CSS `hidden` toggle to preserve state across tab switches.
- Responsive popup positioning for mobile and desktop views.
- Pipeline performance: Memoized `detailPanelProps` via `useMemo`, memoized database contacts mapping, stable useEffect dependencies (no `state` object in deps), focus management (detail panel auto-focused on selection, list focus restored on close). All inline callbacks in `page.tsx` and `pipeline-tab-content.tsx` extracted into `useCallback` for stable references. `selectContact` dependency array uses `detail.selectContact` instead of entire `detail` object. `setSelectedIds` uses ref-based closure to avoid stale state.
- Ref-based callback stabilization: `contactsRef`, `selectedIdsRef`, `selectedContactIdRef`, `contactDetailRef` in `use-contact-actions.ts` prevent closures over frequently-changing values. All action handlers (`handleDeleteContact`, `handleAddNote`, `handleAddTask`, `handleCompleteTask`, `handleDeleteNote`, `handleDeleteTask`, `handleUpdateStatus`, `handleLogEvent`, `handleEditContact`, `handleBulkStatusChange`, `handleBulkTag`, `handleBulkDelete`) are stable `useCallback` with minimal deps. `handleSelectAll` uses `contactsRef`/`selectedIdsRef` in `use-contacts-data.ts`. `handleCompleteNextAction` wrapped in `useCallback`. `handleConfirmAction` uses `confirmStateRef`. Functional updaters for `handleToggleAutopilotPause`, `handleToggleGuide`, `handleToggleAddMenu`. Shared `segmentCutoffs` memo eliminates duplicate date threshold computation between `segmentCounts` and `displayContacts`.
- Inline error/retry UI for contacts loading failures and detail panel loading failures (replaces toast-only errors).
- Comprehensive ARIA accessibility: sort dropdown (`role="listbox"`, `aria-expanded`, `aria-haspopup`), segment buttons (`aria-pressed`), list tabs (`role="tablist"`, `role="tab"`, `aria-selected`), bulk action bar (`aria-label` on all buttons, `role="listbox"` on status dropdown), guide popup (`role="dialog"`, `aria-modal`), mobile detail drawer (`role="dialog"`, `aria-modal`).
- **Getting Started Guide** (`getting-started-guide.tsx`): Extracted into dedicated component with per-step icons, progress tracking (animated progress bar, completion count), localStorage persistence (`kf_guide_state`), actionable steps (Add Contacts opens capture menu, Segment triggers filter, Broadcast toggles select mode), completion celebration (PartyPopper), "Don't show again" permanent dismiss with badge suppression, focus trap + Escape key dismiss + focus restoration to trigger, `focus-visible` ring styles on all interactive elements, `aria-pressed` on step buttons, `role="group"` on step grid.

**Technical Implementations & Features:**
- **Business Autopilot System:** AI-powered operations with onboarding, business archetype inference, revenue model detection, task orchestration, and a Legal & Compliance Module.
- **Command Center:** Unified command page (`/app`) with AI command bar, voice input, integrated KeyFlow AI chat, dashboard metrics, daily briefing, cash flow forecast, what-if simulator, prioritized tasks, and revenue insights.
- **Online Store & Public Booking Page:** Modular storefront management and a 4-step public booking flow.
- **Notification System:** Real-time notifications for key business events.
- **Gamification System:** Global tiered missions system with XP rewards.
- **PageHeader Consistency:** Standardized `PageHeader` component across all pages.
- **Personalized Auth & Onboarding:** Redesigned glassmorphism sign-up/sign-in, Google OAuth, and an onboarding wizard.
- **Quote-to-Invoice Workflow:** Comprehensive quote management with conversion to invoices, including tax and discount systems.
- **Professional Invoice Template:** Branded public payment page.
- **Multi-Gateway Payment System:** Integration with WiPay (Caribbean) and PayPal (international).
- **Subscription & Billing System:** 3-tier plans (Free, Flow, KeyFlow) with free trial and module limits.
- **Multi-Tenant System:** Data isolation using `businessId` with robust `BusinessGuard` protection.
- **Commerce Module Overhaul (v2):** Re-architected into 8 focused modules with KPI dashboard and glassmorphism product cards.
- **Recurring Invoices:** Auto-generating invoices on various schedules.
- **Unified Contact Capture:** Single modal for contact capture with multiple modes: Manual, Scan (AI Vision OCR), File Upload, Google Sync, URL Import.
- **Contacts Module (Pluggable):** Modular CRM system with reusable components like `ContactSelect`, `ContactChip`, and `useContactSearch` hook. Includes Contact Lists/Groups, Duplicate Detection, Pipeline, Database, Insights, and Engage tabs. Features CRM Momentum gamification and AI copilot. Enriched `ContactForm` and `ContactDetail` with detailed fields and auto-logged communication events. Bulk edit functionality. Inline note/task editing with PATCH endpoints. Google OAuth callback handling with toast notifications. Enriched Insights tab (funnel charts, conversion metrics, period selector). Enriched Engage tab (filter chips, priority sort, completion history, progress indicator). Import field mapping step with preview. Virtual scrolling for large lists. Client-side form validation (email, phone). Mobile-visible action buttons. Timezone-aware dates (Trinidad). Hook decomposition: `useContactsData`, `useContactDetail`, `useContactActions`, `useFlowIntelligence` composed by `useContactsPipeline`. AbortController on all data-fetching hooks to prevent race conditions. Lazy-load-on-first-activation tab panels with `hidden` CSS toggle for state preservation. Keyboard navigation (ArrowUp/Down/Enter) with ARIA listbox. Delete undo timer with unmount cleanup. AI endpoint rate limiting (10/min per business). Composite DB indexes for soft-delete queries. Take parameter capped at 100.
- **Settings Feature:** Modular business settings including branding, social links, and connections hub (Google Calendar, Gmail, Social Media, payment gateways).
- **Contextual Connection System:** Reusable `ConnectionBanner` and `useConnections` hook to surface relevant connection prompts within modules.
- **Expense Tracking (v2):** Comprehensive expense management with categories, vendors, budgets, alerts, vendor analytics, and recurring expense support.
- **AI Co-Founder (KeyFlow AI):** OpenAI-powered business advisor integrated into Command page.
- **Email Marketing:** Campaign management with segmentation and delivery tracking.
- **Lead Capture Forms:** Form builder with custom fields and auto-CRM contact creation.
- **Business Templates:** 10 industry-specific presets.
- **MasterClass (Education):** Micro-course catalog with progress tracking.
- **Community Hub:** Peer discussion forum and cohort-based founder circles.
- **Projects & Playbooks (Merged):** Unified page (`/app/projects`) with Kanban board for tasks and event-driven automations.
- **Global Commerce / Marketplace:** International selling pipeline (`/app/marketplace`) with tabs for Dashboard, Catalog, Orders, Shipments, Customs, Warehousing, Pre-Orders, and Purchase Orders. Supports multi-currency and customs clearance.
- **AI Usage Billing:** Centralized AI metering with token/cost logging and a tiered credit system.
- **Server-Side Pagination:** Standardized pagination for commerce and marketplace list endpoints.
- **Global HTTP Exception Filter:** Consistent error response format for all backend errors.
- **CORS Configuration:** Environment-aware CORS settings.
- **Mass Assignment Protection:** Explicit field mapping for sensitive updates to prevent security vulnerabilities.
- **Accessibility (ARIA):** Dialog, Drawer, Command palette, CRM toolbar, bulk action bar, and mobile drawer components include ARIA attributes.
- **Bulk Operations Cap:** Server-side validation caps `contactIds` array to 100 items in bulk update/delete endpoints.
- **Error Boundaries:** Root, app-level, and CRM pipeline-level error boundaries for graceful recovery.
- **Pluggable Notes System:** Contact notes with 6 categories (General, Call, Meeting, Deal, Follow-up, Idea) stored via `source` field. Collapsed composer, per-note action row (Pin, Copy, WhatsApp, Email, Create Task, Delete), search + category filter chips, pinned notes, quick templates, Cmd/Ctrl+Enter shortcut.
- **Pluggable Tasks System:** Contact tasks with 3 priority levels (HIGH/NORMAL/LOW), collapsed composer, priority picker, due date + reminder (remindAt) inputs, 5 quick templates, search + filter (All/Open/Done/Overdue), sort (Due/Priority/Newest), overdue/due-soon highlighting, per-task action row (Copy, WhatsApp, Email, Create Note, Delete), circular checkbox completion, relative dates. `onAddTask` accepts `(title, options?: { dueDate, priority, remindAt })`.
- **Core Modules:** Identity, CRM, Commerce, Marketplace, Bookings, Social, Projects & Playbooks, Flow (Activity & Search), Reports, Command, Expenses, Webhooks, AI, Email Marketing, Lead Forms, Templates, Education, Community.

## External Dependencies
- **Database:** PostgreSQL
- **Authentication:** Supabase Auth
- **AI:** OpenAI via Replit AI Integrations
- **Google Services:** Google Calendar Integration, Google Sign-In, Gmail Integration, Google Contacts OAuth Sync
- **Payment Gateways:** WiPay, PayPal
- **Package Manager:** pnpm
- **Storage:** App Storage