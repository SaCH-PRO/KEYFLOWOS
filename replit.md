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
- ContactDetail UX improvements include quick actions, smart empty states, recent activity display, compact mobile layout, and lead score explainers.
- Responsive popup positioning for mobile and desktop views.

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
- **Contacts Module (Pluggable):** Modular CRM system with reusable components like `ContactSelect`, `ContactChip`, and `useContactSearch` hook. Includes Contact Lists/Groups, Duplicate Detection, Pipeline, Database, Insights, and Engage tabs. Features CRM Momentum gamification and AI copilot. Enriched `ContactForm` and `ContactDetail` with detailed fields and auto-logged communication events. Bulk edit functionality.
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
- **Accessibility (ARIA):** Dialog, Drawer, and Command palette components include ARIA attributes.
- **Error Boundaries:** Root and app-level error boundaries for graceful recovery.
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