# KEYFLOWOS Monorepo

## Overview
KEYFLOWOS is an AI-powered operating system for service businesses that eliminates the "tool maze" by providing pre-built Playbooks for common workflows. Features a "Cockpit" dashboard with Flow Graph visualization, AI-driven Flow Feed, and comprehensive CRM as the intelligence layer.

## Recent Changes (Feb 2026)
- **Online Store & Public Booking Page** - Modern storefront with carousels and quick-add
  - New "Store" tab in Bookings page with Preview/Edit toggle
  - Preview mode shows modernized customer view with catalog carousels
  - Edit mode: inline CRUD for services + Quick Add from Commerce (services/packages)
  - Auto-generated public booking link (always available, no slug required)
  - Optional custom URL slug (e.g., /book/your-business-name)
  - Copy link and "Open Store" buttons always visible
  - Modern public page: hero with brand colors, 3 horizontal carousels (Services, Products, Packages)
  - Carousels only shown when items exist in each category
  - Backend: public products endpoint (no auth), updateService PATCH, public services/staff GET
  - Updated public booking page (/book/[slug]) with business branding (logo, tagline, address)
  - Service descriptions displayed on both preview and public page
  - Staff selection with avatar chips on public booking page
- **Business Autopilot System** - AI-powered autonomous business operations (80-90% automation)
  - New Autopilot Quick Start: ≤3 min onboarding with free-text business intent
  - Business Archetype inference (LOCAL_SERVICE, DIGITAL_PRODUCT, AGENCY, CLINIC, ECOMMERCE)
  - Revenue model detection (ONE_TIME, SUBSCRIPTION, RETAINER, USAGE_BASED)
  - Budget range and time commitment sliders for customization
  - Team size selection (solo or team)
  - Autopilot stages: SETUP → LAUNCHING → OPERATING → MAINTENANCE
  - Task Orchestration Engine with max 3 tasks per day limit
  - Auto-executable tasks vs. approval-required actions
  - Critical alerts for compliance (GREEN/YELLOW/RED), overdue invoices, pending approvals
  - Backend: AutopilotModule with full CRUD, approval flow, stats, and alert endpoints
  - Frontend: client functions for getTodaysTasks, generateSetupTasks, approveTask, denyTask, getAutopilotStats, getCriticalAlerts
  - Legal & Compliance Module: Settings page with categorized checklist (Legal, Financial, Data, Operational)
  - Compliance health indicator (GREEN: all required + 80% optional, YELLOW: 50-100% required, RED: <50% required)
  - Backend persistence for complianceData (Json field) and complianceStatus
- **Real-Time Cockpit Dashboard** - Live business intelligence with data-driven UI
  - FlowService backend aggregates CRM, invoices, bookings, and quotes in real-time
  - Momentum calculation based on business activity (revenue, bookings, tasks)
  - Business flow visualization with bottleneck detection
  - Quick actions based on business state (e.g., "Add First Product" if empty)
  - AI-powered suggestions and health check integration
  - Error handling with user-friendly error messages
- **Gamification System** - Points, levels, achievements, and challenges
  - GamificationService with 18+ achievements (First Sale, Flawless Flow, Growth Mode)
  - XP/level progression (500 XP per level) with automatic milestone detection
  - Daily streak tracking with multipliers (7-day, 30-day, 90-day streaks)
  - Daily, weekly, and monthly challenges with XP rewards
  - Achievement progress bars and unlock notifications
- **Onboarding Wizard** - Guided 4-step setup for new businesses
  - Business Profile setup → Products/Services → Contacts → Automation
  - Progress tracking with completion percentages
  - Skip options for each step with "Complete Later" functionality
  - Automatic detection of completed steps from existing data
  - XP reward for completing onboarding
- **Google Calendar Integration for Bookings** - Auto-sync bookings to Google Calendar
  - OAuth 2.0 flow with calendar.events scope (read/write)
  - Per-business calendar connection stored in database (access/refresh tokens)
  - Connect/disconnect Google Calendar from the bookings page
  - Automatic sync of booking details (service, staff, contact, time) to calendar
  - Status banners for connection success/error feedback
  - Token refresh with 5-minute expiry buffer
- **Google Sign-In** - Continue with Google authentication
  - Added "Continue with Google" buttons on login and signup pages
  - Uses Supabase OAuth for secure authentication
  - Redirects to /auth/callback for session handling
- **Gmail Integration for Quote Sending** - Send quotes directly from user's email
  - OAuth 2.0 flow with Gmail sending permissions (gmail.send scope)
  - Per-business Gmail connection stored in database (access/refresh tokens)
  - Professional HTML email template with business branding
  - Quote details, line items, tax/discount breakdown in email
  - Auto-update quote status to SENT after successful email
  - Connect/disconnect Gmail from the send quote modal
  - Secure HMAC-signed OAuth state tokens for CSRF protection
- **Quote-to-Invoice Workflow** - Complete quotation management with conversion
  - Create, edit, delete quotes with multi-item line items
  - Quote status flow: DRAFT → SENT → ACCEPTED/REJECTED
  - Quote builder with tax, discount, and notes (matching invoice builder)
  - Tax rate (%), discount type (% or fixed), discount value fields
  - Live preview of subtotal, tax, discount, and total calculations
  - Convert accepted quotes to invoices (preserves tax/discount settings)
  - Product picker for quick item selection
  - Quote details modal with full breakdown
  - Send quote to email modal with recipient and message fields
  - Multi-tenant security: business ownership validation on all mutations
- **Business Profile & Branding** - Comprehensive business profile management
  - Logo upload with App Storage integration (presigned URL flow)
  - Business info: name, address, phone, email, website, WhatsApp
  - Social media handles: Facebook, Instagram, Twitter/X, LinkedIn, TikTok, YouTube
  - Brand colors: Primary and secondary color customization
  - Default tax rate setting for invoices
  - Tabbed settings UI: Basic Info, Social Media, Branding
- **Invoice Tax & Discount System** - Professional invoicing with calculations
  - Editable tax rate (%) with configurable default from business profile
  - Discount support: Percentage (%) or fixed amount (TTD)
  - Live preview of subtotal, tax, discount, and total
  - Invoice notes field for payment terms and messages
- **Professional Invoice Template** - Branded public payment page
  - Business logo and name with brand color theming
  - Contact information (address, phone, email, website)
  - Full line item breakdown with quantities and prices
  - Subtotal, tax, discount, and total summary
  - Responsive design with mobile optimization
- **Invoice Feature Enhancements** - Major upgrade to invoicing capabilities
  - Multi-item invoices: Add/remove multiple line items per invoice with running total
  - Product picker: Select from existing products/services to auto-fill item details
  - New item creation: Add new products/services inline when creating invoices
    - Select type (Service/Product/Package), enter description and price
    - Option to add new item to product catalog for future use
  - Invoice detail modal: View full breakdown with items table, contact, dates
  - Copy payment link: One-click copy of public payment URL for customers
  - Status filters: Filter invoices by Draft/Sent/Paid/Overdue status
- **Multi-Tenant BusinessId Fix** - All pages now properly use the logged-in user's businessId
  - Fixed Cockpit, Reports, Bookings, and Commerce pages to call refreshWorkspace() before fetching data
  - Removed hardcoded DEFAULT_BUSINESS_ID fallbacks that caused auth failures
  - Pattern: useEffect for workspace init → separate useEffect for data load (depends on businessId)
- **Commerce Module Overhaul** - Complete product/service management with full CRUD
  - Redesigned Commerce page with KeyFlow UI styling (cards, modals, tabs)
  - Products/services now include description field and TTD pricing
  - Add, edit, and delete products with confirmation dialogs
  - Search/filter products, responsive grid layout
  - Multi-tenant security: update/delete scoped by businessId
- **Contact Import Enhancements** - Added vCard (.vcf) file import and Google Contacts OAuth sync
  - vCard parser handles RFC 6350 line folding, escaped characters, N vs FN precedence
  - Google OAuth with HMAC-signed state tokens (nonce + expiration) for CSRF protection
  - Updated import UI with Google sync tab
- **Backend Dependency Injection Fix** - Added @Inject decorators to all NestJS controllers and services for tsx/esbuild compatibility
- **TypeScript Schema Fixes** - Fixed automation, bookings, and commerce modules to match Prisma schema
- **Complete Design System Overhaul** - New unique KeyFlow identity with warm Caribbean-inspired palette
- **Progressive Web App (PWA)** - Installable on any device with offline support
- **Contacts Page Overhaul** - Modular component architecture with split-view layout
  - New reusable components: ContactCard, ContactForm, ContactDetail, ContactImport
  - Mobile-responsive bottom sheet for contact details on small screens
  - Collapsible import panel supporting CSV, Excel, vCard, and URL imports
- Mobile-optimized bottom navigation bar for touch-friendly access
- **New Color Palette**: Sunset Orange (#F97316) primary, Caribbean Teal (#14B8A6) secondary
- Redesigned sidebar with icon-first navigation, collapsible width, and cleaner hierarchy
- New card component system with glass, accent, and stat card variants
- Flow-themed animations and momentum indicators throughout
- Unified component classes (kf-card, kf-btn-primary, kf-momentum-bar, etc.)
- Light mode: warm cream background, Dark mode: rich brown-black (#0a0807)

## PWA Installation
The app can be installed on any device:
- **iOS**: Open in Safari → Tap Share → "Add to Home Screen"
- **Android**: Open in Chrome → Tap menu → "Add to Home Screen" or "Install app"
- **Desktop**: Click install icon in browser address bar

## Architecture

### Apps
- **apps/web**: Next.js 16 frontend (React 19) - runs on port 5000
- **apps/server**: NestJS backend API - runs on port 3001

### Packages
- **packages/db**: Prisma database client with PostgreSQL (Replit)
- **packages/ui**: Shared UI components (Button, Card, Input, Table, Badge, MomentumBar)
- **packages/api**: Shared API types/contracts

### Modules (Status)
1. **Identity** - User auth, team management, business settings (Complete)
2. **CRM** - Contacts, timeline, lead scoring, segments (Complete)
3. **Commerce** - Products, invoices, quotes, payments (Complete)
4. **Bookings** - Services, staff, availability, calendar (Complete)
5. **Social** - Posts, scheduling, content calendar (Complete)
6. **Automations** - Playbooks, triggers, actions (Complete)
7. **Reports** - KPIs, revenue, bookings analytics (Complete)
8. **Cockpit** - Flow Graph, Flow Feed, AI suggestions (Complete)

### Public Pages
- `/book/[slug]` - Public booking widget for businesses
- `/pay/[invoiceId]` - Public invoice payment page
- `/public/book` - Generic booking test page
- `/public/pay` - Generic payment test page
- `/public/social` - Social post tester

## Development

### Commands
```bash
pnpm dev              # Run all apps in development
pnpm build            # Build all apps
pnpm db:generate      # Generate Prisma client
pnpm db:push          # Push schema to database
pnpm db:studio        # Open Prisma Studio
```

### Environment Variables
Key environment variables are configured in Replit secrets:
- `DATABASE_URL`: PostgreSQL connection string (Replit DB)
- `NEXT_PUBLIC_SUPABASE_URL`: Supabase Auth URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Supabase Auth key
- `NEXT_PUBLIC_API_BASE_URL`: Backend API URL
- `PORT`: Backend server port (3001)
- `GOOGLE_CLIENT_ID`: Google OAuth client ID (for contact sync)
- `GOOGLE_CLIENT_SECRET`: Google OAuth client secret
- `GOOGLE_REDIRECT_URI`: OAuth callback URL (e.g., https://your-domain/api/crm/google/callback)
- `GOOGLE_STATE_SECRET`: HMAC secret for OAuth state signing (required for production)

## Tech Stack
- **Frontend**: Next.js 16, React 19, Tailwind CSS, Framer Motion
- **Backend**: NestJS, Prisma
- **Database**: PostgreSQL (Replit built-in)
- **Auth**: Supabase Auth
- **Package Manager**: pnpm (workspace)
- **Node Version**: 20

## Key Files
- `packages/db/prisma/schema.prisma` - Database schema
- `apps/web/src/lib/client.ts` - API client with 30+ typed functions
- `apps/web/src/app/app/page.tsx` - Cockpit dashboard
- `KEYFLOW_CRM_SPEC.md` - CRM intelligence layer specification
- `KEYFLOW_BLUEPRINT.md` - Master execution blueprint

## User Preferences
- Caribbean localization (TTD currency, Trinidad timezone)
- Glassmorphism UI with dark theme
- Event-driven architecture for automation
- Pre-opinionated flows (Playbooks)

## Deployment
The app is configured for Replit autoscale deployment. The frontend runs on port 5000 and is the primary deployment target.
