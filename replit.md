# KEYFLOWOS Monorepo

## Overview
KEYFLOWOS is an AI-powered operating system designed for service businesses to streamline operations and eliminate the "tool maze." It provides pre-built Playbooks for common workflows, features a "Cockpit" dashboard with a Flow Graph visualization, an AI-driven Flow Feed, and a comprehensive CRM acting as the intelligence layer. The system aims to achieve 80-90% automation of business operations. It's envisioned as an Operating System for business ownership, comprising 5 interconnected engines: LaunchFlow, OperateAI, GrowthStack, ProfitLens, ScaleHub, and MasterClass Mode.

## User Preferences
- Caribbean localization (TTD currency, Trinidad timezone)
- Glassmorphism UI with dark theme
- Event-driven architecture for automation
- Pre-opinionated flows (Playbooks)

## System Architecture
The project is structured as a monorepo containing a Next.js 16 frontend (`apps/web`) and a NestJS backend API (`apps/server`). It leverages PostgreSQL via Prisma for database management.

**UI/UX Decisions:**
- A complete design system overhaul with a unique KeyFlow identity, using a warm Caribbean-inspired palette (Sunset Orange primary, Caribbean Teal secondary).
- Progressive Web App (PWA) capabilities for installability and offline support.
- Glassmorphism UI elements and a dark theme.
- Redesigned sidebar with icon-first navigation and a collapsible width.
- Unified component classes (e.g., `kf-card`, `kf-btn-primary`).
- Mobile-optimized navigation including bottom bar, slide-out drawer, and header elements.
- Context-aware notification displays (bottom-sheet on mobile, dropdown on desktop).
- Flow-themed animations and momentum indicators.

**Technical Implementations & Features:**
- **Business Autopilot System:** AI-powered autonomous operations with quick-start onboarding, business archetype inference, revenue model detection, task orchestration, and a Legal & Compliance Module.
- **Real-Time Cockpit Dashboard:** Provides live business intelligence including momentum calculation, bottleneck detection, AI suggestions, prioritized tasks, and revenue insights. Deep links to WhatsApp are integrated.
- **Online Store & Public Booking Page:** Features a modular component architecture for storefront management (customization, product catalog, hours, settings) and a public booking flow (catalog grid, item details, cart, 4-step checkout). Includes merchandising panels, social proof, analytics, and WhatsApp sharing.
- **Notification System:** Real-time notifications with an unread count badge, dropdown panel, and mark-all-read functionality, triggered by key business events.
- **Gamification System:** Implements points, levels, achievements, daily streaks, and challenges to boost user engagement.
- **Personalized Auth & Onboarding:** Redesigned glassmorphism sign-up (2-step progressive flow) and sign-in pages, with Google OAuth integration and an onboarding wizard for first-time users. Dynamic brand color integration across the UI.
- **Quote-to-Invoice Workflow:** Comprehensive quote management (CRUD, tax/discount calculations, product picker) with conversion to invoices.
- **Invoice Tax & Discount System:** Supports editable tax rates and percentage/fixed discounts with live calculation previews.
- **Professional Invoice Template:** Branded public payment page with business logo and line item breakdown.
- **Multi-Gateway Payment System:** Integrates WiPay (Caribbean local/regional) and PayPal (international) for payment processing, with gateway selection on the public payment page.
- **Subscription & Billing System:** Offers 3-tier plans (Free, Flow, KeyFlow) with a free trial, managed through a dedicated module handling activation, cancellation, and enforcing subscription limits across modules.
- **Multi-Tenant System:** Ensures data isolation by associating all operations with the logged-in user's `businessId`, enforcing ownership and membership.
- **Commerce Module Overhaul (v2):** Re-architected into 8 focused modules for improved maintainability, featuring a KPI dashboard, animated tab navigation, glassmorphism product cards, and preserved existing CRUD and payment flows.
- **Contacts Page Overhaul:** Modular component architecture with a split-view layout and reusable components.
- **Settings Feature:** Production-ready modular business settings including basic info, social links, branding, logo upload, and Google Calendar OAuth integration.
- **Core Modules:**
    - **Identity:** User authentication, team, business settings.
    - **CRM:** Contacts, timeline, lead scoring.
    - **Commerce:** Products, invoices, quotes, payments.
    - **Bookings:** Services, staff, availability, calendar.
    - **Social:** Posts, scheduling, multi-platform channel integration (Facebook, Instagram, LinkedIn, Twitter, TikTok) with analytics.
    - **Automations:** Playbooks, triggers, actions, with an AutomationExecutorService.
    - **Projects:** Full CRUD for projects with tasks and a Kanban board UI.
    - **Flow (Activity & Search):** Unified activity feed and universal search across all modules.
    - **Reports:** KPIs, analytics.
    - **Cockpit:** Flow Graph, Flow Feed, live momentum bar, universal search, and prioritized tasks.

## External Dependencies
- **Database:** PostgreSQL (Replit built-in)
- **Authentication:** Supabase Auth
- **Google Services:**
    - Google Calendar Integration (OAuth 2.0 with `calendar.events` scope)
    - Google Sign-In (via Supabase OAuth)
    - Gmail Integration for Quote Sending (OAuth 2.0 with `gmail.send` scope)
    - Google Contacts OAuth Sync
- **Payment Gateways:**
    - WiPay (Caribbean - TTD, JMD, BBD, GYD, XCD)
    - PayPal (International - USD) - `@paypal/paypal-server-sdk v2.2.0`
- **Package Manager:** pnpm
- **Storage:** App Storage (for logo uploads)