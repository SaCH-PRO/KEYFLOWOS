# KEYFLOWOS Monorepo

## Overview
KEYFLOWOS is an AI-powered operating system for service businesses that eliminates the "tool maze" by providing pre-built Playbooks for common workflows. Features a "Cockpit" dashboard with Flow Graph visualization, AI-driven Flow Feed, and comprehensive CRM as the intelligence layer.

## Recent Changes (Feb 2026)
- **Quote-to-Invoice Workflow** - Complete quotation management with conversion
  - Create, edit, delete quotes with multi-item line items
  - Quote status flow: DRAFT → SENT → ACCEPTED/REJECTED
  - Convert accepted quotes to invoices with tax/discount options
  - Product picker for quick item selection
  - Quote details modal with full breakdown
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
