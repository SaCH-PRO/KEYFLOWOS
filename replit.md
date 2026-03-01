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
- Premium design token system with elevation shadows, glass surfaces, and micro-transitions.
- Context-aware notifications, flow-themed animations, and a glassmorphism toast notification system.
- Custom Glassmorphism ConfirmDialog for all confirmations and skeleton loading states.
- Graceful error handling with Next.js error boundaries.
- Search debouncing and client-side pagination with accessibility features (ARIA labels, roles).
- Component decomposition for modularity, especially in CRM Pipeline and Database features.
- **Unified CRM Design Language (Pipeline, Database, Insights):** All three CRM tabs share standardized design tokens: `rounded-2xl border-border/50 bg-card` cards, `bg-white/[0.03] border-border/40 rounded-xl` glass search inputs, `bg-popover/95 backdrop-blur-xl` dropdowns, `text-[10px] uppercase tracking-wider` section headers, gradient accent buttons (`bg-gradient-to-r from-accent/15 to-accent/5`), `bg-white/[0.08] border-border/50` active states, `border-border/40 rounded-xl` bordered status badges, gradient accent indicators (`w-1 h-5 rounded-full bg-gradient-to-b`), and consistent empty states with icon containers (`w-10 h-10 rounded-xl bg-white/[0.03]`). Safe array sort (always spread before sort to prevent memoized mutation).
- Enhanced database table features include column visibility toggle, responsive column auto-hiding, search text highlighting, multi-word search, keyboard-navigable rows, and select-all-across-pages functionality.
- Contact Lists are enhanced with bulk "Add to List" actions, expandable member panels, and per-member removal.
- ContactDetail UX improvements include quick actions, smart empty states, recent activity, and lead score explainers.
- All detail tabs (Notes, Tasks, Timeline) render simultaneously using CSS `hidden` for state preservation.
- Performance optimizations include extensive use of `useMemo` and `useCallback` for memoization and stable references, along with ref-based callback stabilization.
- Inline error/retry UI for loading failures and comprehensive ARIA accessibility across components.
- A "Getting Started Guide" component provides step-by-step onboarding with progress tracking and localStorage persistence.

**Technical Implementations & Features:**
- **Business Autopilot System:** AI-powered operations with onboarding, archetype inference, revenue model detection, task orchestration, and a Legal & Compliance Module.
- **Command Center:** Unified page with AI command bar, voice input, AI chat, dashboard metrics, daily briefing, cash flow forecast, and prioritized tasks.
- **Online Store & Public Booking Page:** Modular storefront and a 4-step public booking flow.
- **Notification System:** Real-time notifications for key business events.
- **Gamification System:** Global tiered missions system with XP rewards.
- **Personalized Auth & Onboarding:** Redesigned Glassmorphism sign-up/sign-in, Google OAuth, and an onboarding wizard.
- **Quote-to-Invoice Workflow:** Comprehensive quote management with tax and discount systems, and a professional invoice template.
- **Multi-Gateway Payment System:** Integration with WiPay (Caribbean) and PayPal (international).
- **Subscription & Billing System:** 3-tier plans with free trial and module limits.
- **Multi-Tenant System:** Data isolation using `businessId` with `BusinessGuard` protection.
- **Commerce Module Overhaul (v2):** Re-architected into 8 focused modules with KPI dashboard and glassmorphism product cards, including recurring invoices.
- **Unified Contact Capture:** Single modal with multiple capture modes: Manual, Scan (AI Vision OCR), File Upload, Google Sync, URL Import.
- **Contacts Module (Pluggable):** Modular CRM with reusable components, Contact Lists/Groups, Duplicate Detection, Pipeline, Database, Insights, Engage tabs, CRM Momentum gamification, and AI copilot. Features bulk edit, inline note/task editing, Google OAuth callback handling, enriched Insights and Engage tabs, import field mapping, virtual scrolling, client-side validation, and timezone-aware dates.
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
- **Global Commerce / Marketplace:** International selling pipeline with tabs for Dashboard, Catalog, Orders, Shipments, Customs, Warehousing, Pre-Orders, and Purchase Orders, supporting multi-currency and customs clearance.
- **AI Usage Billing:** Centralized AI metering with token/cost logging and a tiered credit system.
- **Server-Side Pagination:** Standardized pagination for commerce and marketplace list endpoints.
- **Global HTTP Exception Filter:** Consistent error response format for backend errors.
- **CORS Configuration:** Environment-aware CORS settings.
- **Mass Assignment Protection:** Explicit field mapping for sensitive updates.
- **Accessibility (ARIA):** Extensive ARIA attributes across dialogs, drawers, and interactive components.
- **Bulk Operations Cap:** Server-side validation limits `contactIds` array to 100 items.
- **Error Boundaries:** Root, app-level, and CRM pipeline-level error boundaries.
- **Pluggable Notes System:** Contact notes with 6 categories, composer, per-note actions, search, category filters, pinned notes, quick templates, and keyboard shortcuts.
- **Pluggable Tasks System:** Contact tasks with 3 priority levels, composer, priority picker, due date/reminder inputs, quick templates, search/filter/sort options, overdue/due-soon highlighting, per-task actions, and circular checkbox completion.
- **CRM Insights Tab (Production-Grade, Bento Layout):** Premium `insights-tab.tsx` using Bento Grid layout (Apple/Vercel-inspired) with framer-motion stagger animations. **Row 1:** HeroStats — 4 stat cards with inline SVG sparklines (6-week trend), gradient accent glows, trend indicators (`ArrowUpRight`/`ArrowDownRight`). **Row 2:** Asymmetric 3:2 grid — Pipeline Funnel (animated gradient bars with `motion.div`, conversion % arrows, bold stage counts) + Action Items (priority alerts with icon containers, hover arrow reveal, richer "All clear" empty state). **Row 3:** Revenue Forecast (animated stacked bar with `motion.div`, line-item breakdown with dot indicators, warning badges with borders) + Contact Growth (taller h-28 bars with hover count reveal, animated entrance, proper text-[10px] labels). **Row 4:** 3-column grid — Data Quality (animated SVG ring, 5 field breakdown with icons: Email/Phone/Company/Tags/Location, animated bars), Lead Scores + Health (stacked card with icon containers, colored backgrounds), Source Effectiveness (NEW: shows conversion rate by source with color-coded bars) + Sources + Channel Preference (NEW: preferred contact channels with colored icon badges). All sections use `motion.div` stagger animations, uppercase `tracking-wider` headers, `rounded-2xl` cards with `border-border/50`, gradient fills, `backdrop-blur-xl` dropdown. Sub-components wrapped in `React.memo`, `useCallback`/`useMemo` for performance. `aria-hidden` on decorative sparklines. TTD formatting via `formatTTD` helper.
- **Core Modules:** Identity, CRM, Commerce, Marketplace, Bookings, Social, Projects & Playbooks, Flow (Activity & Search), Reports, Command, Expenses, Webhooks, AI, Email Marketing, Lead Forms, Templates, Education, Community.

## External Dependencies
- **Database:** PostgreSQL
- **Authentication:** Supabase Auth
- **AI:** OpenAI via Replit AI Integrations
- **Google Services:** Google Calendar Integration, Google Sign-In, Gmail Integration, Google Contacts OAuth Sync
- **Payment Gateways:** WiPay, PayPal
- **Package Manager:** pnpm
- **Storage:** App Storage