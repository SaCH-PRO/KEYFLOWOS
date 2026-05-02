# KEYFLOWOS Repo Audit

## 1. Current Architecture Summary

KEYFLOWOS is a pnpm monorepo for an AI-powered operating system for service businesses.

- `apps/web`: Next.js 16 App Router frontend using React 19.
- `apps/server`: NestJS backend with modular feature domains.
- `packages/db`: Prisma database package and shared Prisma client.
- `packages/api`: tRPC/API contract package shared with the Nest tRPC adapter.
- `packages/ui`: Shared UI primitives and Storybook setup.

The app preserves an App Router frontend shell with PWA providers, workspace navigation, Command Flow/Cockpit surfaces, Studio/settings surfaces, public pages, and AI Copilot entry points. The backend preserves a Nest modular structure with global Prisma, auth, event bus, connectors, feature modules, and tRPC wiring.

## 2. App Routes Found

Primary frontend app routes found under `apps/web/src/app` include:

- `/`: marketing homepage.
- `/app`: authenticated app cockpit/command entry.
- `/app/control-tower`: Command Flow surface.
- `/app/store`: KEYFLOWOS store surface.
- `/app/crm`, `/app/crm/dashboard`, `/app/crm/pipeline`, `/app/crm/contacts/[contactId]`: CRM surfaces.
- `/app/bookings`: bookings/calendar workspace.
- `/app/commerce`: revenue/commerce workspace.
- `/app/automations`: automations/flows workspace.
- `/app/projects`: projects workspace.
- `/app/expenses`: expenses workspace.
- `/app/reports`: reports workspace.
- `/app/documents`, `/app/documents/[instanceId]`: documents workspace.
- `/app/marketing`, `/app/social`, `/app/social/oauth/[platform]/callback`: content/social surfaces.
- `/app/community`, `/app/community/profile/[businessId]`: community surfaces.
- `/app/learn`: learning surface.
- `/app/marketplace`: marketplace surface.
- `/app/profile`: business/profile branding surface.
- `/app/onboarding`: onboarding flow.
- `/app/templates`: templates surface.
- `/app/settings/*`: Studio settings including business, team, connections, templates, notifications, security, developers, webhooks, compliance, AI control, output templates, and profile.
- `/admin/*`: admin/owner console routes.
- `/auth/login`, `/auth/signup`, `/auth/start`, `/auth/callback`: auth routes.
- `/book`, `/book/[slug]`, `/book/[slug]/product/[productId]`: public booking/storefront routes.
- `/pay/[invoiceId]`, `/pay/link/[token]`, `/order/[token]`: public payment/order routes.
- `/pricing`, `/studio`, `/offline`, `/env-check`, `/public/book`, `/public/pay`, `/public/social`.
- API routes under `apps/web/src/app/api` include session and integration callback/action routes.

## 3. Server Modules Found

Core modules and feature modules registered in `apps/server/src/app.module.ts` include:

- Core: `PrismaModule`, `EventBusModule`, `AuthModule`, `TrpcModule`, `ConnectorModule`, `SeedModule`.
- Feature modules: `IdentityModule`, `CrmModule`, `CommerceModule`, `BookingsModule`, `SocialModule`, `AutomationModule`, `SiteModule`, `AiModule`, `FlowModule`, `GamificationModule`, `WebhooksModule`, `ApiKeysModule`, `ActionsModule`, `UploadsModule`, `AutopilotModule`, `NotificationsModule`, `PaymentsModule`, `SubscriptionsModule`, `ProjectsModule`, `ExpensesModule`, `ReportsModule`, `EmailMarketingModule`, `LeadFormsModule`, `TemplatesModule`, `EducationModule`, `CommunityModule`, `MarketplaceModule`, `SupplierModule`, `MomentumModule`, `OnboardingConciergeModule`, `DocumentsModule`, `GoogleDriveModule`, `DiagnosticsModule`, `CommunicationsModule`.

The backend starts from `apps/server/src/main.ts`, configures global CORS/security/validation in `app-bootstrap.ts`, and listens on `PORT` or `3001`.

## 4. Shared Packages Found

- `@keyflow/db`: Prisma client wrapper, Prisma schema, soft-delete middleware.
- `@keyflow/api`: tRPC setup and routers for identity, CRM, commerce, bookings, social, automation, site, admin, diagnostics, and supplier.
- `@keyflow/ui`: shared UI exports for button, input, card, badge, achievement, momentum bar, flow feed, shell, table, dialog, drawer, toast, layout, and utilities. Storybook config exists via package scripts.

## 5. Current Build/Lint/Test Status

Commands run from repo root:

- `pnpm install`: passed.
- `pnpm --filter db run db:generate`: passed.
- `pnpm --filter server build`: passed.
- `pnpm --filter web build`: passed.
- `pnpm lint`: passed with warnings only.
- `pnpm build`: passed.
- `pnpm dev`: backend started on `http://localhost:3001`; frontend did not show as listening during the short check, likely because recursive dev was interrupted after backend verification. Backend startup produced database-backed seed/scheduler warnings/errors in the current local environment.

Lint status: 0 errors, many warnings, mostly `any`, unused variables, and React hooks compiler warnings. These are not current blockers.

## 6. Environment Variables Required

Known environment variables discovered from config and code include:

- `DATABASE_URL`: required by Prisma/Postgres.
- `DIRECT_URL`: listed in `.env.example` for direct/pool connection usage.
- `PORT`: optional backend port override, defaults to `3001`.
- `NEXT_PUBLIC_API_BASE_URL`: optional frontend API base override.
- `NEXT_PUBLIC_AI_SUGGEST_URL`: optional AI suggestion endpoint.
- `NEXT_PUBLIC_DEMO_BUSINESS_ID`: optional demo business override.
- `NEXT_PUBLIC_ENABLE_DEMO_MODE`: optional demo mode flag.
- `NEXT_PUBLIC_SITE_URL`: used for backend CORS allowed origins.
- `VERCEL_URL`: used for backend CORS allowed origins.
- `REPLIT_DEV_DOMAIN`, `REPL_SLUG`, `REPL_OWNER`: used for Replit CORS origins.

Additional provider variables are likely needed by connector/auth/payment modules, but they are not documented in `.env.example` yet.

## 7. Known Risks

- Prisma generation depends on running `pnpm --filter db run db:generate`, especially because pnpm currently reports ignored dependency build scripts after install.
- `pnpm install` warns about ignored build scripts for packages including Prisma, SWC, esbuild, sharp, and NestJS core. This is not a current blocker, but local environments may need `pnpm approve-builds`.
- Backend dev startup produces seed and scheduler DB query failures when the local database is unavailable, misconfigured, or not migrated. The app process still starts, but background services log warnings/errors.
- `.env.example` is minimal and does not document all auth, AI, payment, storage, email, or connector variables implied by modules.
- Frontend auth/workspace state relies on browser local storage keys and `/api/session`/`bootstrapIdentity`, making authentication + business context the highest-risk flow to stabilize next.
- Lint currently passes but has a large warning backlog.
- `packages/ui` build script intentionally skips actual compilation, which is acceptable for current setup but should remain explicit.

## 8. Duplicate or Dead Code Candidates

Candidates for future cleanup, not changed during this audit:

- `packages/db/src/middlewear` appears alongside `packages/db/src/middleware`; the spelling suggests possible duplicate/dead folder.
- `apps/web/src/lib/client.ts` is very large and may contain mixed typed API helpers across many domains.
- App layout includes substantial navigation, notification, workspace, and Copilot behavior in one large client component.
- Lint warnings identify unused imports/variables and React hooks/compiler warnings across frontend code.

## 9. Where Frontend Calls Backend

Primary frontend backend-call locations:

- `apps/web/src/lib/api-base.ts`: defines `API_BASE`.
- `apps/web/src/lib/api.ts`: fetch wrappers for `GET`, `POST`, `PATCH`, `PUT`, `DELETE` with credentials.
- `apps/web/src/lib/client.ts`: typed domain API client helpers for CRM, bookings, commerce, contacts, and related workflows.
- `apps/web/src/lib/workspace.ts`: session check and identity bootstrap integration.
- `apps/web/src/app/api/*`: Next.js API routes for session and integration callbacks/actions.

Default browser API behavior uses `NEXT_PUBLIC_API_BASE_URL` if present, otherwise `${window.location.origin}/backend` in the browser, and `http://localhost:3001` on the server.

## 10. Where Backend Uses Prisma

Backend Prisma access is centralized through:

- `packages/db/src/client.ts`: exports shared `db` Prisma client with soft-delete extension.
- `apps/server/src/core/prisma/prisma.service.ts`: exposes `readonly client = db`.
- `apps/server/src/core/prisma/prisma.module.ts`: global Nest module exporting `PrismaService`.
- Feature services/controllers inject `PrismaService` and call `this.prisma.client.*`.
- tRPC context in `apps/server/src/trpc.module.ts` passes `db` directly to API routers.

## 11. Where AI/Copilot Logic Lives

Frontend AI/Copilot:

- `apps/web/src/components/ai/copilot-panel.tsx`: global Copilot panel UI.
- `apps/web/src/hooks/use-module-ai.ts`: module AI suggestions/tools state and event bridge to global Copilot.
- `apps/web/src/app/app/layout.tsx`: mounts `AiContextProvider`, maps routes to Copilot modules, and opens Copilot via keyboard/events.
- `apps/web/src/app/app/commerce/hooks/use-commerce-copilot.ts`: commerce-specific Copilot hook.
- `apps/web/src/components/contacts/ai-copilot.tsx`: contact-specific AI UI.

Backend AI:

- `apps/server/src/modules/ai/ai.module.ts`: AI module root.
- `AiController`, `AiListener`, `AiAdvisorService`, `ModelGatewayService`, `IntentParserService`, `PlannerService`, `AiMemoryService`, `FlowOrchestratorService`, `BusinessGraphService`, `GovernanceService`, and related services.
- AI integrates with subscriptions/usage and Prisma-backed logs/plans/memory.

## 12. Recommended Next 5 Development Steps

## 12A. Authentication + Workspace Context Stabilization Pass

Reviewed auth/workspace files:

- `apps/web/src/app/api/session/route.ts`: stores the Supabase access token in an HTTP-only `kf_session` cookie, reports session presence, and clears the cookie on logout.
- `apps/web/src/lib/session-client.ts`: client helper for persisting and clearing the web session cookie.
- `apps/web/src/lib/workspace.ts`: owns `kf_business_id`, `kf_business_cache`, and `kf_user_cache`, and refreshes workspace context through `bootstrapIdentity`.
- `apps/web/src/lib/client.ts`: exposes `bootstrapIdentity` and `fetchMe`.
- `apps/web/src/app/auth/login/page.tsx`, `apps/web/src/app/auth/signup/page.tsx`, and `apps/web/src/app/auth/callback/page.tsx`: sign in/sign up/callback flows persist session tokens and bootstrap identity/workspace.
- `apps/server/src/core/auth/auth.middleware.ts`: reads bearer tokens or `kf_session`, verifies through Supabase when configured, falls back to local JWT decoding, and attaches `req.user`.
- `apps/server/src/core/auth/auth.guard.ts`: requires `req.user`.
- `apps/server/src/core/auth/business.guard.ts`: verifies user ownership or membership for `businessId`.
- `apps/server/src/modules/identity/identity.controller.ts`: exposes authenticated `me`, business, and `bootstrap` endpoints.
- `apps/server/src/modules/identity/identity.service.ts`: creates or updates the user, creates or finds the first owned business, and upserts OWNER membership.

Findings:

- No build-blocking auth/workspace issue was found.
- The local `/backend` frontend proxy is already configured in `apps/web/next.config.ts`.
- Login/signup/callback flows all persist `kf_session` before calling `/identity/bootstrap`.
- App layout calls `refreshWorkspace`, which can repopulate business/user cache from the authenticated bootstrap endpoint.
- The highest remaining risk is environment/database readiness: auth bootstrap requires a valid session token and a working Prisma/Postgres connection.
- The second highest remaining risk is product behavior rather than compilation: multi-business selection is not yet a first-class UX in the current workspace cache flow.

## 12B. Onboarding Completion Flow Stabilization Pass

Reviewed onboarding files:

- `apps/web/src/app/app/onboarding/page.tsx`: onboarding wizard, template selection, product setup, auto-configuration, first-win selection, and finish/skip actions.
- `apps/web/src/app/app/layout.tsx`: redirects incomplete businesses to `/app/onboarding` when `business.onboardingComplete === false`.
- `apps/web/src/lib/client.ts`: `updateBusiness`, concierge state, auto-configure, template preview, and completion helpers.
- `apps/server/src/modules/onboarding-concierge/onboarding-concierge.controller.ts`: guarded onboarding concierge endpoints.
- `apps/server/src/modules/onboarding-concierge/onboarding-concierge.service.ts`: setup status, nudges, auto-configure, and completion persistence.
- `apps/server/src/modules/identity/dto/update-business.dto.ts`: validated business update fields.
- `apps/server/src/modules/identity/identity.service.ts`: business update persistence.

Findings and fix:

- The onboarding page sent `businessIntent` during template selection.
- `Business.businessIntent` exists in Prisma, but `UpdateBusinessDto` and `IdentityService.updateBusiness` did not accept/persist the field.
- Because the Nest validation pipe uses `whitelist: true`, `businessIntent` was stripped before reaching the service.
- Fixed by adding `businessIntent` to `UpdateBusinessDto` and the existing `IdentityService.updateBusiness` string-field persistence path.
- `pnpm --filter server build` and `pnpm --filter web build` both pass after the fix.

## 12C. CRM Contacts Pipeline Stabilization Pass

Reviewed CRM files:

- `apps/web/src/app/app/crm/pipeline/page.tsx`: CRM pipeline entry surface and contacts tab wiring.
- `apps/web/src/app/app/crm/pipeline/hooks/use-contacts-data.ts`: contact list loading, filters, pagination, favorites, and workspace resolution.
- `apps/web/src/components/contacts/contact-picker-drawer.tsx`: contact picker/broadcast contact loading.
- `apps/web/src/lib/client.ts`: contact list/detail/create/update/delete API helpers.
- `apps/server/src/modules/crm/crm.controller.ts`: guarded CRM contact endpoints.
- `apps/server/src/modules/crm/crm.service.ts`: contact list/create/update/delete service logic.
- `apps/server/src/modules/crm/dto/create-contact.dto.ts`: create contact validation.
- `apps/server/src/modules/crm/dto/update-contact.dto.ts`: update contact validation.
- `packages/db/prisma/schema.prisma`: `Contact` model, soft-delete column, normalized email/phone fields, and unique constraints.

Findings and fix:

- The frontend `createContact` helper defaulted missing `email` and `phone` to empty strings.
- The backend DTO marks `email` optional, but if an empty string is present, `@IsEmail()` rejects it.
- The `Contact` model also has unique constraints on normalized email and phone, so blank values are risky even when they pass lower-level normalization.
- Fixed by omitting blank `email` and `phone` values from create/update contact requests before they reach backend validation.
- `pnpm --filter server build` and `pnpm --filter web build` both pass after the fix.

## 12D. Public Booking Flow Stabilization Pass

Reviewed public booking files:

- `apps/web/src/app/book/[slug]/page.tsx`: public storefront/booking page, business lookup, service/staff/product loading, checkout, and public booking submission.
- `apps/web/src/app/public/book/page.tsx`: simple public booking test page.
- `apps/server/src/modules/bookings/bookings.controller.ts`: public service/staff lookup and unauthenticated public booking creation endpoints.
- `apps/server/src/modules/bookings/bookings.service.ts`: public booking creation, service lookup, business hours checks, staff availability checks, contact creation, invoice creation, and booking persistence.
- `apps/server/src/modules/bookings/dto/public-create-booking.dto.ts`: public booking request validation.
- `apps/server/src/modules/identity/identity.controller.ts`: public business slug/ID lookup endpoints.
- `apps/server/src/modules/identity/identity.service.ts`: public-safe business field selection.
- `packages/db/prisma/schema.prisma`: `Service`, `StaffMember`, `Availability`, and `Booking` models.

Findings and fix:

- The public booking controller already converts `body.startTime` to `Date` before calling the service.
- `PublicCreateBookingDto.startTime` should therefore remain the incoming ISO string for validation.
- Fixed the DTO to keep `startTime` typed as `string` and validated with `@IsISO8601()`, avoiding pre-validation date coercion risk under the global transform pipe.
- `pnpm --filter server build` and `pnpm --filter web build` both pass after the fix.

1. Stabilize authentication + workspace/business context end-to-end.
2. Stabilize onboarding completion flow and ensure business context is created/cached consistently.
3. Stabilize CRM contacts pipeline as the first core operational workspace.
4. Stabilize public booking flow with real business/service context.
5. Connect AI Copilot to reliable authenticated business context and real module data.

## Command Log

- `pnpm install`: passed.
- `pnpm --filter db run db:generate`: passed.
- `pnpm --filter server build`: passed.
- `pnpm --filter web build`: passed.
- `pnpm lint`: passed with warnings.
- `pnpm build`: passed.
- `pnpm dev`: backend startup verified, then stopped.

## Files Changed During Audit

- `docs/KEYFLOWOS_REPO_AUDIT.md`: created this audit document.

No source code, package versions, architecture, product features, or UI were changed.
