# KEYFLOWOS Monorepo

## Overview
KEYFLOWOS is a business management platform with CRM, invoicing, bookings, and automation features. This is a pnpm monorepo with a Next.js frontend and NestJS backend.

## Architecture

### Apps
- **apps/web**: Next.js 16 frontend (React 19) - runs on port 5000
- **apps/server**: NestJS backend API - runs on port 3001

### Packages
- **packages/db**: Prisma database client with PostgreSQL (Supabase)
- **packages/ui**: Shared UI components (Storybook)
- **packages/api**: Shared API types/contracts

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
- `DATABASE_URL`: PostgreSQL connection string
- `DIRECT_URL`: Direct database connection
- `SUPABASE_URL`: Supabase API URL
- `NEXT_PUBLIC_API_BASE_URL`: Backend API URL
- `PORT`: Backend server port (3001)

## Tech Stack
- **Frontend**: Next.js 16, React 19, Tailwind CSS, Framer Motion
- **Backend**: NestJS, tRPC, Prisma
- **Database**: PostgreSQL (Supabase)
- **Package Manager**: pnpm (workspace)
- **Node Version**: 20

## Deployment
The app is configured for Replit autoscale deployment. The frontend runs on port 5000 and is the primary deployment target.
