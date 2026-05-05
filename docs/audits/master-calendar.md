# Master Calendar Audit & Inventory (Phase 1 — C0)

Status: Audit only. No refactor performed. This document is the single
authoritative inventory of every calendar-like surface, every Prisma
model with date-bearing fields, every Google Calendar code path, and
every event-bus event whose payload implies a scheduled/due moment.
Downstream milestones C1–C7 will refactor against this baseline.

Repository commit context: snapshot of the working tree at the time of
task #490 (C0).

---

## 1. Surface inventory (calendar-like UI + API)

### 1a. Server (NestJS, `apps/server`)

| Surface | File | Responsibility |
|---|---|---|
| Booking ↔ Google Calendar service | `apps/server/src/modules/bookings/calendar.service.ts:34` | The single Google Calendar OAuth + event CRUD service. Owns OAuth URL/state, token refresh, list/create/patch/delete events, conflict scan, conflict resolution, booking → calendar push. |
| Booking controller calendar routes | `apps/server/src/modules/bookings/bookings.controller.ts:345-630` | HTTP surface for everything the calendar service exposes. Routes: `GET businesses/:id/calendar/auth-url`, `GET calendar/callback`, `GET businesses/:id/calendar/status`, `POST businesses/:id/calendar/disconnect`, `GET/POST businesses/:id/calendar/events`, `PATCH/DELETE businesses/:id/calendar/events/:eventId`, `GET businesses/:id/calendar/list`, `PATCH businesses/:id/calendar/settings`, `GET businesses/:id/calendar/conflicts`, `POST businesses/:id/calendar/conflicts/scan`, `POST businesses/:id/calendar/conflicts/:id/resolve`, `POST businesses/:id/bookings/:bookingId/sync-to-calendar`. |
| Booking → calendar push hook (location update) | `apps/server/src/modules/bookings/bookings.controller.ts:82-86` | When a booking with `calendarEventId` is updated (location), fires `calendar.syncBookingToCalendar` fire-and-forget. |
| Connector facade | `apps/server/src/core/connectors/implementations/google-calendar.connector.ts:8` | Wraps the same Business token columns to expose Google Calendar through the unified Connector interface (`healthCheck`, `sync`, `testConnection`, `smokeTest`, `disconnect`, `emitCalendarEventCreated`, `emitCalendarEventUpdated`). Emits `calendar_event.created` / `calendar_event.updated` on the EventEmitter2 bus. **Independent code path** from `CalendarService`; both touch `Business.calendar*` columns directly. |
| Unified timeline aggregator | `apps/server/src/modules/keyflow-command/keyflow-command.service.ts:31` (`KeyflowCommandService.listUnifiedEvents`) | Aggregates Bookings + ContactTasks + ProjectTasks + AutopilotTasks + Project deadlines + Google events into a `KeyflowEvent[]` for the Keyflow Command unified calendar. Calls `CalendarService.listCalendarEvents` to fold in Google events. |
| Calendar controller test | `apps/server/test/calendar.controller.test.ts` | Vitest harness mocking `patch/create/delete/syncBookingToCalendar/listCalendarEvents`. |

### 1b. Web (Next.js, `apps/web`)

| Surface | File | Notes |
|---|---|---|
| Bookings calendar shell | `apps/web/src/app/app/bookings/calendar/calendar-view.tsx:44` | Toggle between Month/Week/Day. Consumes `bookings: Booking[]` + `googleEvents: GoogleCalendarEvent[]`. |
| Bookings — Month grid | `apps/web/src/app/app/bookings/calendar/month-grid.tsx` | Month view of bookings. |
| Bookings — Week timeline | `apps/web/src/app/app/bookings/calendar/week-timeline.tsx` | Week timeline of bookings. |
| Bookings — Day timeline | `apps/web/src/app/app/bookings/calendar/day-timeline.tsx` | Day timeline of bookings. |
| Bookings — compact week strip | `apps/web/src/app/app/bookings/components/week-calendar.tsx:31` | Lightweight week strip used inside the bookings list view (separate from `calendar-view.tsx`). |
| Marketing calendar tab | `apps/web/src/app/app/marketing/components/marketing-calendar-tab.tsx:64` (mounted from `apps/web/src/app/app/marketing/page.tsx`) | Builds a local month/week calendar from `EmailCampaign.scheduledAt|sentAt` + `SocialPost.scheduledAt|publishedAt`. Pure client-side projection — does not call calendar.service. |
| Social content calendar | `apps/web/src/app/app/marketing/components/social/content-calendar.tsx:1` | Second marketing calendar (posts + bookings) used inside the social tab. Independent build from `SocialPost` + `Booking`. |
| Project detail "Calendar" tab | `apps/web/src/app/app/projects/components/project-detail-tabs/calendar-tab.tsx:14` | Per-project mini timeline showing project `dueDate`, milestones (`{ id, title, dueDate }`), and the linked `Booking` if any. Independent of CalendarService. |
| Keyflow Command unified calendar | `apps/web/src/app/app/keyflow-command/components/unified-calendar.tsx:70` | The closest thing to a "master calendar" today. Renders `KeyflowEvent[]` from `fetchKeyflowEvents` with view modes week/day/agenda and an event drawer. Uses kinds: `booking | contact_task | project_task | autopilot_task | project_deadline | google_event`. |
| Calendar event drawer e2e | `apps/web/e2e/calendar-event-drawer.spec.ts` | Playwright spec for the unified-calendar drawer. |
| OAuth callback proxy | `apps/web/src/app/api/bookings/calendar/callback/route.ts:5` | Forwards Google OAuth callback to `${API_BASE}/bookings/calendar/callback` and follows the Location header. |
| Connect → Calendar settings page | `apps/web/src/app/app/connect/calendar/page.tsx:1` | Connect / disconnect Google, choose target calendar, set sync direction (`push | pull | two_way | disabled`), view conflicts, run conflict scan, resolve `keep_keyflow | keep_external | dismissed`. |
| Web client wrappers | `apps/web/src/lib/client.ts:2755` (`syncBookingToCalendar`), `apps/web/src/lib/client.ts:9060-9103` (`KeyflowEvent`, `fetchKeyflowEvents`) | Typed client functions used by the surfaces above. |

### 1c. Surfaces NOT yet on any calendar (relevant for C5/C6)

The following date-bearing concepts are visible in lists/cards in the
app but have **no calendar surface** today:

- CRM contact tasks (`ContactTask.dueDate`) — only surfaced via task
  list and (now) Keyflow Command's unified calendar.
- Quote expiry (`Quote.expiryDate`) — only on quote detail.
- Invoice due date (`Invoice.dueDate`) — only on invoice detail / list.
- Recurring invoice next run (`RecurringInvoice.nextRunDate`/`endDate`).
- Sequence step due (`OutboundDelivery.scheduledAt`, `OutboundContent.scheduledAt`).
- Scheduled agent jobs (`ScheduledAgentJob.scheduledFor`).
- Project milestones — currently passed in to the Project Calendar tab
  as ad-hoc props, not persisted as first-class events.

---

## 2. Date-bearing model inventory (`packages/db/prisma/schema.prisma`)

### Methodology

This inventory was produced by mechanically scanning
`packages/db/prisma/schema.prisma` for every `DateTime` field, then
filtering to fields whose name implies a *scheduled moment a calendar
could surface*: `start*`, `end*`, `*Date`, `due*`, `scheduled*`,
`remind*`, `expir*`, `nextRun*`, `nextStep*`, `nextRetry*`,
`nextActionAt`, `period*`, `valid*`, `*Until`, `effectiveDate`,
`expectedDelivery`, `expectedDate`, `estimatedDelivery`,
`snapshotDate`, `occurredAt`, `breakEvenDate`, `superseded*`. Pure
audit timestamps (`createdAt`, `updatedAt`, `deletedAt`,
`*At`-completion markers like `completedAt`, `paidAt`, `sentAt`,
`receivedAt`, `respondedAt`, `resolvedAt`, `acknowledgedAt`,
`actionedAt`, `dismissedAt`, `archivedAt`, `verifiedAt`,
`computedAt`, `calculatedAt`, `lastSyncAt`, `lastUsedAt`,
`lastReadAt`, `lastReplyAt`, `lastSentAt`, `lastInteractionAt`,
`lastContactedAt`, `lastCheckedAt`, `lastMessageAt`,
`lastBackfillAt`, `lastSeenResponseTime`, `lastUpdated`,
`lastCrawled`, `lastCalculatedAt`, `lastHealthCheck`,
`firstTouchAt`, `lastTouchAt`, `lastRunAt`, `executedAt`,
`startedAt`, `addedAt`, `appliedAt`, `joinedAt`, `convertedAt`,
`bouncedAt`, `openedAt`, `clickedAt`, `failedAt`, `bottleneckAt`,
`healthScoreAt`, `wonAt`, `lostAt`, `cancelledAt`, `revertedAt`,
`approvedAt`, `submittedAt`, `clearedAt`, `filedAt`, `endedAt`,
`acceptedAt`, `lastStageChangedAt`, `lastVerifiedAt`,
`dataQualityCheckedAt`, `bestSignalUpdatedAt`, `dismissedAt`,
`reminderSentAt`, `revokedAt`, `dataQualityLastRunAt`,
`*LastSyncAt`, `consumedAt`, `lastDownloadedAt`, `hitAt`,
`detectedAt`, `acknowledgedAt`, `actionedAt`, `applieddAt`,
`shippedAt`, `deliveredAt`, `fulfilledAt`, `revertedAt`,
`bottleneckAt`) are excluded — they record what already happened, not
what is yet to happen.

Token-expiry fields on connector models are included (they are
"future" datetimes) but flagged as infrastructure, not user-facing.

Per-row legend: ✅ = currently rendered on at least one calendar
surface; ⚠️ = used in lists/cards but not on a calendar; ❌ = no UI
consumer on a calendar at all.

### Calendar-relevant models, exhaustively

| # | Model | Defined at | Scheduled / due / expiry / start-end / remind fields (line) | Surface today |
|---|---|---|---|---|
| 1 | `Business` | 37 | `lastHealthCheck`(101); `gmailTokenExpiry`(284); `calendarTokenExpiry`(290); `driveTokenExpiry`(300); `formsTokenExpiry`(306); `contactsTokenExpiry`(312); `msContactsTokenExpiry`(320); `bpTokenExpiry`(331) | infrastructure only (token plumbing for Gmail, Calendar, Drive, Forms, Contacts, MS Contacts, Business Profile) — not a calendar surface |
| 2 | `Session` | 415 | `expiresAt`(430) | infrastructure (session expiry) |
| 3 | `Contact` | 428 | `nextActionAt`(487) | ⚠️ shown in inbox/contact card; not on any calendar |
| 4 | `Deal` | 576 | `expectedCloseAt`(614) | ⚠️ pipeline only — **not on any calendar** |
| 5 | `CalendarSyncConflict` | 781 | `bookingStart`(782), `bookingEnd`(783), `externalStart`(784), `externalEnd`(785) | ✅ Connect → Calendar settings (conflict list/resolve) |
| 6 | `ContactTask` | 988 | `dueDate`(989); `remindAt`(992) | ✅ Keyflow Command unified calendar (`contact_task` kind, line 73 of `keyflow-command.service.ts`) |
| 7 | `MergeOperation` | 1107 | `expiresAt`(1112) | infrastructure (revert window) |
| 8 | `Quote` | 1217 | `issueDate`(1219); `expiryDate`(1220) | ❌ no calendar surface — quote detail page only |
| 9 | `Invoice` | 1268 | `issueDate`(1270); `dueDate`(1271) | ❌ no calendar surface — invoice list/detail only |
| 10 | `PaymentLink` | 1364 | `expiresAt`(1366) | infrastructure |
| 11 | `Booking` | 1437 | `startTime`(1437); `endTime`(1438); `reminderSentAt`(1458) | ✅ Bookings calendar, Keyflow Command (`booking` kind), marketing/social calendars; `calendarEventId` mirrors to Google |
| 12 | `Availability` | 1424 | weekly `startTime`/`endTime` strings (HH:MM by `dayOfWeek`) | ⚠️ booking-form availability picker only — **not rendered on any calendar surface** |
| 13 | `SocialConnection` | 1478 | `expiresAt`(1480) | infrastructure (social token expiry) |
| 14 | `SocialPost` | 1497 | `scheduledAt`(1500) | ✅ `marketing-calendar-tab.tsx` + `social/content-calendar.tsx` |
| 15 | `ChannelConnection` | 1525 | `expiresAt`(1530) | infrastructure |
| 16 | `OutboundContent` | 1525 | `scheduledAt`(1581) | ❌ no calendar surface |
| 17 | `OutboundDelivery` | 1620 | `scheduledAt`(1634); `nextRetryAt`(1642) | ❌ no calendar surface (sequence list only) |
| 18 | `WhatsAppMessage` | 1717 | `scheduledAt`(1723) | ❌ no calendar surface (chat thread only) |
| 19 | `ScheduledAgentJob` | 1791 | `scheduledFor`(1797) | ❌ no calendar surface (job runner internal) |
| 20 | `Project` | 1841 | `dueDate`(1846) | ✅ Keyflow Command (`project_deadline` kind); also Project detail Calendar tab (date list, not a real calendar) |
| 21 | `ProjectTask` | 1860 | `dueDate`(1862) | ✅ Keyflow Command (`project_task` kind) |
| 22 | `AutopilotTask` | 1925 | `scheduledFor`(1944); `dueDate`(1945) | ✅ Keyflow Command (`autopilot_task` kind) |
| 23 | `DelegationLoop` | 1973 | `nextRunAt`(1978); `intervalMin` | ❌ no calendar surface (loop config screen only) |
| 24 | `Subscription` | 2068 | `trialEndsAt`(2072); `currentPeriodStart`(2073); `currentPeriodEnd`(2074) | ⚠️ billing screen only |
| 25 | `SubscriptionPayment` | 2103 | `periodStart`(2106); `periodEnd`(2107) | ⚠️ billing history only |
| 26 | `Expense` | 2168 | `date`(2169) | ⚠️ expense ledger only |
| 27 | `RecurringInvoice` | 2226 | `nextRunDate`(2230); `endDate`(2232) | ❌ no calendar surface (recurring-invoice list only) |
| 28 | `EmailCampaign` | 2266 | `scheduledAt`(2269) | ✅ `marketing-calendar-tab.tsx` |
| 29 | `RelationshipInsightDismissal` | 2710 | `snoozedUntil`(2716) | infrastructure (snooze window) |
| 30 | `Shipment` | 3007 | `estimatedDelivery`(3011) | ⚠️ fulfilment screen — not a calendar |
| 31 | `PreOrder` | 3076 | `expectedDate`(3080) | ⚠️ pre-order list — not a calendar |
| 32 | `PurchaseOrder` | 3115 | `expectedDelivery`(3120) | ⚠️ PO list — not a calendar |
| 33 | `CrmSequenceEnrollment` | 3160 | `nextStepAt`(3164) | ❌ no calendar surface |
| 34 | `MomentumRecommendation` | 3232 | `scheduledFor`(3240); `snoozedUntil`(3236) | ❌ no calendar surface (recommendation cards only) |
| 35 | `ApiKey` | 3258 | `revokedAt`(3261) | infrastructure |
| 36 | `RevenueProfile` | 3429 | `breakEvenDate`(3430) | ⚠️ revenue dashboard only |
| 37 | `RoadmapItem` | 3801 | `startDate`(3802); `dueDate`(3803) | ❌ no calendar surface (roadmap list only) |
| 38 | `ProgressSnapshot` | 3826 | `snapshotDate`(3827) | n/a (analytics snapshot) |
| 39 | `PromoCode` | 3845 | `validFrom`(3848); `validTo`(3849) | ⚠️ promo-code admin list |
| 40 | `DocumentInstance` | 4035 | `effectiveDate`(4038); `expiryDate`(4039) | ⚠️ document list — not on a calendar |
| 41 | `DocumentVersion` | 4067 | `effectiveDate`(4071); `supersededDate`(4072) | ⚠️ version history only |
| 42 | `AiMemory` | 4576 | `expiresAt`(4579) | infrastructure |
| 43 | `Opportunity` | 4861 | `expiresAt`(4864) | ⚠️ marketplace listing only |
| 44 | `PartnerProgram` | 4911 | `startDate`(4914); `endDate`(4915) | ⚠️ partner-program admin |
| 45 | `RankingSnapshot` | 5108 | `snapshotDate`(5110) | n/a (analytics snapshot) |
| 46 | `AttributionResult` | 5298 | `periodStart`(5300); `periodEnd`(5301) | n/a (analytics window) |
| 47 | `JourneyTouchpoint` | 5273 | `occurredAt`(5274) | n/a (already-occurred analytics) |
| 48 | `GrowthInsight` | 5350 | `expiresAt`(5353) | infrastructure (insight expiry) |
| 49 | `ContactExportJob` | 5491 | `expiresAt`(5492) | infrastructure (export download window) |

### Models scanned and explicitly excluded from C1 backfill

The scan also touched the following models. Each has only "what
already happened" timestamps (`*completedAt`, `*sentAt`, `*paidAt`,
`*resolvedAt`, `*executedAt`, `*startedAt`, `*lastSyncAt`, etc.) and
therefore contributes nothing to a *future* calendar projection. They
are listed here so the next agent does not have to re-derive the
exclusion set:

`User` (15), `Membership` (376), `TeamActivityLog` (396),
`DealStage` (554), `ContactRelationship` (623), `ContactShare` (646),
`ContactDataIssue` (666), `ContactExternalMapping` (692),
`WonLostReason` (725), `ConnectorStatus` (802),
`ConnectorActivityLog` (823), `ContactEvent` (840),
`ContactReadState` (858), `ContactChannelStat` (876),
`ConversationAIInsight` (898), `ContactNote` (938),
`ContactInsightSnapshot` (951), `ContactImport` (1011),
`ContactImportContact` (1031), `ContactMedia` (1048),
`ContactPlaybook` (1064), `ContactList` (1082),
`ContactSavedView` (1122), `ContactListMember` (1138),
`Product` (1154), `QuoteItem` (1242), `InvoiceItem` (1306),
`Payment` (1323), `WebhookEvent` (1348), `StaffMember` (1379),
`Service` (1398), `DeliveryEvent` (1664), `WhatsAppContact` (1690),
`Automation` (1747), `CrossModuleWorkflow` (1769),
`Activity` (1808), `ProjectTemplate` (1882), `Site` (1901),
`DelegationLoopRun` (1992), `Notification` (2024),
`CustomerNotificationLog` (2039), `AiUsageLog` (2118),
`ExpenseCategory` (2149), `ExpenseBudget` (2203),
`CampaignBriefing` (2299), `EmailCampaignContact` (2321),
`LeadForm` (2344), `GoogleFormMapping` (2365),
`LeadFormSubmission` (2389), `BusinessTemplate` (2411),
`BusinessTemplateUsage` (2430), `LandingPage` (2447),
`Course` (2471), `CourseEnrollment` (2496), `Cohort` (2516),
`CohortMember` (2534), `CommunityPost` (2547),
`CommunityComment` (2572), `NetworkConnection` (2587),
`Endorsement` (2603), `Conversation` (2620), `DirectMessage` (2638),
`CollaborationRequest` (2654), `CommunityNotification` (2674),
`MatchFeedback` (2693), `Webhook` (2735), `MarketplaceListing` (2753),
`FulfillmentRoute` (2796), `ShippingZone` (2836),
`Warehouse` (2859), `InventoryStock` (2882), `CustomsDeclaration`
(3047), `Supplier` (3088), `RestockSuggestion` (3137),
`ContactMomentum` (3183), `ContactMomentumSnapshot` (3207),
`BusinessGuidanceProfile` (3295),
`ComplianceGuidanceProfile` (3499), `GuidanceRecommendation` (3767),
`AiPlan` (4602), `AiPlanStep` (4655),
`OperationsGuidanceProfile`, `MarketingGuidanceProfile`,
`SalesGuidanceProfile`, `TeamGuidanceProfile`,
`TechnologyGuidanceProfile`, `LegalGuidanceProfile`,
`HrGuidanceProfile`, `QualificationJourney` (4273),
`QualificationStep`, `QualificationStepEvent`,
`SupplierConnection` (4316), `AiApprovalItem` (4523),
`BusinessMatch` (4625), `CommunityQuoteRequest` (4684),
`CommunityCollaboration` (4732), `BusinessMessage` (4752),
`BusinessReputation` (4826), `OpportunityApplication` (4887),
`SeoPage` (5042), `SeoKeyword` (5080), `SeoIssue` (5131),
`ContentBrief` (5167), `CustomerJourney` (5196),
`AuthRateLimit` (5374).

Soft-delete (`deletedAt`) and audit (`createdAt`/`updatedAt`)
columns are excluded across every model.

---

## 3. Google Calendar sync trace (end-to-end)

### 3.1 Token storage

Tokens live as **columns on `Business`** (not a separate
`CalendarConnection` table):

```
calendarEmail          (calendar_email)
calendarAccessToken    (calendar_access_token)
calendarRefreshToken   (calendar_refresh_token)
calendarTokenExpiry    (calendar_token_expiry)
calendarId             (calendar_id)            -- target calendar id
calendarSyncDirection  (calendar_sync_direction) -- push | pull | two_way | disabled, default two_way
calendarSyncEnabled    (calendar_sync_enabled)   -- default true
```

`packages/db/prisma/schema.prisma:285-291`. Same columns are read by
`GoogleCalendarConnector` (`healthCheck`, `disconnect`, `isConnected`,
`testConnection`, `smokeTest`).

### 3.2 OAuth flow

1. Browser hits Connect → Calendar page (`apps/web/src/app/app/connect/calendar/page.tsx`).
2. Page calls server route `GET /bookings/businesses/:businessId/calendar/auth-url`
   (`bookings.controller.ts:345`) → `CalendarService.getAuthUrl`
   (`calendar.service.ts:98`) → returns the `accounts.google.com` URL with
   scopes `calendar.events` + `userinfo.email`, `state` HMAC-signed by
   `GOOGLE_STATE_SECRET`, expiry 10 min.
3. Google redirects to `apps/web/src/app/api/bookings/calendar/callback/route.ts`
   which forwards to backend `GET /bookings/calendar/callback`
   (`bookings.controller.ts:351`).
4. Backend verifies state (`CalendarService.verifyState:65`), then
   `saveCalendarCredentials` (calendar.service.ts:129) exchanges the code at
   `https://oauth2.googleapis.com/token`, fetches userinfo, persists
   tokens onto `Business`.

### 3.3 Token refresh

`CalendarService.refreshAccessToken` (calendar.service.ts:446) — refreshes
when `calendarTokenExpiry` is within 5 min, persists new
`calendarAccessToken` + `calendarTokenExpiry` back to Business. **All
Google API calls in this file go through this method.**

### 3.4 Where bookings actually hit Google

All event-CRUD methods are on `CalendarService`:

| Method | Line | Endpoint |
|---|---|---|
| `listAvailableCalendars` | 201 | `GET calendar/v3/users/me/calendarList?minAccessRole=writer` |
| `createCalendarEvent` | 507 | `POST calendar/v3/calendars/{calendarId}/events` |
| `updateCalendarEvent` | 541 | `PUT calendar/v3/calendars/{calendarId}/events/{eventId}` |
| `patchCalendarEvent` | 569 | `PATCH calendar/v3/calendars/{calendarId}/events/{eventId}` |
| `deleteCalendarEvent` | 599 | `DELETE calendar/v3/calendars/{calendarId}/events/{eventId}` |
| `listCalendarEvents` | 703 | `GET calendar/v3/calendars/{calendarId}/events?singleEvents=true&orderBy=startTime` |
| `syncBookingToCalendar` | 619 | Composite: gates on `connected && syncEnabled && direction != pull/disabled`, then PUT-or-POST. On create, persists `Booking.calendarEventId`. Emits `calendar_event.created`/`calendar_event.updated` via the `GoogleCalendarConnector` (calendar.service.ts:672, 689). |
| `removeBookingFromCalendar` | 774 | Deletes the linked event and clears `Booking.calendarEventId`. |
| `scanForConflicts` | 248 | Walks Google events vs CONFIRMED/PENDING bookings in a horizon (default 30 days), inserts `CalendarSyncConflict` rows of type `overlap` or `external_only`. |
| `resolveConflict` | 375 | `keep_keyflow` re-pushes booking and deletes overlapping external event; `keep_external` cancels booking and deletes the duplicate external event. |
| `GoogleCalendarConnector.smokeTest` | google-calendar.connector.ts:152 | Inserts then deletes a 15-minute "Keyflow connection test" event on `primary` — **bypasses `calendarId` setting**. |
| `GoogleCalendarConnector.testConnection` | google-calendar.connector.ts:126 | `GET calendar/v3/calendars/primary/events?maxResults=1` using the raw stored access token (no refresh). |

### 3.5 Where Google sync is triggered from product code

- **Booking location update** — `bookings.controller.ts:82-86`
  fire-and-forget `syncBookingToCalendar` if the booking already has a
  `calendarEventId`.
- **Manual "sync to calendar" button** — `POST businesses/:id/bookings/:bookingId/sync-to-calendar`
  (`bookings.controller.ts:623`) → `syncBookingToCalendar`.
- **Conflict resolution** — `resolveConflict` (`calendar.service.ts:375`)
  re-pushes via `syncBookingToCalendar`.
- **Unified-calendar Google overlay** — `KeyflowCommandService.listUnifiedEvents`
  (`keyflow-command.service.ts:217`) calls `listCalendarEvents` to add
  `google_event` items to the timeline.
- **Conflict scan endpoint** — `POST businesses/:id/calendar/conflicts/scan`
  (`bookings.controller.ts:605`).
- **Connector facade** — `GoogleCalendarConnector.sync` (line 102) is a
  no-op count of upcoming bookings — it does **not** push anything.

> **Gap**: there is no `bookings.created`/`booking.confirmed`/
> `booking.rescheduled`/`booking.cancelled` listener that mirrors the
> booking into Google. Bookings are pushed only on the location-update
> path or via the explicit sync button. This is a known divergence
> (see Risk #2 below).

### 3.6 Sync error paths

- Token refresh failure → throws `BadRequestException('Failed to refresh
  Google Calendar token')` (calendar.service.ts:481).
- 4xx/5xx from Google in `create/update/patch/delete/list` is logged
  (`this.logger.error`) and the method returns `null`/`false`/`[]` —
  callers swallow silently. **No `ConnectorStatus.lastErrorAt` /
  `lastError` write on these paths**, only `GoogleCalendarConnector`
  bumps `lastSyncAt` via `trackActivity` on emit.
- OAuth state failure → user redirected to
  `/app/bookings?calendar=error&reason=invalid_state`.

---

## 4. Event-bus inventory (scheduled/due payloads)

### 4.1 `packages/shared/src/contact-events.ts`

Canonical contact-event names that imply a scheduled or due moment in
their payload:

| Event | Category | Time semantics |
|---|---|---|
| `communication.meeting` | communication | meeting timestamp on Activity |
| `task.created` / `task.updated` / `task.completed` / `task.reopened` / `task.deleted` | crm_movement | `ContactTask.dueDate` / `remindAt` / `completedAt` |
| `next_action.completed` / `next_action.snoozed` | crm_movement | `Contact.nextActionAt` |
| `quote.created` / `quote.sent` / `quote.accepted` / `quote.rejected` | sales_revenue | `Quote.issueDate` / `expiryDate` |
| `invoice.created` / `invoice.sent` / `invoice.overdue` / `invoice.paid` / `invoice.payment_failed` / `invoice.payment_recorded` | sales_revenue | `Invoice.issueDate` / `dueDate` / `sentAt` / `paidAt` |
| `deal.won` / `deal.lost` / `deal.reopened` / `deal.stage_changed` | sales_revenue | `Deal.expectedCloseAt` / `wonAt` / `lostAt` |
| `booking.created` / `booking.confirmed` / `booking.completed` / `booking.cancelled` / `booking.rescheduled` / `booking.status.followup` | delivery_operations | `Booking.startTime` / `endTime` |
| `store_order.created` / `store_order.paid` / `store_order.shipped` / `store_order.delivered` | delivery_operations | order timeline |
| `campaign.sent` / `campaign.opened` | relationship_leverage | `EmailCampaign.scheduledAt` / `sentAt` |
| `followup.scheduled` | relationship_leverage | follow-up time |
| `sequence.enrolled` / `sequence.unenrolled` / `sequence.step.due` / `sequence.step.advanced` / `sequence.step.failed` / `sequence.step.retry` | relationship_leverage | `OutboundDelivery.scheduledAt` |
| `automation.run` / `automation.executed` / `autopilot.executed` / `autopilot.payment_recovery` / `autopilot.lead_reactivation` | ai_system | `AutopilotTask.scheduledFor` / `executedAt` |

### 4.2 NestJS EventEmitter2 events outside contact-events

| Event | Emitter | Payload time fields |
|---|---|---|
| `booking.created` | `bookings.service.ts:519, 728` | `startTime`, `endTime` (booking) |
| `booking.confirmed` | `bookings.service.ts:180, 553` | `startTime`, `endTime` |
| `booking.completed` | `bookings.service.ts:197` | `startTime`, `endTime` |
| `booking.cancelled` | `bookings.service.ts:214` | `startTime`, `endTime` |
| `booking.rescheduled` | `bookings.service.ts:430` | new `startTime`, `endTime` |
| `calendar_event.created` | `google-calendar.connector.ts:254` | `startTime`, `endTime`, `bookingId`, `externalId` |
| `calendar_event.updated` | `google-calendar.connector.ts:270` | `startTime`, `endTime`, `externalId` |
| `entity.resolved` | `google-calendar.connector.ts:244` | resolution context (no time) |

**No `calendar_event.deleted` event is emitted today** even though
`CalendarService.deleteCalendarEvent` and `removeBookingFromCalendar`
exist (Gap, see C7).

---

## 5. Gap list (tagged C1–C7)

These are the gaps this audit uncovered, mapped to the milestones
already declared in the C-roadmap.

### C1 — `CalendarEvent` projection model + backfill
- No single `CalendarEvent` table exists. Every surface is currently a
  per-source projection (Booking, ContactTask, ProjectTask,
  AutopilotTask, Project, EmailCampaign, SocialPost, Google).
- `KeyflowCommandService.listUnifiedEvents` is the only "unified"
  projection and is rebuilt on every request.
- Need backfill from: `Booking`, `ContactTask`, `ProjectTask`,
  `Project (dueDate)`, `AutopilotTask`, `EmailCampaign`, `SocialPost`,
  `Quote (expiryDate)`, `Invoice (dueDate)`, `RecurringInvoice`,
  `OutboundDelivery`, `ScheduledAgentJob`.

### C2 — Calendar API (read/write) on top of the projection
- Today the only "list" API is
  `GET /keyflow-command/businesses/:id/events` (ad hoc) and the per-
  source endpoints. There is no first-class
  `/calendar/events?range=...&kinds=...` endpoint.
- No write API for non-Booking events (e.g. you cannot create a
  contact-task or autopilot task from the calendar UI generically —
  the unified-calendar `event-drawer.tsx` does it per-kind).

### C3 — Sources (writer interfaces)
- Source ownership is implicit. A `CalendarEvent` source registry is
  needed: `(sourceType, sourceId) → reverse link` so that updates from
  the source bubble back into the projection.
- Particular missing writers: `Quote`, `Invoice`, `RecurringInvoice`,
  `OutboundDelivery`, `ScheduledAgentJob`, `Deal.expectedCloseAt`.

### C4 — Sync (Google + future ICS / Outlook)
- `GoogleCalendarConnector.sync` is a no-op item count.
- Push-side: bookings only sync to Google on the location-update path
  or via the manual sync button. No event listener on
  `booking.created/confirmed/rescheduled/cancelled` mirrors to Google
  (this is the biggest "hidden Google call" risk — the system
  *appears* to two-way sync but most booking lifecycle events don't
  push).
- Pull-side: `listCalendarEvents` is the only pull, and it's invoked
  read-time per request — no incremental sync, no `syncToken`, no
  webhook (`supportsWebhook: false` in connector meta).
- Conflict resolution (`keep_external`) hard-cancels bookings — no
  audit trail apart from the `CalendarSyncConflict.resolution` column.
- Conflict scan only runs on demand from the Connect → Calendar page;
  there is no scheduled scan.
- `disconnect()` in `GoogleCalendarConnector.disconnect` (line 211)
  clears tokens but **does not clear `calendarId`** (only
  `CalendarService.disconnectCalendar` at calendar.service.ts:432
  clears `calendarId`). Two disconnect paths drift.

### C5 — UI (replace/unify the surfaces)
- Four overlapping web calendars exist:
  1. `apps/web/src/app/app/bookings/calendar/calendar-view.tsx`
     (bookings + Google overlay)
  2. `apps/web/src/app/app/bookings/components/week-calendar.tsx`
     (compact week strip in bookings list)
  3. `apps/web/src/app/app/marketing/components/marketing-calendar-tab.tsx`
     (campaigns + posts) and
     `apps/web/src/app/app/marketing/components/social/content-calendar.tsx`
     (posts + bookings, again).
  4. `apps/web/src/app/app/keyflow-command/components/unified-calendar.tsx`
     (the master calendar candidate).
- The Project detail "Calendar tab" is not a calendar; it's a date
  list (`apps/web/src/app/app/projects/components/project-detail-tabs/calendar-tab.tsx`).

### C6 — Replacement (which surfaces collapse into the master calendar)
- `marketing-calendar-tab.tsx`, `social/content-calendar.tsx`, and
  `bookings/components/week-calendar.tsx` are candidates to be
  replaced with filtered views over the master `CalendarEvent` API.
- The bookings calendar may stay as a domain-specific view but should
  read from the projection rather than running its own merge of
  bookings + Google events client-side.

### C7 — Intelligence (conflict, smart-suggest, free/busy)
- Conflict surface today is one-off (`CalendarSyncConflict` from
  Google overlap). No detection across internal projections (e.g.
  contact task `dueDate` overlapping with a booking, two autopilot
  tasks scheduled for the same minute).
- `BookingOptimizerService` exists at
  `apps/server/src/modules/bookings/booking-optimizer.service.ts` but
  is bookings-only.
- `Availability` model expresses staff weekly hours but is not folded
  into the calendar surface or free/busy logic.
- No `calendar_event.deleted` bus event despite delete paths existing.

---

## 6. Risk list

1. **Hidden two-disconnect drift.** Two disconnect paths exist:
   `CalendarService.disconnectCalendar` (calendar.service.ts:432) and
   `GoogleCalendarConnector.disconnect` (google-calendar.connector.ts:211).
   The connector path leaves `calendarId` populated and writes a
   `connectorStatus` row; the service path clears `calendarId` but
   does not touch `connectorStatus`. After a partial disconnect a
   business can land in a state where `calendarAccessToken=null` but
   `connectorStatus.status='connected'` (or vice versa), making the
   UI lie about connection state.

2. **Booking → Google is not event-driven.** `booking.created`,
   `booking.confirmed`, `booking.rescheduled`, and `booking.cancelled`
   are emitted on EventEmitter2 but **no listener mirrors them to
   Google**. Sync only happens (a) on the booking-location patch path
   and (b) via the explicit sync-to-calendar button. Result:
   silent drift between Keyflow bookings and the user's Google
   calendar — the Connect → Calendar UI advertises "two-way sync".

3. **Double-booking surfaces.** `scanForConflicts` only fires on demand,
   and only against Google. Internal double-bookings (two bookings
   with the same staff in overlapping `startTime`/`endTime`) are not
   detected here — they are only protected by the booking-creation
   validator. No internal-vs-internal conflict table.

4. **`smokeTest` writes to `primary` regardless of `calendarId` setting.**
   `GoogleCalendarConnector.smokeTest` (google-calendar.connector.ts:152)
   inserts a probe event onto `primary` even when the user has chosen a
   different `calendarId`. If the user does not have write access to
   `primary` (delegated calendar, shared mailbox), smokeTest will fail
   even though real bookings would succeed.

5. **Token refresh swallow.** `refreshAccessToken` throws
   `BadRequestException('Google Calendar not connected')` when the
   refresh token is missing, but `createCalendarEvent`/
   `updateCalendarEvent`/`deleteCalendarEvent` swallow the throw and
   return `null/false`. Callers (`syncBookingToCalendar`,
   `resolveConflict`) treat that as "noop" — failures are invisible
   except in `logger.error`. There is no
   `ConnectorStatus.lastErrorAt` write on these paths.

6. **Multiple "calendar" projections of the same data.** `SocialPost`
   and `Booking` are joined in two places client-side
   (`marketing-calendar-tab.tsx` and `social/content-calendar.tsx`),
   each computing its own `Date` mapping with subtly different filter
   logic (`SocialPost.scheduledAt` vs `publishedAt`, status filters).
   Two surfaces can disagree about the same post.

7. **`KeyflowCommandService` calls `CalendarService.listCalendarEvents`
   per request.** No caching, no rate-limit handling — every load of
   the unified calendar is one extra Google API call per business.

8. **No deletion event.** Deleting a booking's calendar event
   (`removeBookingFromCalendar`) bypasses the bus: there is no
   `calendar_event.deleted` emit, so any listener that mirrored
   `calendar_event.created` cannot keep its mirror in sync.

9. **Webhooks not wired.** `GoogleCalendarConnector.meta.supportsWebhook
   = false`. All Google reads are pull-on-demand, so external edits to
   a booking's mirrored event surface only when the unified calendar
   is opened (and only inside the requested window).

10. **`Business`-level token storage couples calendar to one Google
    account per business.** No room for per-staff calendars,
    multi-account shared-team calendars, or vendor-side calendars
    (Outlook, ICS) without a schema change. C1's projection model
    should not encode this constraint.

---

## 7. Out of scope (per task)

- Any refactor (owned by C1–C7).
- Threat model (separate task).
- New UI.

---

## 8. Surface URLs (in-app routes)

For traceability when downstream agents revisit each surface:

| Surface | In-app route |
|---|---|
| Bookings calendar shell | `/app/bookings` (calendar tab) |
| Marketing calendar tab | `/app/marketing` (calendar tab) |
| Social content calendar | `/app/marketing` (social tab → calendar view) |
| Project detail "Calendar" tab | `/app/projects/[projectId]` (calendar tab) |
| Keyflow Command unified calendar | `/app/keyflow-command` |
| Connect → Calendar settings | `/app/connect/calendar` |
| OAuth callback | `/api/bookings/calendar/callback` |

Server endpoints are already enumerated by file:line in §1a (booking
controller calendar routes). No screenshots are attached because the
audit was performed without a running preview environment; the route
table above is the authoritative list of UI entry points.

---

## 9. Verification footer

- Audit performed against working tree at commit
  `347c47f3c74f2311d20f30946c754611b2676a46`.
- `packages/db/prisma/schema.prisma` length at audit time: 5443 lines.
- Schema scan command used:
  `awk '/^model /{m=$2} /DateTime/{print NR": "m" -> "$0}' packages/db/prisma/schema.prisma`
  filtered against the keep/exclude patterns in §2 methodology.
- Anyone re-running the same scan against the same SHA must produce
  the same row set; deviations indicate schema drift since this audit.

