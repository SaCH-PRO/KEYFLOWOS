# KEYFLOWOS Monorepo

## Overview
KEYFLOWOS is an AI-powered operating system for service businesses that eliminates the "tool maze" by providing pre-built Playbooks for common workflows. Features a "Cockpit" dashboard with Flow Graph visualization, AI-driven Flow Feed, and comprehensive CRM as the intelligence layer.

## Recent Changes (Feb 2026)
- **Complete Design System Overhaul** - New unique KeyFlow identity with warm Caribbean-inspired palette
- **Progressive Web App (PWA)** - Installable on any device with offline support
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
