# KEYFLOWOS Monorepo

## Overview
KEYFLOWOS is an AI-powered operating system designed for service businesses to streamline operations by eliminating the "tool maze." It provides pre-built Playbooks for common workflows, features a "Cockpit" dashboard with a Flow Graph visualization, an AI-driven Flow Feed, and a comprehensive CRM acting as the intelligence layer. The system aims to achieve 80-90% automation of business operations.

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
- Mobile-optimized bottom navigation bar.
- Flow-themed animations and momentum indicators.

**Technical Implementations & Features:**
- **Business Autopilot System:** AI-powered autonomous operations with quick-start onboarding, business archetype inference, revenue model detection, and task orchestration. Includes a Legal & Compliance Module with a checklist and health indicator.
- **Real-Time Cockpit Dashboard:** Live business intelligence with a FlowService backend aggregating CRM, invoices, bookings, and quotes. Features momentum calculation, bottleneck detection, and AI suggestions.
- **Online Store & Public Booking Page:** Unified catalog grid (replaces carousels) with filter tabs, search, sort. Includes cart system with localStorage persistence, progressive 4-step checkout (Review → Schedule → Details → Confirm), type badges for items, and auto-generated public booking link with optional custom URL slugs. Business hours editor and SEO metadata. Staff assignment is optional for public bookings.
- **Notification System:** Real-time notification bell with unread count badge, dropdown panel, and mark-all-read. Notifications auto-created on booking.created, booking.confirmed, invoice.paid, and invoice.overdue events. Polling every 30s for new notifications.
- **Gamification System:** Implements points, levels, achievements, daily streaks, and challenges to incentivize user engagement.
- **Onboarding Wizard:** A guided 4-step setup for new businesses with progress tracking and XP rewards.
- **Quote-to-Invoice Workflow:** Comprehensive quote management (create, edit, delete, status flow) with tax/discount calculations, product picker, and conversion to invoices.
- **Invoice Tax & Discount System:** Editable tax rates, percentage or fixed discounts, and live calculation previews.
- **Professional Invoice Template:** Branded public payment page with business logo, contact info, and line item breakdown.
- **Invoice Feature Enhancements:** Support for multi-item invoices, product picker, inline new item creation, and status filters.
- **Multi-Tenant System:** Ensures data isolation by associating all operations with the logged-in user's `businessId`.
- **Commerce Module Overhaul:** Redesigned interface for product and service management (CRUD operations, descriptions, pricing).
- **Contacts Page Overhaul:** Modular component architecture with split-view layout, reusable components, and a collapsible import panel.

**Core Modules:**
- **Identity:** User authentication, team, business settings.
- **CRM:** Contacts, timeline, lead scoring.
- **Commerce:** Products, invoices, quotes, payments.
- **Bookings:** Services, staff, availability, calendar.
- **Social:** Posts, scheduling.
- **Automations:** Playbooks, triggers, actions.
- **Reports:** KPIs, analytics.
- **Cockpit:** Flow Graph, Flow Feed, AI suggestions.

## External Dependencies
- **Database:** PostgreSQL (Replit built-in)
- **Authentication:** Supabase Auth
- **Google Services:**
    - Google Calendar Integration (OAuth 2.0 with `calendar.events` scope)
    - Google Sign-In (via Supabase OAuth)
    - Gmail Integration for Quote Sending (OAuth 2.0 with `gmail.send` scope)
    - Google Contacts OAuth Sync
- **Package Manager:** pnpm
- **Storage:** App Storage (for logo uploads)