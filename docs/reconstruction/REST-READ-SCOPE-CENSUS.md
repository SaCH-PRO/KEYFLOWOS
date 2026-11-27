# REST Read-Side Scope Census (SWP-READ-SCOPE-CENSUS)

Every membership-only `@Get(...)` route under `apps/server/src` (`modules/`, `core/`, and the app root)
that runs a member guard (`AuthGuard`, `BusinessGuard`, or `OptionalAuthGuard`) without an enforced
`@RequireModuleScope` + `ModuleScopeGuard`, plus pinned V1 plan `applied` and `secret-read` GET rows.
Pinned by `apps/server/src/core/config/rest-read-scope-census.spec.ts` (`RCEN-01`–`RCEN-04`).

## Stop-the-Line Secret-Read Findings (Immediate P0 Follow-Up Required)

1. **`PortalController.listAccess` (`GET /portal/businesses/:businessId/access`)** — **UNPROTECTED MEMBERSHIP-ONLY SECRET READ.**
   Runs only `AuthGuard`, `BusinessGuard`, `RateLimitGuard` (no `@RequireModuleScope`, no `ModuleScopeGuard`).
   `PortalService.list` returns raw `PortalAccess` rows including live 32-byte hex bearer `token`s without applying `portalAccessView`.
   As `portal-access-view.ts` notes, whoever holds the token reads that contact's invoices, projects, and bookings without logging in.
   Any STAFF member with `crm:none` / `revenue:none` / `bookings:none` / `projects:none` can harvest every client portal token.
   **Recommended P0 fix:** gate on `crm:read` and redact `token` via `portalAccessView` unless the caller holds `crm:write`.

2. **`IntegrationHubController.getDashboard` (`GET /integration-hub/businesses/:businessId/dashboard`)** — **UNREDACTED SECRET FIELDS ON `connect:read` ROUTE.**
   Although gated on `@RequireModuleScope('connect', 'read')` (which defaults to `none` for all roles), `IntegrationHubService.getDashboard`
   returns raw `IntegrationConnection` rows (`connection: c ?? null`) including `authData` and `authDataRef` without stripping
   (unlike `KeyConnectorController.getConnections`, which applies `connectionView`).
   **Recommended P0 fix:** project `IntegrationConnection` rows through a strict allowlist that strips `authData` and `authDataRef`.

3. **`SupplierController.getSupplierProduct` (`GET /supplier/businesses/:businessId/supplier-products/:supplierProductId`) & `SupplierController.getProductSourceLinks` (`GET /supplier/businesses/:businessId/products/:productId/source-links`)** — **UNSTRIPPED NESTED `SupplierConnection.credentials` RETURN.**
   Both routes run only `AuthGuard`, `BusinessGuard`, `CrmRateLimitGuard` (no `@RequireModuleScope`, no `ModuleScopeGuard`).
   `SupplierService.getSupplierProduct` (`include: { supplierConnection: true }`) and `SupplierService.getProductSourceLinks`
   (`include: { supplierProduct: { include: { supplierConnection: true } } }`) serialize the raw `SupplierConnection.credentials`
   column (`enc:v1:...`) to any business member without projection/stripping.
   **Tracked follow-up:** `FU-SUPPLIER-CREDENTIALS-NESTED-INCLUDE` (replace `supplierConnection: true` with an explicit non-secret `select:` and gate on `storefront:read`).

## High-Priority Non-Secret Findings

- **`AiIntelligenceController.getCrossBusinessIntelligence` (`GET /ai/intelligence/cross-business`)** — queries `membership.findMany` across ALL businesses where the caller holds any membership and returns `totalRevenue`, `totalOverdueAmount`, `dealValue`, invoice/contact/booking counts, and dollar-amount insights with **zero per-business module-scope check** (recommended: enforce per-business `revenue:read` / `ai:read` filtering).
- **`SeoController` (all 12 GET routes)** — `SeoAdminGuard` (`modules/seo/seo-admin.guard.ts`) is only a `comingSoon` feature-flag rollout gate (`if (!status.exists || !status.comingSoon) return true;`), NOT a role or module-authority guard; once live, all 12 routes — including `getRevenueAttribution` (`revenue:read`) — are membership-only.
- **`KeyCortexAuditController` (`auditDecisions`, `auditValues`, `auditAssessment`, `auditAcceptance`)** — BUG-065 class: all 4 audit GET routes run only `AuthGuard` + `BusinessGuard` (recommended: `settings:admin`).
- **`KeystoreAdminController` (`getStats`, `getAllOrders`, `getOrder`)** — admin-prefixed controller mounted at `/keystore/admin/*` with only `AuthGuard` + `BusinessGuard` (no `AdminGuard`, no `ModuleScopeGuard`; recommended: `settings:admin`).
- **`FlowController.universalSearch` (`GET /api/flows/businesses/:businessId/search`)** — enforces `revenue:read` on invoices via `memberModuleLevel`, but still queries contacts, bookings, and projects without checking `crm:read`, `bookings:read`, or `projects:read`.
- **`PresenceController.getDraft` (`GET /site/presence/businesses/:businessId/draft`)** — returns `SitePageDraft.previewToken` to any business member without `content:read`.
- **`TrashController.listTrashed`** — carries an inert `@RequireModuleScope('settings')` (no `ModuleScopeGuard`), though its handler honestly enforces per-model module scope via `readAccess` + `readRefusal` (D-95).

## Summary

- Total `@Get` routes scanned in `apps/server/src`: **998**
- Member `@Get` routes (with `AuthGuard`, `BusinessGuard`, or `OptionalAuthGuard`): **919**
- Enforced-scope member `@Get` routes (`@RequireModuleScope` + `ModuleScopeGuard`): **318**
- Membership-only `@Get` routes (unenforced population): **601**
- Total rows pinned in this census: **607** (601 membership-only + 6 pinned enforced `applied`/`secret-read`)

| Disposition | Count |
| --- | ---: |
| applied | 3 |
| exempt-admin | 25 |
| exempt-check | 75 |
| exempt-guard | 6 |
| exempt-membership | 1 |
| exempt-own | 12 |
| exempt-owner | 1 |
| exempt-public | 4 |
| exempt-system | 10 |
| open | 441 |
| secret-read | 29 |

## Expected V1 Plan Rows & Pinned Applied Reads

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `CommerceController.listPaymentClaims` | GET | `/commerce/businesses/:businessId/claims` | applied | `revenue:write` — CLAIM-LOOP: enforced via `@RequireModuleScope('revenue', 'write')` + `ModuleScopeGuard` |
| `ReadyToSendController.listDue` | GET | `/commerce/businesses/:businessId/ready-to-send` | applied | service-check:listDue — READY-TO-SEND: per-member module-scoped ready-to-send queue; overdue invoices require `revenue:read` and tomorrow's bookings require `bookings:read` |
| `TodayController.getToday` | GET | `/business-command-center/businesses/:businessId/today` | applied | service-check:getToday — TODAY-AGGREGATE (D-57, D-96): per-member module-scoped Today aggregate; Pulse strictly requires `revenue:read`, overdue invoices require `revenue:read`/`revenue:write`, bookings require `bookings:read` |

## Secret-Bearing Reads (Reviewed & Stop-the-Line)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `AiController.getAiPreferences` | GET | `/ai/businesses/:businessId/ai/preferences` | secret-read | BYOK keys (`byokOpenai`, `byokAnthropic`, `byokXai`) masked as literal bullet placeholder in handler; `byokKimi`/`byokGoogle`/`byokNative` not returned; follow-up should gate on `settings:read` |
| `AiController.getAiProviders` | GET | `/ai/businesses/:businessId/ai/providers` | secret-read | reads preferences internally (`service-check:listSelectableProviders`) and returns only `usingOwnKey: boolean` and provider availability metadata; no key leaves the handler |
| `ApiKeysController.list` | GET | `/api/businesses/:businessId/api-keys` | secret-read | `settings:read` — name, prefix, and scopes only (raw key hashed and returned once at create) |
| `CommunicationsController.getConnection` | GET | `/communications/businesses/:businessId/connections/:id` | secret-read | `service-check:stripSecrets` removes tokens (SWEEP-P0 reviewed); follow-up should gate on `content:read` |
| `CommunicationsController.healthSummary` | GET | `/communications/businesses/:businessId/connections/health-summary` | secret-read | reads `channelConnection.findMany` (`service-check:getHealthSummary`) and maps to an explicit non-secret allowlist (`id`, `provider`, `label`, `healthState`, `healthMessage`, `lastCheckedAt`, destination counts); no tokens leave the handler; follow-up should gate on `content:read` |
| `CommunicationsController.listConnections` | GET | `/communications/businesses/:businessId/connections` | secret-read | `service-check:stripSecrets` removes tokens on every row (SWEEP-P0 reviewed); follow-up should gate on `content:read` |
| `CommunicationsController.listDestinations` | GET | `/communications/businesses/:businessId/destinations` | secret-read | `service-check:stripSecretsFromDestination` removes page access tokens and credential keys from `destinationMeta` (SWEEP-P0 CW-2); follow-up should gate on `content:read` |
| `ConnectorController.getCredentials` | GET | `/connectors/businesses/:businessId/credentials/:type` | secret-read | secret fields answered masked (`check:getMaskedCredentials`, last 4 chars only); form schema stays readable by members (SWEEP-P0 reviewed) |
| `ConnectorController.getWebhookInfo` | GET | `/connectors/businesses/:businessId/webhook-info/:type` | secret-read | `settings:admin` — returns inbound form webhook signing secret (SWEEP-P0 SEC-1) |
| `FinanceController.getBankConnection` | GET | `/finance/businesses/:businessId/bank-connections/:id` | secret-read | `service-check:strip` (`BankConnectionService.strip`) removes `accessToken` on the row; follow-up should gate on `revenue:read` |
| `FinanceController.listBankConnections` | GET | `/finance/businesses/:businessId/bank-connections` | secret-read | `service-check:strip` (`BankConnectionService.strip`) removes `accessToken` on every row (SWEEP-P0 reviewed); follow-up should gate on `revenue:read` |
| `IntegrationHubController.getDashboard` | GET | `/integration-hub/businesses/:businessId/dashboard` | secret-read | `connect:read` — STOP-THE-LINE FINDING (enforced route returns unredacted secrets): `IntegrationHubService.getDashboard` returns raw `IntegrationConnection` rows including `authData` and `authDataRef` without stripping (unlike `KeyConnectorController.getConnections` which uses `connectionView`); immediate P0 fix needed to strip `authData`/`authDataRef` |
| `KeyConnectorController.getConnections` | GET | `/key-connector/connections` | secret-read | `check:connectionView` strips `authData` and `authDataRef` before returning (SWEEP-P0 reviewed); follow-up should gate on `connect:read` |
| `KeyConnectorController.getProviderDetail` | GET | `/key-connector/providers/:key` | secret-read | `check:connectionView` strips `authData` and `authDataRef` before returning; follow-up should gate on `connect:read` |
| `KeyConnectorController.getProviders` | GET | `/key-connector/providers` | secret-read | `check:connectionView` strips `authData` and `authDataRef` before returning; follow-up should gate on `connect:read` |
| `MarketplaceController.getOrderToken` | GET | `/marketplace/businesses/:businessId/orders/:orderId/token` | secret-read | returns app-issued customer order-tracking link token (`token`), answered to members by design (SWEEP-P0 reviewed); follow-up may narrow to `storefront:read` |
| `PortalController.listAccess` | GET | `/portal/businesses/:businessId/access` | secret-read | STOP-THE-LINE FINDING (unprotected secret read): membership-only (`AuthGuard`, `BusinessGuard`, `RateLimitGuard`, no scope); `PortalService.list` returns raw `PortalAccess` rows including live 32-byte hex bearer `token`s without `portalAccessView` redaction — any STAFF with `crm:none`/`revenue:none` can harvest client portal tokens and open contacts' invoices, projects, and bookings without logging in; immediate P0 fix needed (`crm:read` + redact `token` via `portalAccessView` below `crm:write`) |
| `PresenceController.getDraft` | GET | `/site/presence/businesses/:businessId/draft` | secret-read | returns `SitePageDraft.previewToken` (app-issued unpublished site draft preview link token) to any business member without scope; follow-up should gate on `content:read` |
| `SocialController.listConnections` | GET | `/social/businesses/:businessId/connections` | secret-read | OAuth `token` and `refreshToken` stripped from every row (`service-check:listConnections`; SWEEP-P0 `CEN-SOC-01`) |
| `SocialController.oauthAvailability` | GET | `/social/businesses/:businessId/connections/oauth-availability` | secret-read | reads `getPlatformCredentials` internally and returns only `Record<platform, boolean>` availability flags; no secret leaves the handler |
| `SocialController.recentPosts` | GET | `/social/businesses/:businessId/recent-posts` | secret-read | reads `socialConnection.findMany` internally (`service-check:fetchRecentExternalPosts`) to fetch recent external posts and returns only external post summaries; no OAuth token leaves the handler; follow-up should gate on `content:read` |
| `SupplierController.getConnection` | GET | `/supplier/businesses/:businessId/connections/:connectionId` | secret-read | credentials stripped (`service-check:getSupplierConnection`; SWEEP-P0 reviewed); follow-up should gate on `storefront:read` |
| `SupplierController.getConnections` | GET | `/supplier/businesses/:businessId/connections` | secret-read | credentials stripped from every row (`service-check:getSupplierConnections`; SWEEP-P0 reviewed); follow-up should gate on `storefront:read` |
| `SupplierController.getProductSourceLinks` | GET | `/supplier/businesses/:businessId/products/:productId/source-links` | secret-read | STOP-THE-LINE FINDING (unstripped nested include): `SupplierService.getProductSourceLinks` uses nested `include: { supplierProduct: { include: { supplierConnection: true } } }`, serializing raw `SupplierConnection.credentials` (`enc:v1:...`) to any business member without scope; tracked in `FU-SUPPLIER-CREDENTIALS-NESTED-INCLUDE` (`storefront:read` + explicit non-secret `select:`) |
| `SupplierController.getSupplierProduct` | GET | `/supplier/businesses/:businessId/supplier-products/:supplierProductId` | secret-read | STOP-THE-LINE FINDING (unstripped nested include): `SupplierService.getSupplierProduct` uses `include: { supplierConnection: true }`, serializing raw `SupplierConnection.credentials` (`enc:v1:...`) to any business member without scope; tracked in `FU-SUPPLIER-CREDENTIALS-NESTED-INCLUDE` (`storefront:read` + explicit non-secret `select:`) |
| `SupplierController.getSupplierProducts` | GET | `/supplier/businesses/:businessId/connections/:connectionId/products` | secret-read | reads `supplierConnection.findFirst` solely to verify tenant ownership (`service-check:getSupplierProducts`) before querying `supplierProduct`; no supplier credentials leave the handler; follow-up should gate on `storefront:read` |
| `WebhooksController.deliveries` | GET | `/webhooks/businesses/:businessId/webhooks/:webhookId/deliveries` | secret-read | `settings:read` — receiver URL origin-only below `settings:write` (SEC-3) or for readers who may not receive the webhook's events (SV-5) |
| `WebhooksController.list` | GET | `/webhooks/businesses/:businessId/webhooks` | secret-read | `settings:read` — signing secret selected for settings admin only (CR-5) and per-webhook event-read check (SV-5); receiver URL origin-only below `settings:write` (SEC-3) |
| `WhatsAppController.getConfig` | GET | `/whatsapp/businesses/:businessId/config` | secret-read | tokens masked via `WhatsAppService.getConfigView` with `check:isConfigOwner` (R0-SEC2, `whatsapp-config-authority`) |

## Remaining Membership-Only GET Routes by Controller

### `core/connectors/connector.controller.ts` (7)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `ConnectorController.getDashboard` | GET | `/connectors/businesses/:businessId/dashboard` | open | follow-up: `settings:read` (membership-only read; no enforced module scope) |
| `ConnectorController.getHealth` | GET | `/connectors/businesses/:businessId/health/:type` | open | follow-up: `settings:read` (membership-only read; no enforced module scope) |
| `ConnectorController.getInboxConfig` | GET | `/connectors/businesses/:businessId/inbox-config/:type` | open | follow-up: `settings:read` (membership-only read; no enforced module scope) |
| `ConnectorController.getStatuses` | GET | `/connectors/businesses/:businessId/statuses` | open | follow-up: `settings:read` (membership-only read; no enforced module scope) |
| `ConnectorController.listActivity` | GET | `/connectors/businesses/:businessId/activity` | open | follow-up: `settings:read` (membership-only read; no enforced module scope) |
| `ConnectorController.listConnectors` | GET | `/connectors/businesses/:businessId/list` | exempt-system | static connector registry metadata catalog; reads no tenant records or credentials |
| `ConnectorController.needsAttention` | GET | `/connectors/businesses/:businessId/needs-attention` | open | follow-up: `settings:read` (membership-only read; no enforced module scope) |

### `modules/admin-analytics/admin-analytics.controller.ts` (8)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `AdminAnalyticsController.getActivationFunnel` | GET | `/api/admin/analytics/activation-funnel` | exempt-admin | guard:AdminGuard (platform super-admin read, not a business member route) |
| `AdminAnalyticsController.getFeatureUsage` | GET | `/api/admin/analytics/feature-usage` | exempt-admin | guard:AdminGuard (platform super-admin read, not a business member route) |
| `AdminAnalyticsController.getFeedbackInbox` | GET | `/api/admin/analytics/feedback-inbox` | exempt-admin | guard:AdminGuard (platform super-admin read, not a business member route) |
| `AdminAnalyticsController.getIntegrationHealth` | GET | `/api/admin/analytics/integration-health` | exempt-admin | guard:AdminGuard (platform super-admin read, not a business member route) |
| `AdminAnalyticsController.getKeyQuality` | GET | `/api/admin/analytics/key-quality` | exempt-admin | guard:AdminGuard (platform super-admin read, not a business member route) |
| `AdminAnalyticsController.getOverview` | GET | `/api/admin/analytics/overview` | exempt-admin | guard:AdminGuard (platform super-admin read, not a business member route) |
| `AdminAnalyticsController.getRecentEvents` | GET | `/api/admin/analytics/recent-events` | exempt-admin | guard:AdminGuard (platform super-admin read, not a business member route) |
| `AdminAnalyticsController.getRoadmapInsights` | GET | `/api/admin/analytics/roadmap-insights` | exempt-admin | guard:AdminGuard (platform super-admin read, not a business member route) |

### `modules/admin-platform/admin-business.controller.ts` (1)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `AdminBusinessController.listBusinesses` | GET | `/api/admin/businesses` | exempt-admin | guard:AdminGuard (platform super-admin read, not a business member route) |

### `modules/admin-platform/admin-event.controller.ts` (1)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `AdminEventController.listEvents` | GET | `/api/admin/events` | exempt-admin | guard:AdminGuard (platform super-admin read, not a business member route) |

### `modules/admin-platform/admin-user.controller.ts` (1)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `AdminUserController.listUsers` | GET | `/api/admin/users` | exempt-admin | guard:AdminGuard (platform super-admin read, not a business member route) |

### `modules/ai/agent.controller.ts` (10)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `AgentController.checkCalendarAvailability` | GET | `/ai/businesses/:businessId/agent/calendar/availability` | open | follow-up: `bookings:read` (agent calendar availability read currently membership-only) |
| `AgentController.findCalendarSlots` | GET | `/ai/businesses/:businessId/agent/calendar/slots` | open | follow-up: `bookings:read` (agent calendar availability read currently membership-only) |
| `AgentController.getActiveAgentStates` | GET | `/ai/businesses/:businessId/agent/states` | open | follow-up: `ai:read` (membership-only read; no enforced module scope) |
| `AgentController.getAgentMessages` | GET | `/ai/businesses/:businessId/agent/messages` | open | follow-up: `ai:read` (membership-only read; no enforced module scope) |
| `AgentController.getAgentState` | GET | `/ai/businesses/:businessId/agent/states/:planId` | open | follow-up: `ai:read` (membership-only read; no enforced module scope) |
| `AgentController.getAgentTriggers` | GET | `/ai/businesses/:businessId/agent/triggers` | open | follow-up: `ai:read` (membership-only read; no enforced module scope) |
| `AgentController.getDetectedPatterns` | GET | `/ai/businesses/:businessId/agent/patterns` | open | follow-up: `ai:read` (membership-only read; no enforced module scope) |
| `AgentController.getQueueStats` | GET | `/ai/businesses/:businessId/agent/queue/stats` | open | follow-up: `ai:read` (membership-only read; no enforced module scope) |
| `AgentController.getUndoableActions` | GET | `/ai/businesses/:businessId/agent/undo` | open | follow-up: `ai:read` (membership-only read; no enforced module scope) |
| `AgentController.searchSemanticMemory` | GET | `/ai/businesses/:businessId/agent/memory/search` | open | follow-up: `ai:read` (membership-only read; no enforced module scope) |

### `modules/ai/ai-intelligence.controller.ts` (1)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `AiIntelligenceController.getCrossBusinessIntelligence` | GET | `/ai/intelligence/cross-business` | open | follow-up: `revenue:read` and `ai:read` (HIGH-PRIORITY: queries `membership.findMany` across ALL businesses where caller holds any membership and returns `totalRevenue`, `totalOverdueAmount`, `dealValue`, invoice/contact/booking counts, and dollar-amount insights with zero per-business module-scope check) |

### `modules/ai/ai-usage-admin.controller.ts` (6)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `AiUsageAdminController.businessAlerts` | GET | `/api/admin/ai-usage/businesses/:businessId/alerts` | exempt-admin | guard:AdminGuard (platform super-admin read, not a business member route) |
| `AiUsageAdminController.businessHistory` | GET | `/api/admin/ai-usage/businesses/:businessId/history` | exempt-admin | guard:AdminGuard (platform super-admin read, not a business member route) |
| `AiUsageAdminController.businessSummary` | GET | `/api/admin/ai-usage/businesses/:businessId/summary` | exempt-admin | guard:AdminGuard (platform super-admin read, not a business member route) |
| `AiUsageAdminController.health` | GET | `/api/admin/ai-usage/health` | exempt-admin | guard:AdminGuard (platform super-admin read, not a business member route) |
| `AiUsageAdminController.platformAlerts` | GET | `/api/admin/ai-usage/platform-alerts` | exempt-admin | guard:AdminGuard (platform super-admin read, not a business member route) |
| `AiUsageAdminController.platformSummary` | GET | `/api/admin/ai-usage/platform-summary` | exempt-admin | guard:AdminGuard (platform super-admin read, not a business member route) |

### `modules/ai/ai.controller.ts` (55)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `AiController.automationCoverage` | GET | `/ai/businesses/:businessId/ai/automation-coverage` | open | follow-up: `ai:read` (membership-only read; no enforced module scope) |
| `AiController.briefing` | GET | `/ai/businesses/:businessId/ai/briefing` | open | follow-up: `ai:read` (membership-only read; no enforced module scope) |
| `AiController.controlTower` | GET | `/ai/businesses/:businessId/ai/control-tower` | open | follow-up: `ai:read` (membership-only read; no enforced module scope) |
| `AiController.crossModuleLinks` | GET | `/ai/businesses/:businessId/ai/cross-module-links` | open | follow-up: `ai:read` (membership-only read; no enforced module scope) |
| `AiController.endOfDayBriefing` | GET | `/ai/businesses/:businessId/briefing/eod` | open | follow-up: `ai:read` (membership-only read; no enforced module scope) |
| `AiController.getAgentConfig` | GET | `/ai/businesses/:businessId/ai/agent-config` | open | follow-up: `ai:read` (membership-only read; no enforced module scope) |
| `AiController.getAgentHealth` | GET | `/ai/businesses/:businessId/ai/health` | open | follow-up: `ai:read` (membership-only read; no enforced module scope) |
| `AiController.getApprovalHistory` | GET | `/ai/businesses/:businessId/ai/approvals/history` | exempt-check | check:listForReader filters AI approval history by the caller's module scopes |
| `AiController.getAutopilotRules` | GET | `/ai/businesses/:businessId/autopilot-rules` | open | follow-up: `ai:read` (membership-only read; no enforced module scope) |
| `AiController.getBilling` | GET | `/ai/businesses/:businessId/ai/billing` | open | follow-up: `ai:read` (membership-only read; no enforced module scope) |
| `AiController.getBriefing` | GET | `/ai/businesses/:businessId/briefing` | open | follow-up: `ai:read` (membership-only read; no enforced module scope) |
| `AiController.getBudgetStatus` | GET | `/ai/businesses/:businessId/ai/budget-status` | open | follow-up: `ai:read` (membership-only read; no enforced module scope) |
| `AiController.getBusinessGraph` | GET | `/ai/businesses/:businessId/ai/graph` | open | follow-up: `ai:read` (membership-only read; no enforced module scope) |
| `AiController.getBusinessPlan` | GET | `/ai/businesses/:businessId/ai/business-plan` | open | follow-up: `ai:read` (membership-only read; no enforced module scope) |
| `AiController.getBusinessPlanHistory` | GET | `/ai/businesses/:businessId/ai/business-plan/history` | open | follow-up: `ai:read` (membership-only read; no enforced module scope) |
| `AiController.getCapacityAlerts` | GET | `/ai/businesses/:businessId/ai/capacity-alerts` | open | follow-up: `ai:read` (membership-only read; no enforced module scope) |
| `AiController.getCredits` | GET | `/ai/businesses/:businessId/ai/credits` | open | follow-up: `ai:read` (membership-only read; no enforced module scope) |
| `AiController.getExecutionLogs` | GET | `/ai/businesses/:businessId/ai/execution-logs` | open | follow-up: `ai:read` (membership-only read; no enforced module scope) |
| `AiController.getExecutionStats` | GET | `/ai/businesses/:businessId/ai/execution-stats` | open | follow-up: `ai:read` (membership-only read; no enforced module scope) |
| `AiController.getGoal` | GET | `/ai/businesses/:businessId/goals/:goalId` | open | follow-up: `ai:read` (membership-only read; no enforced module scope) |
| `AiController.getGovernanceSettings` | GET | `/ai/businesses/:businessId/ai/governance` | open | follow-up: `ai:read` (membership-only read; no enforced module scope) |
| `AiController.getInbox` | GET | `/ai/businesses/:businessId/inbox` | open | follow-up: `ai:read` (membership-only read; no enforced module scope) |
| `AiController.getJourneyInstance` | GET | `/ai/businesses/:businessId/journeys/:instanceId` | open | follow-up: `ai:read` (membership-only read; no enforced module scope) |
| `AiController.getMemory` | GET | `/ai/businesses/:businessId/ai/memory` | exempt-check | check:readsDocumentExtractions withholds document extractions below `revenue:read`; `AiMemoryService` excludes `settings` category rows (SEC-FUMCR-2) |
| `AiController.getMemoryContext` | GET | `/ai/businesses/:businessId/ai/memory/context` | open | follow-up: `ai:read` (membership-only read; no enforced module scope) |
| `AiController.getPendingApprovals` | GET | `/ai/businesses/:businessId/ai/approvals` | exempt-check | check:listForReader filters pending AI approvals by the caller's module scopes |
| `AiController.getPlan` | GET | `/ai/businesses/:businessId/ai/plans/:planId` | open | follow-up: `ai:read` (membership-only read; no enforced module scope) |
| `AiController.getPriorities` | GET | `/ai/businesses/:businessId/ai/priorities` | open | follow-up: `ai:read` (membership-only read; no enforced module scope) |
| `AiController.getProviderHealth` | GET | `/ai/businesses/:businessId/ai/provider-health` | open | follow-up: `ai:read` (membership-only read; no enforced module scope) |
| `AiController.getProviderStats` | GET | `/ai/businesses/:businessId/ai/provider-stats` | open | follow-up: `ai:read` (membership-only read; no enforced module scope) |
| `AiController.getRoutingConfig` | GET | `/ai/businesses/:businessId/ai/routing-config` | open | follow-up: `ai:read` (membership-only read; no enforced module scope) |
| `AiController.getSuggestions` | GET | `/ai/businesses/:businessId/ai/suggestions` | open | follow-up: `ai:read` (membership-only read; no enforced module scope) |
| `AiController.getThread` | GET | `/ai/businesses/:businessId/inbox/:threadId` | open | follow-up: `ai:read` (membership-only read; no enforced module scope) |
| `AiController.getUsageHistory` | GET | `/ai/businesses/:businessId/ai/usage/history` | open | follow-up: `ai:read` (membership-only read; no enforced module scope) |
| `AiController.getUsageSummary` | GET | `/ai/businesses/:businessId/ai/usage` | open | follow-up: `ai:read` (membership-only read; no enforced module scope) |
| `AiController.getWorkload` | GET | `/ai/businesses/:businessId/ai/workload` | open | follow-up: `ai:read` (membership-only read; no enforced module scope) |
| `AiController.listGoals` | GET | `/ai/businesses/:businessId/goals` | open | follow-up: `ai:read` (membership-only read; no enforced module scope) |
| `AiController.listJourneys` | GET | `/ai/businesses/:businessId/journeys` | open | follow-up: `ai:read` (membership-only read; no enforced module scope) |
| `AiController.listKeyCommands` | GET | `/ai/businesses/:businessId/key/commands` | open | follow-up: `ai:read` (membership-only read; no enforced module scope) |
| `AiController.listPlans` | GET | `/ai/businesses/:businessId/ai/plans` | open | follow-up: `ai:read` (membership-only read; no enforced module scope) |
| `AiController.listWorkflows` | GET | `/ai/businesses/:businessId/ai/workflows` | open | follow-up: `ai:read` (membership-only read; no enforced module scope) |
| `AiController.monitoringInsights` | GET | `/ai/businesses/:businessId/ai/monitoring/insights` | open | follow-up: `ai:read` (membership-only read; no enforced module scope) |
| `AiController.morningBriefing` | GET | `/ai/businesses/:businessId/briefing/morning` | exempt-check | check:readsRevenue withholds revenue figures below `revenue:read` |
| `AiController.opportunities` | GET | `/ai/businesses/:businessId/ai/strategic/opportunities` | open | follow-up: `revenue:read` (AI strategic/financial read currently membership-only) |
| `AiController.pricingAdvisor` | GET | `/ai/businesses/:businessId/ai/strategic/pricing-advisor` | open | follow-up: `revenue:read` (AI strategic/financial read currently membership-only) |
| `AiController.profileStatus` | GET | `/ai/businesses/:businessId/ai/profile/status` | exempt-check | check:readsDocumentExtractions withholds document extraction profile counts below `revenue:read` |
| `AiController.profitability` | GET | `/ai/businesses/:businessId/ai/strategic/profitability` | open | follow-up: `revenue:read` (AI strategic/financial read currently membership-only) |
| `AiController.revenueForecast` | GET | `/ai/businesses/:businessId/ai/strategic/revenue-forecast` | open | follow-up: `revenue:read` (AI strategic/financial read currently membership-only) |
| `AiController.risks` | GET | `/ai/businesses/:businessId/ai/strategic/risks` | open | follow-up: `revenue:read` (AI strategic/financial read currently membership-only) |
| `AiController.seasonalPatterns` | GET | `/ai/businesses/:businessId/ai/strategic/seasonal-patterns` | open | follow-up: `revenue:read` (AI strategic/financial read currently membership-only) |
| `AiController.strategicActions` | GET | `/ai/businesses/:businessId/ai/strategic/actions` | open | follow-up: `revenue:read` (AI strategic/financial read currently membership-only) |
| `AiController.strategicDashboard` | GET | `/ai/businesses/:businessId/ai/strategic/dashboard` | open | follow-up: `revenue:read` (AI strategic/financial read currently membership-only) |
| `AiController.suggestGoalActions` | GET | `/ai/businesses/:businessId/goals/:goalId/actions` | open | follow-up: `ai:read` (membership-only read; no enforced module scope) |
| `AiController.weeklyPlan` | GET | `/ai/businesses/:businessId/ai/strategic/weekly-plan` | open | follow-up: `revenue:read` (AI strategic/financial read currently membership-only) |
| `AiController.workspaceRecommendations` | GET | `/ai/businesses/:businessId/ai/workspace-recommendations` | open | follow-up: `ai:read` (membership-only read; no enforced module scope) |

### `modules/ai/blueprint-onboarding.controller.ts` (1)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `BlueprintOnboardingController.onboardingHistory` | GET | `/blueprint/businesses/:businessId/onboarding-history` | exempt-own | caller's own blueprint onboarding conversation history scoped to `actorId(user)` |

### `modules/ai/flow.controller.ts` (1)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `AiFlowController.listSessions` | GET | `/ai/businesses/:businessId/flow/sessions` | exempt-own | caller's own KEY chat sessions scoped to `user?.id` (D-119, D-131) |

### `modules/ai/graph-actions.controller.ts` (3)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `GraphActionsController.getActionQueue` | GET | `/actions/businesses/:businessId/queue` | open | follow-up: `ai:read` (membership-only read; no enforced module scope) |
| `GraphActionsController.getAutopilotCoverage` | GET | `/autopilot/businesses/:businessId/coverage` | open | follow-up: `ai:read` (membership-only read; no enforced module scope) |
| `GraphActionsController.getGraph` | GET | `/graph/business/:businessId` | open | follow-up: `ai:read` (membership-only read; no enforced module scope) |

### `modules/ai/output-template.controller.ts` (3)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `OutputTemplateController.getOne` | GET | `/api/ai/businesses/:businessId/output-templates/:id` | open | follow-up: `ai:read` (membership-only read; no enforced module scope) |
| `OutputTemplateController.getOptions` | GET | `/api/ai/businesses/:businessId/output-templates/options` | exempt-system | static valid output-template option definitions; reads no tenant records |
| `OutputTemplateController.list` | GET | `/api/ai/businesses/:businessId/output-templates` | open | follow-up: `ai:read` (membership-only read; no enforced module scope) |

### `modules/approvals/approval.controller.ts` (3)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `ApprovalController.getById` | GET | `/businesses/:businessId/approvals/:approvalId` | open | follow-up: `operations:read` (membership-only read; no enforced module scope) |
| `ApprovalController.list` | GET | `/businesses/:businessId/approvals` | open | follow-up: `operations:read` (membership-only read; no enforced module scope) |
| `ApprovalController.pendingForMe` | GET | `/businesses/:businessId/approvals/pending-for-me` | exempt-own | approvals specifically pending for the authenticated caller (`principalOf(req)`) |

### `modules/automation/automation.controller.ts` (1)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `AutomationController.listPlaybooks` | GET | `/automation/businesses/:businessId/playbooks` | open | follow-up: `automations:read` (membership-only read; no enforced module scope) |

### `modules/autopilot/autopilot.controller.ts` (7)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `AutopilotController.getAllTasks` | GET | `/autopilot/businesses/:businessId/tasks` | open | follow-up: `automations:read` (membership-only read; no enforced module scope) |
| `AutopilotController.getCriticalAlerts` | GET | `/autopilot/businesses/:businessId/alerts` | open | follow-up: `automations:read` (membership-only read; no enforced module scope) |
| `AutopilotController.getLoopRuns` | GET | `/autopilot/businesses/:businessId/loops/:loopId/runs` | open | follow-up: `automations:read` (membership-only read; no enforced module scope) |
| `AutopilotController.getLoops` | GET | `/autopilot/businesses/:businessId/loops` | open | follow-up: `automations:read` (membership-only read; no enforced module scope) |
| `AutopilotController.getSettings` | GET | `/autopilot/businesses/:businessId/settings` | open | follow-up: `automations:read` (membership-only read; no enforced module scope) |
| `AutopilotController.getTaskStats` | GET | `/autopilot/businesses/:businessId/stats` | open | follow-up: `automations:read` (membership-only read; no enforced module scope) |
| `AutopilotController.getTodaysTasks` | GET | `/autopilot/businesses/:businessId/tasks/today` | open | follow-up: `automations:read` (membership-only read; no enforced module scope) |

### `modules/blueprint/blueprint.controller.ts` (8)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `BlueprintController.get` | GET | `/blueprint/businesses/:businessId` | exempt-check | check:readsRevenue withholds financial/revenue sections or figures below `revenue:read` |
| `BlueprintController.getConstitution` | GET | `/blueprint/businesses/:businessId/genome/constitution` | exempt-check | check:readsRevenue withholds financial/revenue sections or figures below `revenue:read` |
| `BlueprintController.getGenome` | GET | `/blueprint/businesses/:businessId/genome` | exempt-check | check:readsRevenue withholds financial/revenue sections or figures below `revenue:read` |
| `BlueprintController.getGenomeRecommendations` | GET | `/blueprint/businesses/:businessId/genome/recommendations` | exempt-check | check:readsRevenue withholds financial/revenue sections or figures below `revenue:read` |
| `BlueprintController.getIntegrity` | GET | `/blueprint/businesses/:businessId/genome/integrity` | exempt-check | check:readsRevenue withholds financial/revenue sections or figures below `revenue:read` |
| `BlueprintController.getThreePillarStatus` | GET | `/blueprint/businesses/:businessId/genome/three-pillar-status` | exempt-check | check:readsRevenue withholds financial/revenue sections or figures below `revenue:read` |
| `BlueprintController.recommendations` | GET | `/blueprint/businesses/:businessId/recommendations` | exempt-check | check:readsRevenue withholds financial/revenue sections or figures below `revenue:read` |
| `BlueprintController.setupSteps` | GET | `/blueprint/businesses/:businessId/setup-steps` | exempt-check | check:readsRevenue withholds financial/revenue sections or figures below `revenue:read` |

### `modules/bookings/bookings.controller.ts` (17)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `BookingsController.getBookingStats` | GET | `/bookings/businesses/:businessId/stats` | open | follow-up: `bookings:read` (membership-only read; no enforced module scope) |
| `BookingsController.getCalendarAuthUrl` | GET | `/bookings/businesses/:businessId/calendar/auth-url` | exempt-check | check:assertGoogleConnectOwner (Google Calendar OAuth consent start is owner-only, D-99) |
| `BookingsController.getCalendarStatus` | GET | `/bookings/businesses/:businessId/calendar/status` | open | follow-up: `bookings:read` (membership-only read; no enforced module scope) |
| `BookingsController.getNoShowRisks` | GET | `/bookings/businesses/:businessId/optimizer/no-show-risks` | open | follow-up: `bookings:read` (membership-only read; no enforced module scope) |
| `BookingsController.getRebookingSuggestions` | GET | `/bookings/businesses/:businessId/optimizer/rebooking-suggestions` | open | follow-up: `bookings:read` (membership-only read; no enforced module scope) |
| `BookingsController.getReminderSettings` | GET | `/bookings/businesses/:businessId/reminder-settings` | open | follow-up: `bookings:read` (membership-only read; no enforced module scope) |
| `BookingsController.getScheduleHealth` | GET | `/bookings/businesses/:businessId/optimizer/schedule-health` | open | follow-up: `bookings:read` (membership-only read; no enforced module scope) |
| `BookingsController.getUpcomingReminders` | GET | `/bookings/businesses/:businessId/optimizer/reminders` | open | follow-up: `bookings:read` (membership-only read; no enforced module scope) |
| `BookingsController.listAvailableCalendars` | GET | `/bookings/businesses/:businessId/calendar/list` | exempt-check | check:assertCalendarNamesReader (requires calendar/bookings read authority) |
| `BookingsController.listBookings` | GET | `/bookings/businesses/:businessId` | open | follow-up: `bookings:read` (membership-only read; no enforced module scope) |
| `BookingsController.listCalendarConflicts` | GET | `/bookings/businesses/:businessId/calendar/conflicts` | open | follow-up: `bookings:read` (membership-only read; no enforced module scope) |
| `BookingsController.listCalendarEvents` | GET | `/bookings/businesses/:businessId/calendar/events` | open | follow-up: `bookings:read` (membership-only read; no enforced module scope) |
| `BookingsController.listServices` | GET | `/bookings/businesses/:businessId/services` | open | follow-up: `bookings:read` (membership-only read; no enforced module scope) |
| `BookingsController.listStaff` | GET | `/bookings/businesses/:businessId/staff` | open | follow-up: `bookings:read` (membership-only read; no enforced module scope) |
| `BookingsController.listStaffAvailability` | GET | `/bookings/businesses/:businessId/staff/:staffId/availability` | open | follow-up: `bookings:read` (membership-only read; no enforced module scope) |
| `BookingsController.listWaitlist` | GET | `/bookings/businesses/:businessId/waitlist` | open | follow-up: `bookings:read` (membership-only read; no enforced module scope) |
| `BookingsController.previewWaitlistMatches` | GET | `/bookings/businesses/:businessId/waitlist/matches` | open | follow-up: `bookings:read` (membership-only read; no enforced module scope) |

### `modules/business-assets/business-assets.controller.ts` (2)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `BusinessAssetsController.list` | GET | `/businesses/:businessId/business-assets` | open | follow-up: `settings:read` (membership-only read; no enforced module scope) |
| `BusinessAssetsController.summary` | GET | `/businesses/:businessId/business-assets/summary` | open | follow-up: `settings:read` (membership-only read; no enforced module scope) |

### `modules/business-command-center/business-command-center.controller.ts` (1)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `BusinessCommandCenterController.snapshot` | GET | `/business-command-center/businesses/:businessId/snapshot` | exempt-check | service-check:snapshot filters command center snapshot and KEY proposals per authenticated reader (D-238) |

### `modules/business-genesis/business-genesis.controller.ts` (4)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `BusinessGenesisController.getDocumentPack` | GET | `/business-genesis/businesses/:businessId/document-pack` | open | follow-up: `settings:read` (membership-only read; no enforced module scope) |
| `BusinessGenesisController.getMarketStrategy` | GET | `/business-genesis/businesses/:businessId/market-strategy` | open | follow-up: `settings:read` (membership-only read; no enforced module scope) |
| `BusinessGenesisController.nextQuestions` | GET | `/business-genesis/businesses/:businessId/questions/next` | open | follow-up: `settings:read` (membership-only read; no enforced module scope) |
| `BusinessGenesisController.readiness` | GET | `/business-genesis/businesses/:businessId/readiness` | open | follow-up: `settings:read` (membership-only read; no enforced module scope) |

### `modules/business-genesis/genome-chat.controller.ts` (1)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `GenomeChatController.getMessages` | GET | `/genome-chat/businesses/:businessId/messages` | exempt-check | check:readsRevenue withholds financial/revenue sections or figures below `revenue:read` |

### `modules/business-genome/constitution-version.controller.ts` (4)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `ConstitutionVersionController.latest` | GET | `/business-genome/businesses/:businessId/constitution/latest` | exempt-check | check:readsRevenue withholds financial/revenue sections or figures below `revenue:read` |
| `ConstitutionVersionController.staleness` | GET | `/business-genome/businesses/:businessId/constitution/staleness` | exempt-check | check:readsRevenue withholds financial/revenue sections or figures below `revenue:read` |
| `ConstitutionVersionController.version` | GET | `/business-genome/businesses/:businessId/constitution/versions/:version` | exempt-check | check:readsRevenue withholds financial/revenue sections or figures below `revenue:read` |
| `ConstitutionVersionController.versions` | GET | `/business-genome/businesses/:businessId/constitution/versions` | exempt-check | check:readsRevenue withholds financial/revenue sections or figures below `revenue:read` |

### `modules/business-genome/document-pack/genome-document-pack.controller.ts` (3)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `GenomeDocumentPackController.exportConstitution` | GET | `/business-genome/businesses/:businessId/document-pack/constitution/export` | exempt-check | service-check:genomeReaderReadsRevenue filters financial/revenue sections below `revenue:read` |
| `GenomeDocumentPackController.exportDnaReport` | GET | `/business-genome/businesses/:businessId/document-pack/dna/export` | exempt-check | service-check:genomeReaderReadsRevenue filters financial/revenue sections below `revenue:read` |
| `GenomeDocumentPackController.exportExecutiveBrief` | GET | `/business-genome/businesses/:businessId/document-pack/executive-brief/export` | exempt-check | service-check:genomeReaderReadsRevenue filters financial/revenue sections below `revenue:read` |

### `modules/business-genome/genome-evolution.controller.ts` (1)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `GenomeEvolutionController.list` | GET | `/business-genome/businesses/:businessId/evolution-proposals` | open | follow-up: `ai:read` (membership-only read; no enforced module scope) |

### `modules/business-genome/key-genome/key-genome.controller.ts` (24)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `KeyGenomeController.departmentsSummary` | GET | `/business-genome/businesses/:businessId/key-genome/departments/summary` | open | follow-up: `ai:read` (membership-only read; no enforced module scope) |
| `KeyGenomeController.findSimilarMemory` | GET | `/business-genome/businesses/:businessId/key-genome/memory/similar` | exempt-check | check:readsRevenue withholds financial/revenue sections or figures below `revenue:read` |
| `KeyGenomeController.get` | GET | `/business-genome/businesses/:businessId/key-genome/signals/:signalId` | exempt-check | check:requireRevenue enforces `revenue:read` on financial items (D-128) |
| `KeyGenomeController.getDepartment` | GET | `/business-genome/businesses/:businessId/key-genome/departments/:code` | open | follow-up: `ai:read` (membership-only read; no enforced module scope) |
| `KeyGenomeController.getExperiment` | GET | `/business-genome/businesses/:businessId/key-genome/experiments/:experimentId` | open | follow-up: `ai:read` (membership-only read; no enforced module scope) |
| `KeyGenomeController.getMarketingGrowthSnapshot` | GET | `/business-genome/businesses/:businessId/key-genome/marketing-growth/snapshot` | exempt-check | check:readsRevenue withholds financial/revenue sections or figures below `revenue:read` |
| `KeyGenomeController.getMemoryEvent` | GET | `/business-genome/businesses/:businessId/key-genome/memory/:memoryEventId` | exempt-check | check:requireRevenue enforces `revenue:read` on financial items (D-128) |
| `KeyGenomeController.getOperationsSnapshot` | GET | `/business-genome/businesses/:businessId/key-genome/operations/snapshot` | open | follow-up: `ai:read` (membership-only read; no enforced module scope) |
| `KeyGenomeController.getOutcomeLearningWindow` | GET | `/business-genome/businesses/:businessId/key-genome/outcome-windows/:domain` | open | follow-up: `ai:read` (membership-only read; no enforced module scope) |
| `KeyGenomeController.getRecommendation` | GET | `/business-genome/businesses/:businessId/key-genome/recommendations/:recommendationId` | exempt-check | check:requireRevenue enforces `revenue:read` on financial items (D-128) |
| `KeyGenomeController.getRecommendationExecutionStatus` | GET | `/business-genome/businesses/:businessId/key-genome/recommendations/:recommendationId/execution-status` | exempt-check | check:requireRevenue and check:readsRevenue enforce `revenue:read` on financial items (D-128) |
| `KeyGenomeController.governance` | GET | `/business-genome/businesses/:businessId/key-genome/governance` | exempt-check | check:readsRevenue withholds financial/revenue sections or figures below `revenue:read` |
| `KeyGenomeController.governanceQueue` | GET | `/business-genome/businesses/:businessId/key-genome/governance/queue` | exempt-check | check:readsRevenue withholds financial/revenue sections or figures below `revenue:read` |
| `KeyGenomeController.list` | GET | `/business-genome/businesses/:businessId/key-genome/signals` | exempt-check | check:readsRevenue withholds financial/revenue sections or figures below `revenue:read` |
| `KeyGenomeController.listContentStrategies` | GET | `/business-genome/businesses/:businessId/key-genome/marketing-growth/content-strategy` | open | follow-up: `ai:read` (membership-only read; no enforced module scope) |
| `KeyGenomeController.listDeliveryCapabilities` | GET | `/business-genome/businesses/:businessId/key-genome/operations/capabilities` | open | follow-up: `ai:read` (membership-only read; no enforced module scope) |
| `KeyGenomeController.listDepartments` | GET | `/business-genome/businesses/:businessId/key-genome/departments` | open | follow-up: `ai:read` (membership-only read; no enforced module scope) |
| `KeyGenomeController.listExperiments` | GET | `/business-genome/businesses/:businessId/key-genome/experiments` | exempt-check | check:readsRevenue withholds financial/revenue sections or figures below `revenue:read` |
| `KeyGenomeController.listGrowthChannels` | GET | `/business-genome/businesses/:businessId/key-genome/marketing-growth/channels` | exempt-check | check:readsRevenue withholds financial/revenue sections or figures below `revenue:read` |
| `KeyGenomeController.listMarketingGrowthSnapshots` | GET | `/business-genome/businesses/:businessId/key-genome/marketing-growth/snapshots` | exempt-check | check:readsRevenue withholds financial/revenue sections or figures below `revenue:read` |
| `KeyGenomeController.listMemoryEvents` | GET | `/business-genome/businesses/:businessId/key-genome/memory` | exempt-check | check:readsRevenue withholds financial/revenue sections or figures below `revenue:read` |
| `KeyGenomeController.listOperationalProcesses` | GET | `/business-genome/businesses/:businessId/key-genome/operations/processes` | open | follow-up: `ai:read` (membership-only read; no enforced module scope) |
| `KeyGenomeController.listOperationsSnapshots` | GET | `/business-genome/businesses/:businessId/key-genome/operations/snapshots` | open | follow-up: `ai:read` (membership-only read; no enforced module scope) |
| `KeyGenomeController.listRecommendations` | GET | `/business-genome/businesses/:businessId/key-genome/recommendations` | exempt-check | check:readsRevenue withholds financial/revenue sections or figures below `revenue:read` |

### `modules/calendar/calendar.controller.ts` (3)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `CalendarController.getSyncSettings` | GET | `/calendar/businesses/:businessId/sync/settings` | open | follow-up: `bookings:read` (membership-only read; no enforced module scope) |
| `CalendarController.listSyncCalendars` | GET | `/calendar/businesses/:businessId/sync/calendars` | exempt-check | check:assertCalendarNamesReader (requires calendar/bookings read authority) |
| `CalendarController.syncStatus` | GET | `/calendar/businesses/:businessId/sync/status` | open | follow-up: `bookings:read` (membership-only read; no enforced module scope) |

### `modules/capabilities/capabilities.controller.ts` (3)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `CapabilitiesController.get` | GET | `/capabilities/:name` | open | follow-up: `settings:read` (membership-only read; no enforced module scope) |
| `CapabilitiesController.list` | GET | `/capabilities` | open | follow-up: `settings:read` (membership-only read; no enforced module scope) |
| `CapabilitiesController.stats` | GET | `/capabilities/stats` | open | follow-up: `settings:read` (membership-only read; no enforced module scope) |

### `modules/catalog/catalog.controller.ts` (2)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `CatalogController.listProducts` | GET | `/catalog/businesses/:businessId/products` | open | follow-up: `revenue:read` (membership-only read; no enforced module scope) |
| `CatalogController.listServices` | GET | `/catalog/businesses/:businessId/services` | open | follow-up: `revenue:read` (membership-only read; no enforced module scope) |

### `modules/change-orders/change-order.controller.ts` (3)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `ChangeOrderController.findById` | GET | `/change-orders/businesses/:businessId/:id` | open | follow-up: `projects:read` (membership-only read; no enforced module scope) |
| `ChangeOrderController.listByBusiness` | GET | `/change-orders/businesses/:businessId` | open | follow-up: `projects:read` (membership-only read; no enforced module scope) |
| `ChangeOrderController.listByProject` | GET | `/change-orders/businesses/:businessId/projects/:projectId` | open | follow-up: `projects:read` (membership-only read; no enforced module scope) |

### `modules/commerce/commerce-insights.controller.ts` (10)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `CommerceInsightsController.getInsightsOverview` | GET | `/commerce/businesses/:businessId/insights/overview` | open | follow-up: `revenue:read` (membership-only read; no enforced module scope) |
| `CommerceInsightsController.getInventoryRisk` | GET | `/commerce/businesses/:businessId/insights/inventory-risk` | open | follow-up: `revenue:read` (membership-only read; no enforced module scope) |
| `CommerceInsightsController.getLandedCosts` | GET | `/commerce/businesses/:businessId/insights/landed-costs` | open | follow-up: `revenue:read` (membership-only read; no enforced module scope) |
| `CommerceInsightsController.getMarginAnalysis` | GET | `/commerce/businesses/:businessId/insights/margins` | open | follow-up: `revenue:read` (membership-only read; no enforced module scope) |
| `CommerceInsightsController.getMarginHistory` | GET | `/commerce/businesses/:businessId/products/:productId/insights/margin-history` | open | follow-up: `revenue:read` (membership-only read; no enforced module scope) |
| `CommerceInsightsController.getProductInventoryRisk` | GET | `/commerce/businesses/:businessId/products/:productId/insights/inventory-risk` | open | follow-up: `revenue:read` (membership-only read; no enforced module scope) |
| `CommerceInsightsController.getProductLandedCost` | GET | `/commerce/businesses/:businessId/products/:productId/insights/landed-cost` | open | follow-up: `revenue:read` (membership-only read; no enforced module scope) |
| `CommerceInsightsController.getProductMargin` | GET | `/commerce/businesses/:businessId/products/:productId/insights/margin` | open | follow-up: `revenue:read` (membership-only read; no enforced module scope) |
| `CommerceInsightsController.getProductSourceRisk` | GET | `/commerce/businesses/:businessId/products/:productId/insights/source-risk` | open | follow-up: `revenue:read` (membership-only read; no enforced module scope) |
| `CommerceInsightsController.getSourceRisk` | GET | `/commerce/businesses/:businessId/insights/source-risk` | open | follow-up: `revenue:read` (membership-only read; no enforced module scope) |

### `modules/commerce/commerce.controller.ts` (4)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `CommerceController.getDocumentTemplates` | GET | `/commerce/businesses/:businessId/document-templates` | open | follow-up: `settings:read` (document template and branding settings currently membership-only) |
| `CommerceController.getGmailAuthUrl` | GET | `/commerce/businesses/:businessId/gmail/auth-url` | exempt-check | check:assertConnectAuthority (business mailbox OAuth consent start is owner-only, GMAIL_OWNER_ONLY, D-11, D-42) |
| `CommerceController.getProductCostProfile` | GET | `/commerce/businesses/:businessId/products/:productId/cost-profile` | open | follow-up: `revenue:read` (product cost/margin profile currently membership-only) |
| `CommerceController.previewGmailConnection` | GET | `/commerce/businesses/:businessId/gmail/pending/:pendingId` | exempt-check | service-check:assertConnectAuthority (pending mailbox preview is owner-only, GMAIL_OWNER_ONLY, D-11, D-42) |

### `modules/commerce/document-template/document-template.controller.ts` (1)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `DocumentTemplateController.list` | GET | `/commerce/document-templates/businesses/:businessId` | open | follow-up: `settings:read` (membership-only read; no enforced module scope) |

### `modules/communications/communications.controller.ts` (6)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `CommunicationsController.audienceHealth` | GET | `/communications/businesses/:businessId/audience/health` | open | follow-up: `content:read` (membership-only read; no enforced module scope) |
| `CommunicationsController.deliveryEvents` | GET | `/communications/businesses/:businessId/deliveries/:deliveryId/events` | open | follow-up: `content:read` (membership-only read; no enforced module scope) |
| `CommunicationsController.deliverySummary` | GET | `/communications/businesses/:businessId/content/:id/delivery-summary` | open | follow-up: `content:read` (membership-only read; no enforced module scope) |
| `CommunicationsController.getContent` | GET | `/communications/businesses/:businessId/content/:id` | open | follow-up: `content:read` (membership-only read; no enforced module scope) |
| `CommunicationsController.listContent` | GET | `/communications/businesses/:businessId/content` | open | follow-up: `content:read` (membership-only read; no enforced module scope) |
| `CommunicationsController.listDeliveries` | GET | `/communications/businesses/:businessId/deliveries` | open | follow-up: `content:read` (membership-only read; no enforced module scope) |

### `modules/communications/message-intake.controller.ts` (1)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `MessageIntakeController.list` | GET | `/communications/businesses/:businessId/message-intake` | open | follow-up: `operations:read` (membership-only read; no enforced module scope) |

### `modules/communications/omnichannel.controller.ts` (7)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `OmnichannelController.checkConsent` | GET | `/api/communications/businesses/:businessId/consent/:contactId` | open | follow-up: `operations:read` (membership-only read; no enforced module scope) |
| `OmnichannelController.listChannelAccounts` | GET | `/api/communications/businesses/:businessId/channel-accounts` | open | follow-up: `operations:read` (membership-only read; no enforced module scope) |
| `OmnichannelController.listConsent` | GET | `/api/communications/businesses/:businessId/consent` | open | follow-up: `operations:read` (membership-only read; no enforced module scope) |
| `OmnichannelController.listDrafts` | GET | `/api/communications/businesses/:businessId/drafts` | open | follow-up: `operations:read` (membership-only read; no enforced module scope) |
| `OmnichannelController.listIntents` | GET | `/api/communications/businesses/:businessId/intents` | open | follow-up: `operations:read` (membership-only read; no enforced module scope) |
| `OmnichannelController.listTriggers` | GET | `/api/communications/businesses/:businessId/triggers` | open | follow-up: `operations:read` (membership-only read; no enforced module scope) |
| `OmnichannelController.unifiedInbox` | GET | `/api/communications/businesses/:businessId/unified-inbox` | open | follow-up: `operations:read` (membership-only read; no enforced module scope) |

### `modules/community/community.controller.ts` (49)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `CommunityController.getAiSuggestionFunnel` | GET | `/businesses/:businessId/community/ai-suggestion-funnel` | open | follow-up: `content:read` (membership-only read; no enforced module scope) |
| `CommunityController.getAnalyticsDashboard` | GET | `/businesses/:businessId/community/analytics/dashboard` | open | follow-up: `content:read` (membership-only read; no enforced module scope) |
| `CommunityController.getCollabRequests` | GET | `/businesses/:businessId/community/collab-requests` | open | follow-up: `content:read` (membership-only read; no enforced module scope) |
| `CommunityController.getConnections` | GET | `/businesses/:businessId/community/connections` | open | follow-up: `content:read` (membership-only read; no enforced module scope) |
| `CommunityController.getConnectionStatus` | GET | `/businesses/:businessId/community/connection-status/:targetId` | open | follow-up: `content:read` (membership-only read; no enforced module scope) |
| `CommunityController.getConversationMessages` | GET | `/businesses/:businessId/community/conversations/:conversationId` | open | follow-up: `content:read` (membership-only read; no enforced module scope) |
| `CommunityController.getConversations` | GET | `/businesses/:businessId/community/conversations` | open | follow-up: `content:read` (membership-only read; no enforced module scope) |
| `CommunityController.getEndorsements` | GET | `/community/endorsements/:businessId` | open | follow-up: `content:read` (membership-only read; no enforced module scope) |
| `CommunityController.getInteractionHistory` | GET | `/businesses/:businessId/community/history/:otherBusinessId` | open | follow-up: `content:read` (membership-only read; no enforced module scope) |
| `CommunityController.getMatchAnalytics` | GET | `/businesses/:businessId/community/match-analytics` | open | follow-up: `content:read` (membership-only read; no enforced module scope) |
| `CommunityController.getMatchFeedback` | GET | `/businesses/:businessId/community/match-feedback` | open | follow-up: `content:read` (membership-only read; no enforced module scope) |
| `CommunityController.getMyCohorts` | GET | `/businesses/:businessId/community/my-cohorts` | open | follow-up: `content:read` (membership-only read; no enforced module scope) |
| `CommunityController.getMyEndorsementsGiven` | GET | `/businesses/:businessId/community/endorsements-given/:targetId` | open | follow-up: `content:read` (membership-only read; no enforced module scope) |
| `CommunityController.getNotifications` | GET | `/businesses/:businessId/community/notifications` | open | follow-up: `content:read` (membership-only read; no enforced module scope) |
| `CommunityController.getOpportunity` | GET | `/community/opportunities/:id` | open | follow-up: `content:read` (membership-only read; no enforced module scope) |
| `CommunityController.getPartnerProgram` | GET | `/community/partner-programs/:id` | open | follow-up: `content:read` (membership-only read; no enforced module scope) |
| `CommunityController.getPost` | GET | `/community/posts/:id` | open | follow-up: `content:read` (membership-only read; no enforced module scope) |
| `CommunityController.getRecentViewers` | GET | `/businesses/:businessId/community/analytics/recent-viewers` | open | follow-up: `content:read` (membership-only read; no enforced module scope) |
| `CommunityController.getRecommendations` | GET | `/businesses/:businessId/community/recommendations` | open | follow-up: `content:read` (membership-only read; no enforced module scope) |
| `CommunityController.getRelationshipInsights` | GET | `/businesses/:businessId/community/relationship-insights` | open | follow-up: `content:read` (membership-only read; no enforced module scope) |
| `CommunityController.getReputation` | GET | `/community/reputation/:businessId` | open | follow-up: `content:read` (membership-only read; no enforced module scope) |
| `CommunityController.getResource` | GET | `/community/resources/:id` | open | follow-up: `content:read` (membership-only read; no enforced module scope) |
| `CommunityController.getReviewableTransactions` | GET | `/businesses/:businessId/community/reviewable/:otherBusinessId` | open | follow-up: `content:read` (membership-only read; no enforced module scope) |
| `CommunityController.getReviewsByBusiness` | GET | `/businesses/:businessId/community/reviews/given` | open | follow-up: `content:read` (membership-only read; no enforced module scope) |
| `CommunityController.getReviewsForBusiness` | GET | `/community/reviews/:businessId` | open | follow-up: `content:read` (membership-only read; no enforced module scope) |
| `CommunityController.getThread` | GET | `/businesses/:businessId/community/messages/thread/:otherBusinessId` | open | follow-up: `content:read` (membership-only read; no enforced module scope) |
| `CommunityController.getTrustSignals` | GET | `/community/trust-signals/:businessId` | open | follow-up: `content:read` (membership-only read; no enforced module scope) |
| `CommunityController.getUnreadMessageCount` | GET | `/businesses/:businessId/community/messages/unread-count` | open | follow-up: `content:read` (membership-only read; no enforced module scope) |
| `CommunityController.getUnreadNotificationCount` | GET | `/businesses/:businessId/community/notifications/unread-count` | open | follow-up: `content:read` (membership-only read; no enforced module scope) |
| `CommunityController.isBusinessSaved` | GET | `/businesses/:businessId/community/saved/check/:targetBusinessId` | open | follow-up: `content:read` (membership-only read; no enforced module scope) |
| `CommunityController.listActivityFeed` | GET | `/community/activity` | open | follow-up: `content:read` (membership-only read; no enforced module scope) |
| `CommunityController.listActivityForBusiness` | GET | `/community/activity/business/:businessId` | open | follow-up: `content:read` (membership-only read; no enforced module scope) |
| `CommunityController.listCohorts` | GET | `/community/cohorts` | open | follow-up: `content:read` (membership-only read; no enforced module scope) |
| `CommunityController.listCollaborations` | GET | `/businesses/:businessId/community/collaborations` | open | follow-up: `content:read` (membership-only read; no enforced module scope) |
| `CommunityController.listFollowingActivity` | GET | `/businesses/:businessId/community/activity/following` | open | follow-up: `content:read` (membership-only read; no enforced module scope) |
| `CommunityController.listMyApplications` | GET | `/businesses/:businessId/community/opportunity-applications/mine` | open | follow-up: `content:read` (membership-only read; no enforced module scope) |
| `CommunityController.listMyOpportunities` | GET | `/businesses/:businessId/community/opportunities/mine` | open | follow-up: `content:read` (membership-only read; no enforced module scope) |
| `CommunityController.listMyResourceDownloads` | GET | `/businesses/:businessId/community/resource-downloads/mine` | open | follow-up: `content:read` (membership-only read; no enforced module scope) |
| `CommunityController.listMyResources` | GET | `/businesses/:businessId/community/resources/mine` | open | follow-up: `content:read` (membership-only read; no enforced module scope) |
| `CommunityController.listOpportunities` | GET | `/community/opportunities` | open | follow-up: `content:read` (membership-only read; no enforced module scope) |
| `CommunityController.listPartnerPrograms` | GET | `/businesses/:businessId/community/partner-programs` | open | follow-up: `content:read` (membership-only read; no enforced module scope) |
| `CommunityController.listPosts` | GET | `/community/posts` | open | follow-up: `content:read` (membership-only read; no enforced module scope) |
| `CommunityController.listPublicPartnerProgramsForProfile` | GET | `/community/partner-programs/profile/:businessId` | open | follow-up: `content:read` (membership-only read; no enforced module scope) |
| `CommunityController.listQuoteRequests` | GET | `/businesses/:businessId/community/quote-requests` | open | follow-up: `content:read` (membership-only read; no enforced module scope) |
| `CommunityController.listReferrals` | GET | `/businesses/:businessId/community/referrals` | open | follow-up: `content:read` (membership-only read; no enforced module scope) |
| `CommunityController.listResources` | GET | `/community/resources` | open | follow-up: `content:read` (membership-only read; no enforced module scope) |
| `CommunityController.listSavedBusinesses` | GET | `/businesses/:businessId/community/saved` | open | follow-up: `content:read` (membership-only read; no enforced module scope) |
| `CommunityController.listThreads` | GET | `/businesses/:businessId/community/messages/threads` | open | follow-up: `content:read` (membership-only read; no enforced module scope) |
| `CommunityController.searchDirectory` | GET | `/community/directory` | open | follow-up: `content:read` (membership-only read; no enforced module scope) |

### `modules/connect/connect.controller.ts` (19)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `ConnectController.getBpInsights` | GET | `/connect/businesses/:businessId/business-profile/insights` | open | follow-up: `content:read` (Google Business Profile read currently membership-only) |
| `ConnectController.getConnectorFormMapping` | GET | `/connect/businesses/:businessId/connector-forms/:source/:externalFormId/mapping` | open | follow-up: `connect:read` (membership-only read; no enforced module scope) |
| `ConnectController.getContactSourcesAudit` | GET | `/connect/businesses/:businessId/contact-sources/audit` | open | follow-up: `crm:read` (contact sync status/mapping read currently membership-only) |
| `ConnectController.getContactSourcesSummary` | GET | `/connect/businesses/:businessId/contact-sources/summary` | open | follow-up: `crm:read` (contact sync status/mapping read currently membership-only) |
| `ConnectController.getContactsRules` | GET | `/connect/businesses/:businessId/contacts/mapping-rules` | open | follow-up: `crm:read` (contact sync status/mapping read currently membership-only) |
| `ConnectController.getContactsStatus` | GET | `/connect/businesses/:businessId/contacts/status` | open | follow-up: `crm:read` (contact sync status/mapping read currently membership-only) |
| `ConnectController.getForm` | GET | `/connect/businesses/:businessId/forms/:formId` | open | follow-up: `connect:read` (membership-only read; no enforced module scope) |
| `ConnectController.getFormMapping` | GET | `/connect/businesses/:businessId/forms/:formId/mapping` | open | follow-up: `connect:read` (membership-only read; no enforced module scope) |
| `ConnectController.getOutlookRules` | GET | `/connect/businesses/:businessId/outlook-contacts/mapping-rules` | open | follow-up: `crm:read` (contact sync status/mapping read currently membership-only) |
| `ConnectController.getOutlookStatus` | GET | `/connect/businesses/:businessId/outlook-contacts/status` | open | follow-up: `crm:read` (contact sync status/mapping read currently membership-only) |
| `ConnectController.listBpAccounts` | GET | `/connect/businesses/:businessId/business-profile/accounts` | open | follow-up: `content:read` (Google Business Profile read currently membership-only) |
| `ConnectController.listBpLocations` | GET | `/connect/businesses/:businessId/business-profile/locations` | open | follow-up: `content:read` (Google Business Profile read currently membership-only) |
| `ConnectController.listBpPosts` | GET | `/connect/businesses/:businessId/business-profile/posts` | open | follow-up: `content:read` (Google Business Profile read currently membership-only) |
| `ConnectController.listBpReviews` | GET | `/connect/businesses/:businessId/business-profile/reviews` | open | follow-up: `content:read` (Google Business Profile read currently membership-only) |
| `ConnectController.listBpScheduled` | GET | `/connect/businesses/:businessId/business-profile/scheduled-posts` | open | follow-up: `content:read` (Google Business Profile read currently membership-only) |
| `ConnectController.listConnectorForms` | GET | `/connect/businesses/:businessId/connector-forms/:source` | open | follow-up: `connect:read` (membership-only read; no enforced module scope) |
| `ConnectController.listConnectorSubmissions` | GET | `/connect/businesses/:businessId/connector-forms/:source/:leadFormId/submissions` | open | follow-up: `connect:read` (membership-only read; no enforced module scope) |
| `ConnectController.listFormResponses` | GET | `/connect/businesses/:businessId/forms/:formId/responses` | open | follow-up: `connect:read` (membership-only read; no enforced module scope) |
| `ConnectController.listForms` | GET | `/connect/businesses/:businessId/forms` | open | follow-up: `connect:read` (membership-only read; no enforced module scope) |

### `modules/content-ops/content-ops.controller.ts` (4)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `ContentOpsController.deliveryStatus` | GET | `/businesses/:businessId/content-requests/:requestId/delivery-status` | open | follow-up: `content:read` (membership-only read; no enforced module scope) |
| `ContentOpsController.getById` | GET | `/businesses/:businessId/content-requests/:requestId` | open | follow-up: `content:read` (membership-only read; no enforced module scope) |
| `ContentOpsController.list` | GET | `/businesses/:businessId/content-requests` | open | follow-up: `content:read` (membership-only read; no enforced module scope) |
| `ContentOpsController.pipeline` | GET | `/businesses/:businessId/content-requests/pipeline` | open | follow-up: `content:read` (membership-only read; no enforced module scope) |

### `modules/continental-ops/delivery-note.controller.ts` (2)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `DeliveryNoteController.get` | GET | `/continental-ops/businesses/:businessId/delivery-notes/:id` | open | follow-up: `storefront:read` (membership-only read; no enforced module scope) |
| `DeliveryNoteController.list` | GET | `/continental-ops/businesses/:businessId/delivery-notes` | open | follow-up: `storefront:read` (membership-only read; no enforced module scope) |

### `modules/continental-ops/goods-receipt.controller.ts` (2)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `GoodsReceiptController.get` | GET | `/continental-ops/businesses/:businessId/goods-receipts/:id` | open | follow-up: `storefront:read` (membership-only read; no enforced module scope) |
| `GoodsReceiptController.list` | GET | `/continental-ops/businesses/:businessId/goods-receipts` | open | follow-up: `storefront:read` (membership-only read; no enforced module scope) |

### `modules/continental-ops/receipt.controller.ts` (2)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `ReceiptController.get` | GET | `/continental-ops/businesses/:businessId/receipts/:id` | open | follow-up: `revenue:read` (membership-only read; no enforced module scope) |
| `ReceiptController.list` | GET | `/continental-ops/businesses/:businessId/receipts` | open | follow-up: `revenue:read` (membership-only read; no enforced module scope) |

### `modules/continental-ops/stock-count.controller.ts` (2)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `StockCountController.get` | GET | `/continental-ops/businesses/:businessId/stock-counts/:id` | open | follow-up: `storefront:read` (membership-only read; no enforced module scope) |
| `StockCountController.list` | GET | `/continental-ops/businesses/:businessId/stock-counts` | open | follow-up: `storefront:read` (membership-only read; no enforced module scope) |

### `modules/conversion/conversion.controller.ts` (8)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `ConversionController.getOrderBump` | GET | `/conversion/businesses/:businessId/cart/order-bump` | open | follow-up: `crm:read` (membership-only read; no enforced module scope) |
| `ConversionController.getReferralStats` | GET | `/conversion/businesses/:businessId/contacts/:contactId/referral-stats` | exempt-check | check:assertContactVisible enforces CRM contact visibility |
| `ConversionController.getRepPipeline` | GET | `/conversion/businesses/:businessId/sales-reps/:repId/pipeline` | open | follow-up: `crm:read` (membership-only read; no enforced module scope) |
| `ConversionController.getSalesReps` | GET | `/conversion/businesses/:businessId/sales-reps` | open | follow-up: `crm:read` (membership-only read; no enforced module scope) |
| `ConversionController.getSubConfig` | GET | `/conversion/businesses/:businessId/products/:productId/subscription-config` | open | follow-up: `crm:read` (membership-only read; no enforced module scope) |
| `ConversionController.getUpsells` | GET | `/conversion/businesses/:businessId/products/:productId/upsells` | open | follow-up: `crm:read` (membership-only read; no enforced module scope) |
| `ConversionController.listLeadMagnets` | GET | `/conversion/businesses/:businessId/lead-magnets` | open | follow-up: `crm:read` (membership-only read; no enforced module scope) |
| `ConversionController.listSubscriptionProducts` | GET | `/conversion/businesses/:businessId/subscription-products` | open | follow-up: `crm:read` (membership-only read; no enforced module scope) |

### `modules/crm/crm-sequence.controller.ts` (8)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `CrmSequenceController.getAllVariantReports` | GET | `/crm/businesses/:businessId/sequences/variants/report` | open | follow-up: `crm:read` (membership-only read; no enforced module scope) |
| `CrmSequenceController.getAttributionSettings` | GET | `/crm/businesses/:businessId/sequences/settings/attribution` | open | follow-up: `crm:read` (membership-only read; no enforced module scope) |
| `CrmSequenceController.getSequence` | GET | `/crm/businesses/:businessId/sequences/:id` | open | follow-up: `crm:read` (membership-only read; no enforced module scope) |
| `CrmSequenceController.getVariantReport` | GET | `/crm/businesses/:businessId/sequences/:id/variants/report` | open | follow-up: `crm:read` (membership-only read; no enforced module scope) |
| `CrmSequenceController.lifecycleReport` | GET | `/crm/businesses/:businessId/sequences/analytics/lifecycle` | open | follow-up: `crm:read` (membership-only read; no enforced module scope) |
| `CrmSequenceController.listSequences` | GET | `/crm/businesses/:businessId/sequences` | open | follow-up: `crm:read` (membership-only read; no enforced module scope) |
| `CrmSequenceController.sequenceAnalytics` | GET | `/crm/businesses/:businessId/sequences/:id/analytics` | open | follow-up: `crm:read` (membership-only read; no enforced module scope) |
| `CrmSequenceController.sequencesSummary` | GET | `/crm/businesses/:businessId/sequences/analytics/summary` | open | follow-up: `crm:read` (membership-only read; no enforced module scope) |

### `modules/device/device.controller.ts` (5)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `DeviceController.getCapture` | GET | `/api/device/businesses/:businessId/captures/:id` | open | follow-up: `operations:read` (membership-only read; no enforced module scope) |
| `DeviceController.getVoicePreferences` | GET | `/api/device/businesses/:businessId/voice-preferences` | open | follow-up: `operations:read` (membership-only read; no enforced module scope) |
| `DeviceController.listCaptures` | GET | `/api/device/businesses/:businessId/captures` | open | follow-up: `operations:read` (membership-only read; no enforced module scope) |
| `DeviceController.listIntakes` | GET | `/api/device/businesses/:businessId/intakes` | open | follow-up: `operations:read` (membership-only read; no enforced module scope) |
| `DeviceController.listVoiceSessions` | GET | `/api/device/businesses/:businessId/voice-sessions` | open | follow-up: `operations:read` (membership-only read; no enforced module scope) |

### `modules/diagnostics/diagnostics.controller.ts` (6)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `DiagnosticsController.crossModule` | GET | `/api/diagnostics/cross-module` | exempt-admin | guard:AdminGuard (platform super-admin read, not a business member route) |
| `DiagnosticsController.envVars` | GET | `/api/diagnostics/env-vars` | exempt-admin | guard:AdminGuard (platform super-admin read, not a business member route) |
| `DiagnosticsController.errors` | GET | `/api/diagnostics/errors` | exempt-admin | guard:AdminGuard (platform super-admin read, not a business member route) |
| `DiagnosticsController.infrastructure` | GET | `/api/diagnostics/infrastructure` | exempt-admin | guard:AdminGuard (platform super-admin read, not a business member route) |
| `DiagnosticsController.integrations` | GET | `/api/diagnostics/integrations` | exempt-admin | guard:AdminGuard (platform super-admin read, not a business member route) |
| `DiagnosticsController.modules` | GET | `/api/diagnostics/modules` | exempt-admin | guard:AdminGuard (platform super-admin read, not a business member route) |

### `modules/documents/documents.controller.ts` (6)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `DocumentsController.getDocumentHealth` | GET | `/documents/businesses/:businessId/health` | open | follow-up: `operations:read` (membership-only read; no enforced module scope) |
| `DocumentsController.getDriveSyncStatus` | GET | `/documents/businesses/:businessId/instances/:instanceId/drive-status` | open | follow-up: `operations:read` (membership-only read; no enforced module scope) |
| `DocumentsController.getInstance` | GET | `/documents/businesses/:businessId/instances/:instanceId` | open | follow-up: `operations:read` (membership-only read; no enforced module scope) |
| `DocumentsController.getInstances` | GET | `/documents/businesses/:businessId/instances` | open | follow-up: `operations:read` (membership-only read; no enforced module scope) |
| `DocumentsController.getOrgStandards` | GET | `/documents/businesses/:businessId/standards` | open | follow-up: `operations:read` (membership-only read; no enforced module scope) |
| `DocumentsController.getVersionComparison` | GET | `/documents/businesses/:businessId/instances/:instanceId/compare` | open | follow-up: `operations:read` (membership-only read; no enforced module scope) |

### `modules/education/education.controller.ts` (2)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `EducationController.getCertificate` | GET | `/businesses/:businessId/education/certificate/:courseId` | open | follow-up: `content:read` (membership-only read; no enforced module scope) |
| `EducationController.getMyEnrollments` | GET | `/businesses/:businessId/education/enrollments` | open | follow-up: `content:read` (membership-only read; no enforced module scope) |

### `modules/email-marketing/email-marketing.controller.ts` (10)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `EmailMarketingController.getAudienceHealth` | GET | `/businesses/:businessId/campaign-intelligence/audience-health` | open | follow-up: `content:read` (membership-only read; no enforced module scope) |
| `EmailMarketingController.getCampaign` | GET | `/businesses/:businessId/campaigns/:id` | open | follow-up: `content:read` (membership-only read; no enforced module scope) |
| `EmailMarketingController.getCampaignBriefing` | GET | `/businesses/:businessId/campaign-intelligence/briefing/:campaignId` | open | follow-up: `content:read` (membership-only read; no enforced module scope) |
| `EmailMarketingController.getCampaignBriefings` | GET | `/businesses/:businessId/campaign-intelligence/briefings` | open | follow-up: `content:read` (membership-only read; no enforced module scope) |
| `EmailMarketingController.getCampaignRecipients` | GET | `/businesses/:businessId/campaigns/:id/recipients` | open | follow-up: `content:read` (membership-only read; no enforced module scope) |
| `EmailMarketingController.getCampaignStats` | GET | `/businesses/:businessId/campaigns/:id/stats` | open | follow-up: `content:read` (membership-only read; no enforced module scope) |
| `EmailMarketingController.getMarketingStats` | GET | `/businesses/:businessId/marketing/stats` | open | follow-up: `content:read` (membership-only read; no enforced module scope) |
| `EmailMarketingController.getSendTimeRecommendations` | GET | `/businesses/:businessId/campaign-intelligence/send-time-recommendations` | open | follow-up: `content:read` (membership-only read; no enforced module scope) |
| `EmailMarketingController.getSuppressionCount` | GET | `/businesses/:businessId/suppression-count` | open | follow-up: `content:read` (membership-only read; no enforced module scope) |
| `EmailMarketingController.listCampaigns` | GET | `/businesses/:businessId/campaigns` | open | follow-up: `content:read` (membership-only read; no enforced module scope) |

### `modules/email-marketing/marketing-ai.controller.ts` (1)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `MarketingAiController.getBusinessSnapshot` | GET | `/marketing/businesses/:businessId/marketing/business-snapshot` | open | follow-up: `content:read` (membership-only read; no enforced module scope) |

### `modules/events/events.controller.ts` (4)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `EventsController.getEvent` | GET | `/businesses/:businessId/events/:eventId` | open | follow-up: `operations:read` (membership-only read; no enforced module scope) |
| `EventsController.listAttendees` | GET | `/businesses/:businessId/events/:eventId/attendees` | open | follow-up: `operations:read` (membership-only read; no enforced module scope) |
| `EventsController.listEvents` | GET | `/businesses/:businessId/events` | open | follow-up: `operations:read` (membership-only read; no enforced module scope) |
| `EventsController.listTicketTypes` | GET | `/businesses/:businessId/events/:eventId/ticket-types` | open | follow-up: `operations:read` (membership-only read; no enforced module scope) |

### `modules/evidence/evidence.controller.ts` (4)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `EvidenceController.checkTaskEvidence` | GET | `/businesses/:businessId/tasks/:taskType/:taskId/evidence-check` | open | follow-up: `operations:read` (membership-only read; no enforced module scope) |
| `EvidenceController.getById` | GET | `/evidence/:evidenceId` | open | follow-up: `operations:read` (membership-only read; no enforced module scope) |
| `EvidenceController.getForObject` | GET | `/businesses/:businessId/evidence/for/:linkedType/:linkedId` | open | follow-up: `operations:read` (membership-only read; no enforced module scope) |
| `EvidenceController.list` | GET | `/businesses/:businessId/evidence` | open | follow-up: `operations:read` (membership-only read; no enforced module scope) |

### `modules/feature-flags/feature-flags.controller.ts` (2)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `AdminFeatureFlagsController.listAll` | GET | `/api/admin/feature-flags` | exempt-admin | guard:AdminGuard (platform super-admin read, not a business member route) |
| `FeatureFlagsController.listForUser` | GET | `/api/feature-flags` | exempt-own | caller's own resolved feature flags scoped to `req.user.email` |

### `modules/finance/finance.controller.ts` (4)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `FinanceController.getLatestExchangeRate` | GET | `/finance/businesses/:businessId/exchange-rates/latest` | open | follow-up: `revenue:read` (membership-only read; no enforced module scope) |
| `FinanceController.listCoa` | GET | `/finance/businesses/:businessId/chart-of-accounts` | open | follow-up: `revenue:read` (membership-only read; no enforced module scope) |
| `FinanceController.listExchangeRates` | GET | `/finance/businesses/:businessId/exchange-rates` | open | follow-up: `revenue:read` (membership-only read; no enforced module scope) |
| `FinanceController.listTaxRates` | GET | `/finance/businesses/:businessId/tax-rates` | open | follow-up: `revenue:read` (membership-only read; no enforced module scope) |

### `modules/flow-signal/flow-signal-role.controller.ts` (1)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `FlowSignalBusinessRoleController.getBusinessRoles` | GET | `/flow-signals/businesses/:businessId/roles` | open | follow-up: `operations:read` (membership-only read; no enforced module scope) |

### `modules/flow-signal/flow-signal.controller.ts` (2)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `FlowSignalController.getRoleQueue` | GET | `/flow-signals/businesses/:businessId/role/:roleKey` | open | follow-up: `operations:read` (membership-only read; no enforced module scope) |
| `FlowSignalController.list` | GET | `/flow-signals/businesses/:businessId` | open | follow-up: `operations:read` (membership-only read; no enforced module scope) |

### `modules/flow/flow.controller.ts` (4)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `FlowController.getActivityFeed` | GET | `/api/flows/businesses/:businessId/activity` | exempt-check | check:resolveTimelineViewer filters legacy activity feed by the caller's module scopes (V1-84) |
| `FlowController.getCockpitSummary` | GET | `/api/flows/businesses/:businessId/cockpit` | open | follow-up: `operations:read` (legacy cockpit summary currently membership-only) |
| `FlowController.listCrossModuleWorkflows` | GET | `/api/flows/businesses/:businessId/cross-module-workflows` | open | follow-up: `automations:read` (cross-module workflow configs currently membership-only) |
| `FlowController.universalSearch` | GET | `/api/flows/businesses/:businessId/search` | exempt-check | check:memberModuleLevel enforces `revenue:read` on invoice results (D-100); follow-up should also enforce `crm:read`, `bookings:read`, and `projects:read` on the remaining search buckets |

### `modules/gamification/gamification.controller.ts` (1)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `GamificationController.getStats` | GET | `/gamification/businesses/:businessId/stats` | open | follow-up: `analytics:read` (membership-only read; no enforced module scope) |

### `modules/google-drive/google-drive.controller.ts` (10)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `GoogleDriveController.generateInventorySheetDiff` | GET | `/drive/businesses/:businessId/inventory-sheet/diff` | open | follow-up: `storefront:read` (Google Drive inventory sheet read currently membership-only) |
| `GoogleDriveController.getAuthUrl` | GET | `/drive/businesses/:businessId/auth-url` | exempt-check | check:assertGoogleConnectOwner (Google Drive OAuth consent start is owner-only, D-99) |
| `GoogleDriveController.getEmbedUrl` | GET | `/drive/businesses/:businessId/files/:fileId/embed-url` | open | follow-up: `operations:read` (membership-only read; no enforced module scope) |
| `GoogleDriveController.getFile` | GET | `/drive/businesses/:businessId/files/:fileId` | open | follow-up: `operations:read` (membership-only read; no enforced module scope) |
| `GoogleDriveController.getFileContent` | GET | `/drive/businesses/:businessId/files/:fileId/content` | open | follow-up: `operations:read` (membership-only read; no enforced module scope) |
| `GoogleDriveController.getInventorySheetStatus` | GET | `/drive/businesses/:businessId/inventory-sheet/status` | open | follow-up: `storefront:read` (Google Drive inventory sheet read currently membership-only) |
| `GoogleDriveController.getStatus` | GET | `/drive/businesses/:businessId/status` | open | follow-up: `operations:read` (membership-only read; no enforced module scope) |
| `GoogleDriveController.listFiles` | GET | `/drive/businesses/:businessId/files` | open | follow-up: `operations:read` (membership-only read; no enforced module scope) |
| `GoogleDriveController.listGeneratedDocuments` | GET | `/drive/businesses/:businessId/generated-documents` | exempt-check | check:assertMayExport (tracks documents filtered by caller's module export/read authority, WPH2-2) |
| `GoogleDriveController.pullInventoryFromSheet` | GET | `/drive/businesses/:businessId/inventory-sheet/pull` | open | follow-up: `storefront:read` (Google Drive inventory sheet read currently membership-only) |

### `modules/governance/governance.controller.ts` (3)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `GovernanceController.getRisk` | GET | `/governance/businesses/:businessId/risks/:id` | open | follow-up: `settings:read` (membership-only read; no enforced module scope) |
| `GovernanceController.listRisks` | GET | `/governance/businesses/:businessId/risks` | open | follow-up: `settings:read` (membership-only read; no enforced module scope) |
| `GovernanceController.summary` | GET | `/governance/businesses/:businessId/summary` | open | follow-up: `settings:read` (membership-only read; no enforced module scope) |

### `modules/growth-intelligence/growth-intelligence.controller.ts` (5)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `GrowthIntelligenceController.getAttribution` | GET | `/growth-intelligence/businesses/:businessId/attribution` | open | follow-up: `analytics:read` (membership-only read; no enforced module scope) |
| `GrowthIntelligenceController.getDashboard` | GET | `/growth-intelligence/businesses/:businessId/dashboard` | open | follow-up: `analytics:read` (membership-only read; no enforced module scope) |
| `GrowthIntelligenceController.getJourney` | GET | `/growth-intelligence/businesses/:businessId/journeys/:contactId` | open | follow-up: `analytics:read` (membership-only read; no enforced module scope) |
| `GrowthIntelligenceController.listInsights` | GET | `/growth-intelligence/businesses/:businessId/insights` | open | follow-up: `analytics:read` (membership-only read; no enforced module scope) |
| `GrowthIntelligenceController.listJourneys` | GET | `/growth-intelligence/businesses/:businessId/journeys` | open | follow-up: `analytics:read` (membership-only read; no enforced module scope) |

### `modules/helpdesk/helpdesk.controller.ts` (2)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `HelpdeskController.getTicket` | GET | `/helpdesk/businesses/:businessId/tickets/:ticketId` | open | follow-up: `operations:read` (membership-only read; no enforced module scope) |
| `HelpdeskController.listTickets` | GET | `/helpdesk/businesses/:businessId/tickets` | open | follow-up: `operations:read` (membership-only read; no enforced module scope) |

### `modules/identity/identity.controller.ts` (13)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `IdentityController.checkSlugAvailability` | GET | `/identity/businesses/slug-check/:slug` | exempt-public | `OptionalAuthGuard` public business slug availability check; returns boolean availability only |
| `IdentityController.getAuthAudit` | GET | `/identity/admin/auth-audit` | exempt-admin | guard:AdminGuard (platform super-admin read, not a business member route) |
| `IdentityController.getBusiness` | GET | `/identity/businesses/:businessId` | exempt-membership | core business profile shared by all business members; `sanitizeBusiness` strips credentials and `withholdBusinessFinanceSettings` withholds finance columns below `revenue:read` (D-205, D-221) |
| `IdentityController.getBusinessContext` | GET | `/identity/businesses/:businessId/ai-context` | open | follow-up: `ai:read` (full AI business context aggregation currently membership-only) |
| `IdentityController.getDocumentGuidance` | GET | `/identity/businesses/:businessId/document-guidance` | open | follow-up: `settings:read` (membership-only read; no enforced module scope) |
| `IdentityController.getGuidanceSubProfile` | GET | `/identity/businesses/:businessId/guidance/:subProfile` | open | follow-up: `settings:read` (membership-only read; no enforced module scope) |
| `IdentityController.getLegacyModules` | GET | `/identity/businesses/:businessId/legacy-modules` | exempt-own | NAV-B-LEGACY-SERVER: returns sorted hidden v1 module key names only for the caller's navigation (zero counts, zero tenant record names, zero amounts) |
| `IdentityController.getMe` | GET | `/identity/me` | exempt-own | caller's own user profile scoped strictly to `user.id` |
| `IdentityController.getProgressivePrompts` | GET | `/identity/businesses/:businessId/progressive-prompts` | open | follow-up: `settings:read` (membership-only read; no enforced module scope) |
| `IdentityController.getReferral` | GET | `/identity/referral` | exempt-own | caller's own referral code and referral count scoped strictly to `user.id` |
| `IdentityController.getTieredCompleteness` | GET | `/identity/businesses/:businessId/tiered-completeness` | open | follow-up: `settings:read` (membership-only read; no enforced module scope) |
| `IdentityController.listBusinesses` | GET | `/identity/businesses` | exempt-own | caller's own business memberships; `sanitizeBusiness` strips credentials and `withholdBusinessFinanceSettings` withholds finance columns below `revenue:read` (D-205) |
| `IdentityController.myModuleAccess` | GET | `/identity/businesses/:businessId/my-access` | exempt-own | caller's own resolved module scope map (`memberModuleLevels`) for navigation and UI capability gating |

### `modules/intelligence/business-intelligence.controller.ts` (1)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `BusinessIntelligenceController.executiveBrief` | GET | `/intelligence/businesses/:businessId/executive-brief` | exempt-check | service-check:readsRevenueFor filters genome composites, proposals, and temporal revenue data below `revenue:read` |

### `modules/intelligence/key-executive-mode.controller.ts` (2)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `KeyExecutiveModeController.listModes` | GET | `/intelligence/businesses/:businessId/key-modes` | exempt-system | static executive mode metadata list; reads no tenant records |
| `KeyExecutiveModeController.modeBrief` | GET | `/intelligence/businesses/:businessId/key-modes/:mode` | exempt-check | service-check:readsRevenueFor filters DNA scores, temporal insights, and proposals below `revenue:read` |

### `modules/key-autonomy/key-action-proposal.controller.ts` (2)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `KeyActionProposalController.get` | GET | `/key-autonomy/businesses/:businessId/actions/proposals/:proposalId` | exempt-check | check:getForReader enforces module scope visibility for the single proposal |
| `KeyActionProposalController.list` | GET | `/key-autonomy/businesses/:businessId/actions/proposals` | exempt-check | check:listForReader filters KEY action proposals by the caller's module scopes |

### `modules/key-autonomy/key-genome-bridge.controller.ts` (1)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `KeyGenomeBridgeController.previewRecommendationAction` | GET | `/business-genome/businesses/:businessId/key-genome/recommendations/:recommendationId/action-preview` | exempt-check | check:requireBridgeRevenue enforces `revenue:read` for finance recommendations |

### `modules/key-connector/key-connector.controller.ts` (3)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `KeyConnectorController.getAuditLog` | GET | `/key-connector/audit` | open | follow-up: `settings:read` (connector audit log currently membership-only) |
| `KeyConnectorController.getHealth` | GET | `/key-connector/health` | open | follow-up: `connect:read` (membership-only read; no enforced module scope) |
| `KeyConnectorController.getSyncHistory` | GET | `/key-connector/sync` | open | follow-up: `connect:read` (membership-only read; no enforced module scope) |

### `modules/key-cortex/key-cortex-audit.controller.ts` (5)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `KeyCortexAuditController.auditAcceptance` | GET | `//api/v1/cortex/audit/acceptance` | open | follow-up: `settings:admin` (BUG-065 class: acceptance audit currently readable by any business member) |
| `KeyCortexAuditController.auditAssessment` | GET | `//api/v1/cortex/audit/assessment` | open | follow-up: `settings:admin` (BUG-065 class: compliance self-assessment audit currently readable by any business member) |
| `KeyCortexAuditController.auditDecisions` | GET | `//api/v1/cortex/audit/decisions` | open | follow-up: `settings:admin` (BUG-065 class: autonomy audit verdicts currently readable by any business member) |
| `KeyCortexAuditController.auditValues` | GET | `//api/v1/cortex/audit/values` | open | follow-up: `settings:admin` (BUG-065 class: value constraints and drift audit currently readable by any business member) |
| `KeyCortexAuditController.evalSuiteNames` | GET | `//api/v1/cortex/eval/suites` | exempt-system | static list of synthetic eval harness suite names; reads no tenant records |

### `modules/key-cortex/key-cortex-goals.controller.ts` (4)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `KeyCortexGoalsController.getGoal` | GET | `//api/v1/cortex/goals/:goalId` | open | follow-up: `ai:read` (membership-only read; no enforced module scope) |
| `KeyCortexGoalsController.getPlan` | GET | `//api/v1/cortex/plans/:planId` | open | follow-up: `ai:read` (membership-only read; no enforced module scope) |
| `KeyCortexGoalsController.listGoals` | GET | `//api/v1/cortex/goals` | open | follow-up: `ai:read` (membership-only read; no enforced module scope) |
| `KeyCortexGoalsController.listTriggerRules` | GET | `//api/v1/cortex/triggers` | open | follow-up: `ai:read` (membership-only read; no enforced module scope) |

### `modules/key-cortex/key-cortex.controller.ts` (25)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `KeyCortexController.documentGet` | GET | `/api/v1/cortex/documents/:id` | open | follow-up: `operations:read` (KEY cortex phone/document read currently membership-only) |
| `KeyCortexController.documentList` | GET | `/api/v1/cortex/documents` | open | follow-up: `operations:read` (KEY cortex phone/document read currently membership-only) |
| `KeyCortexController.evolutionExplainDecision` | GET | `/api/v1/cortex/evolution/decision` | exempt-guard | guard:CortexMemberAuthorityGuard (member authority guard with per-module filtering) |
| `KeyCortexController.evolutionPatterns` | GET | `/api/v1/cortex/evolution/patterns` | open | follow-up: `ai:read` (membership-only read; no enforced module scope) |
| `KeyCortexController.evolutionProfile` | GET | `/api/v1/cortex/evolution/profile` | open | follow-up: `ai:read` (membership-only read; no enforced module scope) |
| `KeyCortexController.evolutionReport` | GET | `/api/v1/cortex/evolution/report` | open | follow-up: `ai:read` (membership-only read; no enforced module scope) |
| `KeyCortexController.flowGet` | GET | `/api/v1/cortex/flows/:id` | open | follow-up: `automations:read` (KEY cortex flow studio read currently membership-only) |
| `KeyCortexController.flowList` | GET | `/api/v1/cortex/flows` | open | follow-up: `automations:read` (KEY cortex flow studio read currently membership-only) |
| `KeyCortexController.flowNodes` | GET | `/api/v1/cortex/flows/nodes` | exempt-system | static flow studio node registry; reads no tenant records |
| `KeyCortexController.flowTemplates` | GET | `/api/v1/cortex/flows/templates` | exempt-system | static list of flow studio templates; reads no tenant records |
| `KeyCortexController.getAlerts` | GET | `/api/v1/cortex/alerts` | open | follow-up: `ai:read` (membership-only read; no enforced module scope) |
| `KeyCortexController.getAutonomyProfile` | GET | `/api/v1/cortex/autonomy-profile` | open | follow-up: `ai:read` (membership-only read; no enforced module scope) |
| `KeyCortexController.getAwareness` | GET | `/api/v1/cortex/awareness` | exempt-guard | guard:CortexMemberAuthorityGuard (member authority guard with per-module filtering) |
| `KeyCortexController.getCapabilities` | GET | `/api/v1/cortex/capabilities` | exempt-system | static list of KEY cortex capability descriptors; reads no tenant records |
| `KeyCortexController.getContext` | GET | `/api/v1/cortex/context` | exempt-owner | guard:CortexBusinessOwnerGuard (owner-only KEY cortex full business context) |
| `KeyCortexController.getMessages` | GET | `/api/v1/cortex/messages` | open | follow-up: `ai:read` (membership-only read; no enforced module scope) |
| `KeyCortexController.getMonitors` | GET | `/api/v1/cortex/monitors` | open | follow-up: `ai:read` (membership-only read; no enforced module scope) |
| `KeyCortexController.getSession` | GET | `/api/v1/cortex/sessions/:id` | open | follow-up: `ai:read` (membership-only read; no enforced module scope) |
| `KeyCortexController.listPersonalities` | GET | `/api/v1/cortex/personalities` | exempt-system | static list of KEY cortex persona definitions; reads no tenant records |
| `KeyCortexController.listSessions` | GET | `/api/v1/cortex/sessions` | open | follow-up: `ai:read` (membership-only read; no enforced module scope) |
| `KeyCortexController.listTools` | GET | `/api/v1/cortex/actions/tools` | open | follow-up: `ai:read` (membership-only read; no enforced module scope) |
| `KeyCortexController.listVoices` | GET | `/api/v1/cortex/voice/voices` | exempt-system | static list of available voice synthesis voices; reads no tenant records |
| `KeyCortexController.phoneHistory` | GET | `/api/v1/cortex/phone/history` | open | follow-up: `operations:read` (KEY cortex phone/document read currently membership-only) |
| `KeyCortexController.phoneStatus` | GET | `/api/v1/cortex/phone/status` | open | follow-up: `operations:read` (KEY cortex phone/document read currently membership-only) |
| `KeyCortexController.sandboxTemplates` | GET | `/api/v1/cortex/sandbox/templates` | exempt-system | static list of sandbox code templates; reads no tenant records |

### `modules/keyflow-command/keyflow-command.controller.ts` (2)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `KeyflowCommandController.listEvents` | GET | `/keyflow/businesses/:businessId/events` | open | follow-up: `operations:read` (membership-only read; no enforced module scope) |
| `KeyflowCommandController.listNotes` | GET | `/keyflow/businesses/:businessId/notes` | open | follow-up: `operations:read` (membership-only read; no enforced module scope) |

### `modules/keystore/keystore-admin.controller.ts` (3)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `KeystoreAdminController.getAllOrders` | GET | `/keystore/admin/orders` | open | follow-up: `settings:admin` (admin-prefixed KeyStore all-orders controller lacks `AdminGuard` and `ModuleScopeGuard`; currently membership-only) |
| `KeystoreAdminController.getOrder` | GET | `/keystore/admin/orders/:id` | open | follow-up: `settings:admin` (admin-prefixed KeyStore order detail lacks `AdminGuard` and `ModuleScopeGuard`; currently membership-only) |
| `KeystoreAdminController.getStats` | GET | `/keystore/admin/stats` | open | follow-up: `settings:admin` (admin-prefixed KeyStore stats controller lacks `AdminGuard` and `ModuleScopeGuard`; currently membership-only) |

### `modules/keystore/keystore.controller.ts` (5)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `KeystoreController.getCategories` | GET | `/keystore/categories` | exempt-public | public KeyStore marketplace category catalog; returns no tenant private records |
| `KeystoreController.getListingBySlug` | GET | `/keystore/listings/:slug` | exempt-public | public KeyStore marketplace listing detail; returns no tenant private records |
| `KeystoreController.getListings` | GET | `/keystore/listings` | exempt-public | public KeyStore marketplace listings catalog; returns no tenant private records |
| `KeystoreController.getMyOrders` | GET | `/keystore/orders` | exempt-own | caller's own KeyStore orders scoped to `req.user.id` |
| `KeystoreController.getOrder` | GET | `/keystore/orders/:id` | exempt-own | caller's own KeyStore order scoped to `req.user.id` |

### `modules/lead-forms/lead-forms.controller.ts` (3)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `LeadFormsController.getForm` | GET | `/businesses/:businessId/lead-forms/:id` | open | follow-up: `content:read` (membership-only read; no enforced module scope) |
| `LeadFormsController.listForms` | GET | `/businesses/:businessId/lead-forms` | open | follow-up: `content:read` (membership-only read; no enforced module scope) |
| `LeadFormsController.listSubmissions` | GET | `/businesses/:businessId/lead-forms/:formId/submissions` | open | follow-up: `content:read` (membership-only read; no enforced module scope) |

### `modules/livekit/livekit.controller.ts` (2)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `LivekitController.listParticipants` | GET | `/livekit/businesses/:businessId/rooms/:roomName/participants` | open | follow-up: `ai:read` (membership-only read; no enforced module scope) |
| `LivekitController.listRooms` | GET | `/livekit/businesses/:businessId/rooms` | open | follow-up: `ai:read` (membership-only read; no enforced module scope) |

### `modules/marketing/marketing.controller.ts` (1)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `MarketingController.listCampaigns` | GET | `/marketing/businesses/:businessId/campaigns` | open | follow-up: `content:read` (membership-only read; no enforced module scope) |

### `modules/marketplace/marketplace.controller.ts` (20)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `MarketplaceController.exportInventoryExcel` | GET | `/marketplace/businesses/:businessId/inventory/export-excel` | open | follow-up: `storefront:read` (membership-only read; no enforced module scope) |
| `MarketplaceController.getContactOrderHistory` | GET | `/marketplace/businesses/:businessId/contacts/:contactId/order-history` | exempt-check | check:assertContactVisible enforces CRM contact visibility |
| `MarketplaceController.getCustomsDeclarations` | GET | `/marketplace/businesses/:businessId/customs` | open | follow-up: `storefront:read` (membership-only read; no enforced module scope) |
| `MarketplaceController.getDashboard` | GET | `/marketplace/businesses/:businessId/dashboard` | open | follow-up: `storefront:read` (membership-only read; no enforced module scope) |
| `MarketplaceController.getDeliveryConfig` | GET | `/marketplace/businesses/:businessId/delivery-config` | open | follow-up: `storefront:read` (membership-only read; no enforced module scope) |
| `MarketplaceController.getFulfillmentRoutes` | GET | `/marketplace/businesses/:businessId/orders/:orderId/routes` | open | follow-up: `storefront:read` (membership-only read; no enforced module scope) |
| `MarketplaceController.getInventory` | GET | `/marketplace/businesses/:businessId/inventory` | open | follow-up: `storefront:read` (membership-only read; no enforced module scope) |
| `MarketplaceController.getInventoryAlerts` | GET | `/marketplace/businesses/:businessId/inventory/alerts` | open | follow-up: `storefront:read` (membership-only read; no enforced module scope) |
| `MarketplaceController.getInventoryMovements` | GET | `/marketplace/businesses/:businessId/inventory/movements` | open | follow-up: `storefront:read` (membership-only read; no enforced module scope) |
| `MarketplaceController.getInventorySummary` | GET | `/marketplace/businesses/:businessId/inventory/summary` | open | follow-up: `storefront:read` (membership-only read; no enforced module scope) |
| `MarketplaceController.getInventoryTemplate` | GET | `/marketplace/businesses/:businessId/inventory/template-excel` | open | follow-up: `storefront:read` (membership-only read; no enforced module scope) |
| `MarketplaceController.getListings` | GET | `/marketplace/businesses/:businessId/listings` | open | follow-up: `storefront:read` (membership-only read; no enforced module scope) |
| `MarketplaceController.getOrder` | GET | `/marketplace/businesses/:businessId/orders/:orderId` | open | follow-up: `storefront:read` (membership-only read; no enforced module scope) |
| `MarketplaceController.getOrderCrossLinks` | GET | `/marketplace/businesses/:businessId/orders/:orderId/cross-links` | open | follow-up: `storefront:read` (membership-only read; no enforced module scope) |
| `MarketplaceController.getOrders` | GET | `/marketplace/businesses/:businessId/orders` | open | follow-up: `storefront:read` (membership-only read; no enforced module scope) |
| `MarketplaceController.getPreOrders` | GET | `/marketplace/businesses/:businessId/pre-orders` | open | follow-up: `storefront:read` (membership-only read; no enforced module scope) |
| `MarketplaceController.getPurchaseOrders` | GET | `/marketplace/businesses/:businessId/purchase-orders` | open | follow-up: `storefront:read` (membership-only read; no enforced module scope) |
| `MarketplaceController.getShipments` | GET | `/marketplace/businesses/:businessId/shipments` | open | follow-up: `storefront:read` (membership-only read; no enforced module scope) |
| `MarketplaceController.getShippingZones` | GET | `/marketplace/businesses/:businessId/shipping-zones` | open | follow-up: `storefront:read` (membership-only read; no enforced module scope) |
| `MarketplaceController.getWarehouses` | GET | `/marketplace/businesses/:businessId/warehouses` | open | follow-up: `storefront:read` (membership-only read; no enforced module scope) |

### `modules/momentum/momentum.controller.ts` (4)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `MomentumController.getContactMomentum` | GET | `/momentum/businesses/:businessId/contacts/:contactId` | exempt-check | check:assertContactVisible enforces CRM contact visibility |
| `MomentumController.getContactMomentumHistory` | GET | `/momentum/businesses/:businessId/contacts/:contactId/history` | exempt-check | check:assertContactVisible enforces CRM contact visibility |
| `MomentumController.getDailyRecommendations` | GET | `/momentum/businesses/:businessId/recommendations` | open | follow-up: `crm:read` (membership-only read; no enforced module scope) |
| `MomentumController.getMomentumSummary` | GET | `/momentum/businesses/:businessId/summary` | open | follow-up: `crm:read` (membership-only read; no enforced module scope) |

### `modules/notifications/notifications.controller.ts` (2)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `NotificationsController.list` | GET | `/notifications/businesses/:businessId` | exempt-check | check:resolveTimelineViewer filters notifications strictly by the caller's module scopes |
| `NotificationsController.unreadCount` | GET | `/notifications/businesses/:businessId/unread-count` | exempt-check | check:resolveTimelineViewer counts only notifications visible under the caller's module scopes |

### `modules/onboarding-concierge/onboarding-concierge.controller.ts` (7)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `OnboardingConciergeController.getConciergeState` | GET | `/onboarding-concierge/businesses/:businessId/state` | open | follow-up: `settings:read` (membership-only read; no enforced module scope) |
| `OnboardingConciergeController.getNudges` | GET | `/onboarding-concierge/businesses/:businessId/nudges` | open | follow-up: `settings:read` (membership-only read; no enforced module scope) |
| `OnboardingConciergeController.getOnboardingState` | GET | `/onboarding-concierge/businesses/:businessId/onboarding-state` | open | follow-up: `settings:read` (membership-only read; no enforced module scope) |
| `OnboardingConciergeController.getSetupStatus` | GET | `/onboarding-concierge/businesses/:businessId/status` | open | follow-up: `settings:read` (membership-only read; no enforced module scope) |
| `OnboardingConciergeController.getTemplatePreview` | GET | `/onboarding-concierge/businesses/:businessId/templates/:templateId` | open | follow-up: `settings:read` (membership-only read; no enforced module scope) |
| `OnboardingConciergeController.getTemplates` | GET | `/onboarding-concierge/businesses/:businessId/templates` | open | follow-up: `settings:read` (membership-only read; no enforced module scope) |
| `OnboardingConciergeController.getWelcomeMessage` | GET | `/onboarding-concierge/businesses/:businessId/welcome` | open | follow-up: `settings:read` (membership-only read; no enforced module scope) |

### `modules/os/os.controller.ts` (1)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `OsController.commandCenter` | GET | `/os/businesses/:businessId/command-center` | open | follow-up: `operations:read` (membership-only read; no enforced module scope) |

### `modules/people-flow/people-flow.controller.ts` (3)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `PeopleFlowController.getContactHealth` | GET | `/people-flow/businesses/:businessId/contacts/:contactId/health` | exempt-check | check:assertContactVisible and check:readsRevenue enforce CRM visibility and revenue read redaction |
| `PeopleFlowController.getOverview` | GET | `/people-flow/businesses/:businessId/overview` | open | follow-up: `crm:read` (membership-only read; no enforced module scope) |
| `PeopleFlowController.getSegments` | GET | `/people-flow/businesses/:businessId/segments` | open | follow-up: `crm:read` (membership-only read; no enforced module scope) |

### `modules/public-events/presence.controller.ts` (4)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `PublicPresenceController.funnel` | GET | `/businesses/:businessId/reports/presence/funnel` | open | follow-up: `analytics:read` (membership-only read; no enforced module scope) |
| `PublicPresenceController.overview` | GET | `/businesses/:businessId/presence/stats/overview` | open | follow-up: `analytics:read` (membership-only read; no enforced module scope) |
| `PublicPresenceController.pages` | GET | `/businesses/:businessId/reports/presence/pages` | open | follow-up: `analytics:read` (membership-only read; no enforced module scope) |
| `PublicPresenceController.sources` | GET | `/businesses/:businessId/reports/presence/sources` | open | follow-up: `analytics:read` (membership-only read; no enforced module scope) |

### `modules/push-notifications/push-notification.controller.ts` (1)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `PushNotificationController.getConfig` | GET | `/api/businesses/:businessId/push/config` | exempt-own | public `VAPID_PUBLIC_KEY` and boolean enabled flag required for caller's own device push subscription |

### `modules/reports/reports.controller.ts` (2)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `ReportsController.apAging` | GET | `/businesses/:businessId/reports/ap-aging` | open | follow-up: `analytics:read` (membership-only read; no enforced module scope) |
| `ReportsController.expenseBy` | GET | `/businesses/:businessId/reports/expense-by` | open | follow-up: `analytics:read` (membership-only read; no enforced module scope) |

### `modules/retainers/retainer.controller.ts` (3)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `RetainerController.findById` | GET | `/retainers/businesses/:businessId/:id` | open | follow-up: `revenue:read` (membership-only read; no enforced module scope) |
| `RetainerController.list` | GET | `/retainers/businesses/:businessId` | open | follow-up: `revenue:read` (membership-only read; no enforced module scope) |
| `RetainerController.summary` | GET | `/retainers/businesses/:businessId/summary` | open | follow-up: `revenue:read` (membership-only read; no enforced module scope) |

### `modules/seo/seo.controller.ts` (12)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `SeoController.getContentBriefDetail` | GET | `/seo/businesses/:businessId/briefs/:briefId` | open | follow-up: `content:read` (`SeoAdminGuard` only enforces a `comingSoon` feature-flag rollout gate, not tenant role or module authority) |
| `SeoController.getContentBriefs` | GET | `/seo/businesses/:businessId/briefs` | open | follow-up: `content:read` (`SeoAdminGuard` only enforces a `comingSoon` feature-flag rollout gate, not tenant role or module authority) |
| `SeoController.getContentGaps` | GET | `/seo/businesses/:businessId/content-gaps` | open | follow-up: `content:read` (`SeoAdminGuard` only enforces a `comingSoon` feature-flag rollout gate, not tenant role or module authority) |
| `SeoController.getDashboard` | GET | `/seo/businesses/:businessId/dashboard` | open | follow-up: `analytics:read` (`SeoAdminGuard` only enforces a `comingSoon` feature-flag rollout gate, not tenant role or module authority) |
| `SeoController.getGa4Status` | GET | `/seo/businesses/:businessId/connectors/ga4` | open | follow-up: `analytics:read` (`SeoAdminGuard` only enforces a `comingSoon` feature-flag rollout gate, not tenant role or module authority) |
| `SeoController.getGscStatus` | GET | `/seo/businesses/:businessId/connectors/gsc` | open | follow-up: `analytics:read` (`SeoAdminGuard` only enforces a `comingSoon` feature-flag rollout gate, not tenant role or module authority) |
| `SeoController.getIssues` | GET | `/seo/businesses/:businessId/issues` | open | follow-up: `analytics:read` (`SeoAdminGuard` only enforces a `comingSoon` feature-flag rollout gate, not tenant role or module authority) |
| `SeoController.getKeywordHistory` | GET | `/seo/businesses/:businessId/keywords/:keywordId/history` | open | follow-up: `analytics:read` (`SeoAdminGuard` only enforces a `comingSoon` feature-flag rollout gate, not tenant role or module authority) |
| `SeoController.getKeywords` | GET | `/seo/businesses/:businessId/keywords` | open | follow-up: `analytics:read` (`SeoAdminGuard` only enforces a `comingSoon` feature-flag rollout gate, not tenant role or module authority) |
| `SeoController.getPageDetail` | GET | `/seo/businesses/:businessId/pages/:pageId` | open | follow-up: `content:read` (`SeoAdminGuard` only enforces a `comingSoon` feature-flag rollout gate, not tenant role or module authority) |
| `SeoController.getPages` | GET | `/seo/businesses/:businessId/pages` | open | follow-up: `content:read` (`SeoAdminGuard` only enforces a `comingSoon` feature-flag rollout gate, not tenant role or module authority) |
| `SeoController.getRevenueAttribution` | GET | `/seo/businesses/:businessId/revenue-attribution` | open | follow-up: `revenue:read` (`SeoAdminGuard` only enforces a `comingSoon` feature-flag rollout gate, not tenant role or module authority; returns SEO revenue attribution to any business member once live) |

### `modules/shopify/shopify.controller.ts` (1)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `ShopifyController.test` | GET | `/shopify/businesses/:businessId/test` | open | follow-up: `storefront:read` (membership-only read; no enforced module scope) |

### `modules/site/presence/presence.controller.ts` (8)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `PresenceController.completeness` | GET | `/site/presence/businesses/:businessId/completeness` | open | follow-up: `content:read` (site draft completeness currently membership-only) |
| `PresenceController.getDiff` | GET | `/site/presence/businesses/:businessId/diff` | open | follow-up: `content:read` (site draft diff currently membership-only) |
| `PresenceController.getInsights` | GET | `/site/presence/businesses/:businessId/insights` | open | follow-up: `analytics:read` (storefront presence insights currently membership-only) |
| `PresenceController.getOverview` | GET | `/site/presence/businesses/:businessId/overview` | exempt-check | service-check:getOverviewForReader filters revenue metrics below `revenue:read` |
| `PresenceController.getTodayStats` | GET | `/site/presence/businesses/:businessId/today-stats` | exempt-check | service-check:getTodayStats filters revenue totals below `revenue:read` |
| `PresenceController.listBookings` | GET | `/site/presence/businesses/:businessId/bookings` | open | follow-up: `bookings:read` (storefront bookings feed currently membership-only) |
| `PresenceController.listLeads` | GET | `/site/presence/businesses/:businessId/leads` | exempt-check | service-check:listStorefrontLeads filters storefront leads by caller's CRM visibility |
| `PresenceController.listOrders` | GET | `/site/presence/businesses/:businessId/orders` | exempt-check | service-check:listStorefrontOrders filters storefront order totals below `revenue:read` |

### `modules/site/site.controller.ts` (16)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `SiteController.getAnalytics` | GET | `/site/businesses/:businessId/analytics` | open | follow-up: `storefront:read` (membership-only read; no enforced module scope) |
| `SiteController.getConversionFunnel` | GET | `/site/businesses/:businessId/conversion-funnel` | open | follow-up: `storefront:read` (membership-only read; no enforced module scope) |
| `SiteController.getConversionFunnelDaily` | GET | `/site/businesses/:businessId/conversion-funnel/daily` | exempt-check | check:readsRevenue withholds financial/revenue sections or figures below `revenue:read` |
| `SiteController.getConversionSuggestions` | GET | `/site/businesses/:businessId/conversion-suggestions` | open | follow-up: `storefront:read` (membership-only read; no enforced module scope) |
| `SiteController.getOrderDetail` | GET | `/site/businesses/:businessId/orders/:orderId` | exempt-check | check:readsRevenue withholds financial/revenue sections or figures below `revenue:read` |
| `SiteController.getOrderSummary` | GET | `/site/businesses/:businessId/orders/summary` | exempt-check | check:readsRevenue withholds financial/revenue sections or figures below `revenue:read` |
| `SiteController.getProductHealth` | GET | `/site/businesses/:businessId/product-health` | open | follow-up: `storefront:read` (membership-only read; no enforced module scope) |
| `SiteController.getQualificationAnalytics` | GET | `/site/businesses/:businessId/qualification-analytics` | open | follow-up: `storefront:read` (membership-only read; no enforced module scope) |
| `SiteController.getQualificationConfig` | GET | `/site/businesses/:businessId/qualification-config` | open | follow-up: `storefront:read` (membership-only read; no enforced module scope) |
| `SiteController.getSeoHealth` | GET | `/site/businesses/:businessId/seo-health` | open | follow-up: `storefront:read` (membership-only read; no enforced module scope) |
| `SiteController.getStorefrontConfig` | GET | `/site/businesses/:businessId/storefront` | open | follow-up: `storefront:read` (membership-only read; no enforced module scope) |
| `SiteController.listBusinessReviews` | GET | `/site/businesses/:businessId/reviews` | open | follow-up: `storefront:read` (membership-only read; no enforced module scope) |
| `SiteController.listCaseStudies` | GET | `/site/businesses/:businessId/case-studies` | open | follow-up: `storefront:read` (membership-only read; no enforced module scope) |
| `SiteController.listIntakeSubmissions` | GET | `/site/businesses/:businessId/intake` | open | follow-up: `storefront:read` (membership-only read; no enforced module scope) |
| `SiteController.listOrders` | GET | `/site/businesses/:businessId/orders` | exempt-check | check:readsRevenue withholds financial/revenue sections or figures below `revenue:read` |
| `SiteController.listPromoCodes` | GET | `/site/businesses/:businessId/promo-codes` | open | follow-up: `storefront:read` (membership-only read; no enforced module scope) |

### `modules/social/social.controller.ts` (3)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `SocialController.getAccountMetrics` | GET | `/social/businesses/:businessId/account-metrics` | open | follow-up: `content:read` (membership-only read; no enforced module scope) |
| `SocialController.getAnalytics` | GET | `/social/businesses/:businessId/analytics` | open | follow-up: `content:read` (membership-only read; no enforced module scope) |
| `SocialController.listPosts` | GET | `/social/businesses/:businessId/posts` | open | follow-up: `content:read` (membership-only read; no enforced module scope) |

### `modules/sop/sop.controller.ts` (2)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `SopController.get` | GET | `/sop/businesses/:businessId/sops/:id` | open | follow-up: `operations:read` (membership-only read; no enforced module scope) |
| `SopController.list` | GET | `/sop/businesses/:businessId/sops` | open | follow-up: `operations:read` (membership-only read; no enforced module scope) |

### `modules/subscriptions/subscriptions.controller.ts` (5)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `SubscriptionsController.checkLimit` | GET | `/subscriptions/businesses/:businessId/check-limit/:resource` | open | follow-up: `revenue:read` (membership-only read; no enforced module scope) |
| `SubscriptionsController.getBillingDashboard` | GET | `/subscriptions/businesses/:businessId/billing-dashboard` | open | follow-up: `revenue:read` (membership-only read; no enforced module scope) |
| `SubscriptionsController.getCurrentSubscription` | GET | `/subscriptions/businesses/:businessId/current` | open | follow-up: `revenue:read` (membership-only read; no enforced module scope) |
| `SubscriptionsController.getHistory` | GET | `/subscriptions/businesses/:businessId/history` | open | follow-up: `revenue:read` (membership-only read; no enforced module scope) |
| `SubscriptionsController.getPaymentHistory` | GET | `/subscriptions/businesses/:businessId/payments` | open | follow-up: `revenue:read` (membership-only read; no enforced module scope) |

### `modules/supplier/supplier.controller.ts` (3)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `SupplierController.getMarginSnapshots` | GET | `/supplier/businesses/:businessId/products/:productId/margin-snapshots` | open | follow-up: `storefront:read` (membership-only read; no enforced module scope) |
| `SupplierController.getProductCostProfile` | GET | `/supplier/businesses/:businessId/products/:productId/cost-profile` | open | follow-up: `storefront:read` (membership-only read; no enforced module scope) |
| `SupplierController.getProductVariants` | GET | `/supplier/businesses/:businessId/products/:productId/variants` | open | follow-up: `storefront:read` (membership-only read; no enforced module scope) |

### `modules/task-assignments/task-assignment.controller.ts` (3)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `TaskAssignmentController.forAssignee` | GET | `/businesses/:businessId/task-assignments/for-assignee/:assignableType/:assignableId` | open | follow-up: `projects:read` (membership-only read; no enforced module scope) |
| `TaskAssignmentController.forTask` | GET | `/businesses/:businessId/task-assignments/for-task/:taskType/:taskId` | open | follow-up: `projects:read` (membership-only read; no enforced module scope) |
| `TaskAssignmentController.options` | GET | `/businesses/:businessId/task-assignments/options` | open | follow-up: `projects:read` (membership-only read; no enforced module scope) |

### `modules/temporal-flow/temporal-flow.controller.ts` (6)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `TemporalFlowController.calendar` | GET | `/temporal-flow/businesses/:businessId/calendar` | exempt-check | check:readerFilter enforces caller's module scopes on temporal calendar range |
| `TemporalFlowController.list` | GET | `/temporal-flow/businesses/:businessId` | exempt-check | check:readerFilter enforces caller's module scopes on temporal flow events |
| `TemporalFlowController.listMemory` | GET | `/temporal-flow/businesses/:businessId/memory` | exempt-check | check:memorySight filters temporal memory entries by caller's module scopes |
| `TemporalFlowController.memoryByEntity` | GET | `/temporal-flow/businesses/:businessId/memory/by-entity/:entityType/:entityId` | exempt-check | check:memorySight filters entity temporal memory entries by caller's module scopes |
| `TemporalFlowController.reminders` | GET | `/temporal-flow/businesses/:businessId/reminders` | exempt-check | check:readerFilter enforces caller's module scopes on due reminders |
| `TemporalFlowController.searchMemory` | GET | `/temporal-flow/businesses/:businessId/memory/search` | exempt-check | check:memorySight filters temporal memory search results before limit (MEM-TEMPORAL-MEMORY-ROUTES-SIGHT) |

### `modules/temporal/temporal.controller.ts` (1)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `TemporalController.getOverview` | GET | `/temporal/businesses/:businessId/overview` | open | follow-up: `operations:read` (membership-only read; no enforced module scope) |

### `modules/time-tracking/time-entry.controller.ts` (5)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `TimeEntryController.findById` | GET | `/time-entries/businesses/:businessId/:id` | open | follow-up: `projects:read` (membership-only read; no enforced module scope) |
| `TimeEntryController.getProjectTotalTime` | GET | `/time-entries/businesses/:businessId/projects/:projectId/total-time` | open | follow-up: `projects:read` (membership-only read; no enforced module scope) |
| `TimeEntryController.getRunningTimer` | GET | `/time-entries/businesses/:businessId/running` | open | follow-up: `projects:read` (membership-only read; no enforced module scope) |
| `TimeEntryController.getSummary` | GET | `/time-entries/businesses/:businessId/summary` | open | follow-up: `projects:read` (membership-only read; no enforced module scope) |
| `TimeEntryController.list` | GET | `/time-entries/businesses/:businessId` | open | follow-up: `projects:read` (membership-only read; no enforced module scope) |

### `modules/timeline/timeline.controller.ts` (3)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `TimelineController.getDaySummary` | GET | `/timeline/businesses/:businessId/summary/:date` | exempt-check | service-check:resolveTimelineViewer filters day summary events by the caller's module scopes (D-63, D-118) |
| `TimelineController.getUpcoming` | GET | `/timeline/businesses/:businessId/upcoming` | exempt-check | service-check:resolveTimelineViewer filters upcoming actions by the caller's module scopes (D-63, D-118) |
| `TimelineController.queryEvents` | GET | `/timeline/businesses/:businessId/events` | exempt-check | service-check:resolveTimelineViewer filters timeline events by the caller's module scopes (D-63, D-118) |

### `modules/trash/trash.controller.ts` (1)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `TrashController.listTrashed` | GET | `/api/businesses/:businessId/trash` | exempt-check | check:readAccess and check:readRefusal enforce per-model module read scope (D-95) plus CRM contact visibility; note `@RequireModuleScope('settings')` is inert without `ModuleScopeGuard` |

### `modules/voice/voice.controller.ts` (1)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `VoiceController.listProviders` | GET | `/voice/businesses/:businessId/providers` | open | follow-up: `ai:read` (membership-only read; no enforced module scope) |

### `modules/whatsapp/whatsapp.controller.ts` (4)

| route | verb | path | disposition | reason |
| --- | --- | --- | --- | --- |
| `WhatsAppController.getConversation` | GET | `/whatsapp/businesses/:businessId/conversations/:conversationId` | exempt-guard | guard:WhatsAppOperationsScopeGuard (extends ModuleScopeGuard to enforce `operations:read` plus config owner, R0-SEC2) |
| `WhatsAppController.getStatus` | GET | `/whatsapp/businesses/:businessId/status` | exempt-guard | guard:WhatsAppOperationsScopeGuard (extends ModuleScopeGuard to enforce `operations:read` plus config owner, R0-SEC2) |
| `WhatsAppController.listConversations` | GET | `/whatsapp/businesses/:businessId/conversations` | exempt-guard | guard:WhatsAppOperationsScopeGuard (extends ModuleScopeGuard to enforce `operations:read` plus config owner, R0-SEC2) |
| `WhatsAppController.listTemplates` | GET | `/whatsapp/businesses/:businessId/templates` | exempt-guard | guard:WhatsAppOperationsScopeGuard (extends ModuleScopeGuard to enforce `operations:read` plus config owner, R0-SEC2) |
