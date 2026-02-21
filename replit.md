# KEYFLOWOS Monorepo

## Overview
KEYFLOWOS is an AI-powered operating system designed to streamline operations for service businesses, aiming for 80-90% automation. It eliminates the "tool maze" by offering pre-built Playbooks, a "Cockpit" dashboard with a Flow Graph, an AI-driven Flow Feed, and a comprehensive CRM. The system is envisioned as an Operating System for business ownership, integrating six core engines: LaunchFlow, OperateAI, GrowthStack, ProfitLens, ScaleHub, and MasterClass Mode.

## User Preferences
- Caribbean localization (TTD currency, Trinidad timezone)
- Glassmorphism UI with dark theme
- Event-driven architecture for automation
- Pre-opinionated flows (Playbooks)

## System Architecture
The project is a monorepo utilizing a Next.js 16 frontend (`apps/web`) and a NestJS backend API (`apps/server`), with PostgreSQL managed by Prisma.

**UI/UX Decisions:**
- Custom design system with a unique KeyFlow identity, featuring a warm Caribbean-inspired color palette (Sunset Orange, Caribbean Teal).
- PWA capabilities, Glassmorphism elements, and a dark theme.
- Redesigned, icon-first, collapsible sidebar.
- Unified component classes and mobile-optimized navigation.
- Context-aware notifications and flow-themed animations.

**Technical Implementations & Features:**
- **Business Autopilot System:** AI-powered operations with quick-start onboarding, business archetype inference, revenue model detection, task orchestration, and a Legal & Compliance Module.
- **Real-Time Cockpit Dashboard:** Live business intelligence, momentum calculation, bottleneck detection, AI suggestions, prioritized tasks, and revenue insights with WhatsApp deep links.
- **Online Store & Public Booking Page:** Modular storefront management and a 4-step public booking flow with merchandising, social proof, analytics, and WhatsApp sharing.
- **Notification System:** Real-time notifications for key business events.
- **Gamification System:** Points, levels, achievements, streaks, and challenges for engagement.
- **Personalized Auth & Onboarding:** Redesigned glassmorphism sign-up/sign-in, Google OAuth, and an onboarding wizard.
- **Quote-to-Invoice Workflow:** Comprehensive quote management (CRUD, tax/discount) with conversion to invoices.
- **Invoice Tax & Discount System:** Editable tax rates and percentage/fixed discounts with live previews.
- **Professional Invoice Template:** Branded public payment page.
- **Multi-Gateway Payment System:** Integration with WiPay (Caribbean) and PayPal (international).
- **Subscription & Billing System:** 3-tier plans (Free, Flow, KeyFlow) with free trial, managing activation, cancellation, and module limits.
- **Multi-Tenant System:** Data isolation using `businessId` for all operations.
- **Commerce Module Overhaul (v2):** Re-architected into 8 focused modules with KPI dashboard, animated navigation, and glassmorphism product cards.
- **Recurring Invoices:** Auto-generating invoices on various schedules with full item, tax, and discount support.
- **Contacts Page Overhaul:** Modular split-view layout with reusable components.
- **Settings Feature:** Modular business settings including basic info, social links, branding, logo upload, and Google Calendar OAuth.
- **Expense Tracking:** Full CRUD for expenses with categories, vendor tracking, analytics, and receipt management.
- **AI Co-Founder (KeyFlow AI):** OpenAI-powered business advisor with business context, multi-turn chat, daily briefings, and predictive cash flow forecasting.
- **Email Marketing:** Campaign management with segmentation and delivery tracking.
- **Lead Capture Forms:** Form builder with custom fields, public submission, auto-CRM contact creation, and embed code generation.
- **Business Templates:** 10 industry-specific presets to seed business data.
- **MasterClass (Education):** Micro-course catalog with progress tracking and certificate generation.
- **Community Hub:** Peer discussion forum with various post types, likes, comments, and cohort-based founder circles.
- **Core Modules:** Identity, CRM, Commerce, Bookings, Social, Automations, Projects, Flow (Activity & Search), Reports, Cockpit, Expenses, Webhooks, AI, Email Marketing, Lead Forms, Templates, Education, Community.

## External Dependencies
- **Database:** PostgreSQL
- **Authentication:** Supabase Auth
- **AI:** OpenAI via Replit AI Integrations (gpt-5.2)
- **Google Services:** Google Calendar Integration, Google Sign-In, Gmail Integration, Google Contacts OAuth Sync
- **Payment Gateways:** WiPay, PayPal
- **Package Manager:** pnpm
- **Storage:** App Storage