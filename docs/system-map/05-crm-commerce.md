# CRM & Commerce

> The revenue spine of KEYFLOWOS. Eight NestJS modules that hold every person the business knows (`crm`), everything it sells (`catalog`), every quote, invoice and payment it raises (`commerce`), the physical-goods side of that — listings, warehouses, stock, fulfilment routes (`marketplace`) — plus the sourcing tail (`supplier`, `procurement`), recurring service agreements (`retainers`), and the plan/limit layer that decides how much of it a tenant is allowed (`subscriptions`). Together: 185 non-spec source files, 52,199 lines, 463 HTTP routes, 66 event handlers, 15 self-managed schedulers, writing 98 distinct Prisma models.

## How it works

**A person enters as a `Contact` and never formally leaves that state.** Contacts are created by [crm.service.ts](apps/server/src/modules/crm/crm.service.ts) — directly from the UI, from a CSV/OCR import via [crm-import.service.ts](apps/server/src/modules/crm/crm-import.service.ts), from Google Contacts via [crm-google.service.ts](apps/server/src/modules/crm/crm-google.service.ts), or by `findOrCreateContact` from eleven other modules (bookings, events, public-events, connect, communications, marketplace, …). Every path lands on `createContact`, which defaults `status` to `'LEAD'` ([crm.service.ts:437](apps/server/src/modules/crm/crm.service.ts)) and emits `contact.created`. The DTO whitelist admits four statuses — `LEAD | PROSPECT | CLIENT | LOST` ([create-contact.dto.ts:36](apps/server/src/modules/crm/dto/create-contact.dto.ts)) — and **nothing in the server ever advances that field automatically.** Not a won deal, not a paid invoice, not a completed store order. See *Wiring reality* below; this is the single most consequential gap in the slice.

**Pipeline is tracked separately, on `Deal`.** [crm-deals.service.ts](apps/server/src/modules/crm/crm-deals.service.ts) owns `Deal` + `DealStage` + `WonLostReason`. `moveStage` and `winDeal` both funnel through one private `emitDealWon` helper so the two win paths cannot drift, emitting `crm.deal.won` with the `contactId` the listener reads. That event is consumed by [crm-sequence-scheduler.service.ts:564](apps/server/src/modules/crm/crm-sequence-scheduler.service.ts), which calls `markConversionForContact` to stop a nurture sequence chasing someone who already bought — a wire that was dead until recently and is now covered by [crm-deals-won-event.spec.ts](apps/server/src/modules/crm/crm-deals-won-event.spec.ts). Deal intelligence (forecast, velocity, health) is computed by three sibling services and swept nightly at 04:00 UTC by [deal-intelligence-scheduler.service.ts](apps/server/src/modules/crm/deal-intelligence-scheduler.service.ts), which also creates bottleneck tasks through `AutopilotService`.

**Selling starts in `catalog`, not `commerce`.** [catalog.service.ts](apps/server/src/modules/catalog/catalog.service.ts) is the single writer of `Product` and `Service` — a boundary genuinely enforced by [catalog.boundary.spec.ts](apps/server/src/modules/catalog/catalog.boundary.spec.ts) (I re-derived it: zero violations outside the module). `CatalogModule` is `@Global()`, so commerce, supplier and bookings inject `CatalogService` without importing it. `CommerceService.listProducts / createProduct / updateProduct / deleteProduct / bulkUpdateProducts` are marked `@deprecated` and are thin pass-throughs kept alive so `/commerce/businesses/:id/products` keeps working.

**Quote → invoice → payment is a three-hop chain with a human in the middle.** `createQuote` emits `quote.created`; sending emits `quote.sent`; a prospect opening the signed public link (`GET /commerce/public/quotes/:token`) marks it viewed and emits `quote.viewed`; accepting via `POST /commerce/public/quotes/:token/accept` flips status to `ACCEPTED` and emits `quote.accepted`. **Acceptance does not create an invoice.** [revenue-action.service.ts:116](apps/server/src/modules/commerce/revenue-action.service.ts) turns `quote.accepted` into a `RevenueAction` card telling a human to convert; the conversion itself is the explicit `POST /commerce/businesses/:id/quotes/:quoteId/convert`, which runs `convertQuoteToInvoice` — invoice insert plus the `quote.invoiceId` backlink inside one `$transaction` — then emits `quote.converted` + `invoice.created` and logs an `invoice.created` ContactEvent.

**All invoice state transitions go through one state machine.** [invoice-workflow.service.ts](apps/server/src/modules/commerce/invoice-workflow.service.ts) owns an explicit `ALLOWED_TRANSITIONS` map over eight statuses and throws `409 Conflict` on anything outside it. Two entry points: `transition(id, to)` for callers that know the target (UI mark-paid, void, the overdue sweeper), and `reconcileFromPayments(id)` which recomputes status from `Payment` rows via the pure `computeBalance` / `deriveStatusAfterPayment` functions. Both wrap the status write and the finance posting in a single `$transaction` — `RevenuePostingService.onInvoiceFinalized` on `SENT`/`PENDING`, `onInvoiceVoided` on `VOID`, `ExpensePostingService` COGS on `PAID` — so listeners only observe `PAID` after the ledger entries commit. `transition` also accepts an `eventBuffer` so callers already inside a Prisma transaction can defer emission until post-commit.

**`invoice.paid` is the busiest event in the codebase: 21 handlers across 19 files, seven of them in this slice.** In-slice: [revenue-event.listener.ts](apps/server/src/modules/crm/revenue-event.listener.ts) writes the canonical ContactEvent timeline row (with a `rev:<type>:<entityId>` dedupe key checked against the contact's last 25 events of that type); [contact-insight.listener.ts](apps/server/src/modules/crm/contact-insight.listener.ts) marks the insight snapshot stale; [crm-network.service.ts:396](apps/server/src/modules/crm/crm-network.service.ts) credits the referrer; [invoice-receipt.listener.ts](apps/server/src/modules/commerce/invoice-receipt.listener.ts) auto-sends a receipt if Gmail is connected; [margin-on-payment.listener.ts](apps/server/src/modules/commerce/margin-on-payment.listener.ts) captures a per-revenue `MarginSnapshot` for each line item bound to a `productId`; [storefront-invoice-attribution.listener.ts](apps/server/src/modules/commerce/storefront-invoice-attribution.listener.ts) writes a `RevenueAttribution` row; [revenue-action.service.ts:122](apps/server/src/modules/commerce/revenue-action.service.ts) opens a "receipt not sent" card. `RevenueEventListener` alone handles 20 distinct event names and is the only writer of revenue-shaped timeline rows, which is what keeps idempotency in one place.

**Physical goods run a parallel order lifecycle in `marketplace`.** [marketplace.service.ts](apps/server/src/modules/marketplace/marketplace.service.ts) owns listings, shipping zones, warehouses, inventory, orders, shipments, customs declarations, pre-orders and purchase orders; `createOrder` emits `store_order.created` and, if already paid, `store_order.paid`. [commerce-integration.service.ts](apps/server/src/modules/marketplace/commerce-integration.service.ts) is the CRM bridge: ten `@OnEvent` handlers that `findOrCreateContact` from the order's email/phone, log a ContactEvent, link contact↔order, and create notifications. Note what it tags the buyer with: `tags: ['customer', 'store-order', 'paid']` — a *tag*, while `status` stays `'LEAD'`. [store-order-routing.listener.ts](apps/server/src/modules/marketplace/store-order-routing.listener.ts) is the safety net that guarantees `FulfillmentRoutingService.routeOrder` ran and re-emits the single canonical `store_order.fulfillment_routed`, or `store_order.routing_failed` — which [revenue-action.service.ts:106](apps/server/src/modules/commerce/revenue-action.service.ts) turns into an action card.

**Fifteen schedulers, all hand-rolled, none using `@nestjs/schedule`.** Every one is an `OnModuleInit` + `setInterval` with its own wall-clock gate and its own idempotency key (`lastRunDay`, `lastRunDateByBusiness`). They are gated by *five different* env vars — `DISABLE_SCHEDULERS`, `KF_DISABLE_SCHEDULERS`, `LEAD_SCORE_SCHEDULER_DISABLED`, `CRM_HEALTH_SCHEDULER_DISABLED`, `DEAL_INTEL_SCHEDULER_DISABLED` — and three have no kill switch at all ([margin-snapshot-scheduler.service.ts](apps/server/src/modules/commerce/margin-snapshot-scheduler.service.ts), [financial-briefing-scheduler.service.ts](apps/server/src/modules/commerce/financial-briefing-scheduler.service.ts), [best-channel-scheduler.service.ts](apps/server/src/modules/crm/best-channel-scheduler.service.ts)), and [crm-sequence-scheduler.service.ts](apps/server/src/modules/crm/crm-sequence-scheduler.service.ts) ticks every 60s unconditionally including under `NODE_ENV=test`.

## Entry points

Route paths are absolute — `main.ts` sets **no** global prefix (verified: `grep -n "setGlobalPrefix" apps/server/src/main.ts` returns nothing).

### HTTP — route counts by controller prefix

| Kind | Entry | File | Notes |
|---|---|---|---|
| http | `/crm/**` — 192 routes | [crm.controller.ts](apps/server/src/modules/crm/crm.controller.ts) (103), [crm-ai.controller.ts](apps/server/src/modules/crm/crm-ai.controller.ts) (21), [crm-deals.controller.ts](apps/server/src/modules/crm/crm-deals.controller.ts) (20), [crm-sequence.controller.ts](apps/server/src/modules/crm/crm-sequence.controller.ts) (17), [crm-accounts.controller.ts](apps/server/src/modules/crm/crm-accounts.controller.ts) (11), [crm-custom-fields.controller.ts](apps/server/src/modules/crm/crm-custom-fields.controller.ts) (8), [contact-privacy.controller.ts](apps/server/src/modules/crm/privacy/contact-privacy.controller.ts) (7), [crm-google.controller.ts](apps/server/src/modules/crm/crm-google.controller.ts) (3), [contact-enrichment.controller.ts](apps/server/src/modules/crm/enrichment/contact-enrichment.controller.ts) (1) | All share `@Controller('crm')`; nine classes, one namespace |
| http | `/commerce/**` — 141 routes | [commerce.controller.ts](apps/server/src/modules/commerce/commerce.controller.ts) (~90), [commerce-ai.controller.ts](apps/server/src/modules/commerce/commerce-ai.controller.ts), [commerce-insights.controller.ts](apps/server/src/modules/commerce/commerce-insights.controller.ts), [leverage.controller.ts](apps/server/src/modules/commerce/leverage.controller.ts), [revenue-action.controller.ts](apps/server/src/modules/commerce/revenue-action.controller.ts), [revenue-intelligence.controller.ts](apps/server/src/modules/commerce/revenue-intelligence.controller.ts), [revenue-reporting.controller.ts](apps/server/src/modules/commerce/revenue-reporting.controller.ts), [recurring-invoice.controller.ts](apps/server/src/modules/commerce/recurring-invoice.controller.ts), [financial-copilot.controller.ts](apps/server/src/modules/commerce/financial-copilot.controller.ts), [document-template.controller.ts](apps/server/src/modules/commerce/document-template/document-template.controller.ts) | Ten classes on `commerce`; `document-template` nests at `commerce/document-templates/**` |
| http | `/marketplace/**` — 54 routes | [marketplace.controller.ts](apps/server/src/modules/marketplace/marketplace.controller.ts), [marketplace-public.controller.ts](apps/server/src/modules/marketplace/marketplace-public.controller.ts) | Marked `@keyflow:dormant`; nav gated by `NEXT_PUBLIC_FF_MARKETPLACE_BROWSING` |
| http | `/supplier/**` — 22 routes | [supplier.controller.ts](apps/server/src/modules/supplier/supplier.controller.ts) | **Zero web callers** — see *Wiring reality* |
| http | `/procurement/**` — 14 routes | [procurement.controller.ts](apps/server/src/modules/procurement/procurement.controller.ts) | Called from `apps/web/src/lib/client.ts` |
| http | `/subscriptions/**` — 12 routes | [subscriptions.controller.ts](apps/server/src/modules/subscriptions/subscriptions.controller.ts) | `plans` + `feature-registry` are unauthenticated by design |
| http | `/catalog/**` — 11 routes | [catalog.controller.ts](apps/server/src/modules/catalog/catalog.controller.ts) | Canonical product/service surface; only **one** web caller (`upsell-config-panel.tsx`) |
| http | `/retainers/**` — 8 routes | [retainer.controller.ts](apps/server/src/modules/retainers/retainer.controller.ts) | Called from `apps/web/src/lib/retainers.ts` |
| http | `/accounting/**` — 5 routes | [accounting.controller.ts](apps/server/src/modules/commerce/accounting.controller.ts) | QuickBooks/Xero push; injects the two connectors directly |
| http | `/drive/businesses/:businessId/{sync,intake,intake/:id/approve,intake/:id/reject}` — 4 routes | [drive-intake.controller.ts](apps/server/src/modules/commerce/drive-intake.controller.ts) | Shares the `/drive` namespace with `google-drive.controller.ts` (different module) |

### Notable individual routes

| Kind | Entry | File | Notes |
|---|---|---|---|
| http | `POST /commerce/businesses/:businessId/quotes/:quoteId/convert` | [commerce.controller.ts:722](apps/server/src/modules/commerce/commerce.controller.ts) | The lead→customer money hop. `convertQuoteToInvoice` |
| http | `GET/POST /commerce/public/quotes/:token[/accept|/reject]` | [commerce.controller.ts:641,653,667](apps/server/src/modules/commerce/commerce.controller.ts) | Signed `viewToken`, `PublicRateLimitGuard` 60/20 per min |
| http | `GET /commerce/public/invoice-link/:token`, `GET /commerce/payment-links/:token`, `POST /commerce/invoices/:invoiceId/payment-intent` | [commerce.controller.ts:1147,1420,1427](apps/server/src/modules/commerce/commerce.controller.ts) | Public payment surface |
| http | `PATCH /commerce/invoices/:invoiceId/paid` | [commerce.controller.ts:333](apps/server/src/modules/commerce/commerce.controller.ts) | `businessId` arrives in the **body** so `BusinessGuard` can read it; the DTO whitelist strips it afterwards. Deliberate — see [invoice-status-contract.spec.ts:91](apps/server/src/modules/commerce/invoice-status-contract.spec.ts) |
| http | `GET /commerce/gmail/callback`, `GET /crm/google/callback` | [commerce.controller.ts:747](apps/server/src/modules/commerce/commerce.controller.ts), [crm-google.controller.ts:25](apps/server/src/modules/crm/crm-google.controller.ts) | OAuth returns; state signed with `GOOGLE_STATE_SECRET` |
| http | `GET /crm/contact-exports/:token/download` | [contact-privacy.controller.ts:90](apps/server/src/modules/crm/privacy/contact-privacy.controller.ts) | GDPR export bundle, token-authenticated |
| http | `GET /marketplace/order-status/:token` | [marketplace-public.controller.ts:9](apps/server/src/modules/marketplace/marketplace-public.controller.ts) | Public order tracking |
| http | `GET /crm/health`, `GET /commerce/health` | [crm.controller.ts:184](apps/server/src/modules/crm/crm.controller.ts), [commerce-ai.controller.ts:27](apps/server/src/modules/commerce/commerce-ai.controller.ts) | Unauthenticated liveness pings |

### Events consumed (`@OnEvent`) — 66 handlers, 40 distinct names

| Kind | Entry | File | Notes |
|---|---|---|---|
| event | `quote.created/sent/accepted/rejected/viewed/stale/converted`, `invoice.created/sent/overdue/paid`, `payment.received/failed`, `recurring_invoice.created/updated/deleted/generated/failed`, `store_order.paid/refunded/fulfillment_routed/routing_failed`, `booking.invoice_created` | [revenue-event.listener.ts](apps/server/src/modules/crm/revenue-event.listener.ts) | 20 handlers. Sole writer of revenue ContactEvent rows; dedupes on `rev:<type>:<id>` |
| event | `store_order.created/paid/shipped/delivered/cancelled/refunded`, `inventory.low/out`, `purchaseOrder.received`, `preorder.delayed` | [commerce-integration.service.ts](apps/server/src/modules/marketplace/commerce-integration.service.ts) | 10 handlers. Order→Contact bridge + notifications |
| event | `invoice.overdue`, `quote.stale`, `quote.sent`, `quote.accepted`, `invoice.paid`, `payment.failed`, `store_order.routing_failed` | [revenue-action.service.ts](apps/server/src/modules/commerce/revenue-action.service.ts) | 7 handlers → `RevenueAction` cards |
| event | `crm.contact_event.logged`, `crm.deal.created`, `relationship_health.changed`, `sequence.step_due`, `invoice.paid` | [contact-insight.listener.ts](apps/server/src/modules/crm/contact-insight.listener.ts) | Marks the insight snapshot stale |
| event | `delivery.opened`, `delivery.clicked`, `message.received`, `crm.deal.won` | [crm-sequence-scheduler.service.ts](apps/server/src/modules/crm/crm-sequence-scheduler.service.ts) | Engagement + conversion attribution on enrollments |
| event | `crm.deal.stage_changed`, `crm.deal.created`, `crm.contact_event.logged` | [deal-intelligence-scheduler.service.ts](apps/server/src/modules/crm/deal-intelligence-scheduler.service.ts) | Recompute deal health on change |
| event | `quote.viewed/accepted/rejected` | [quote-notifications.listener.ts](apps/server/src/modules/commerce/quote-notifications.listener.ts) | Transactional email to the business |
| event | `quote.stale` | [quote-stale.listener.ts](apps/server/src/modules/commerce/quote-stale.listener.ts) | `AiApprovalItem` card, deduped per quote |
| event | `invoice.paid` | [invoice-receipt.listener.ts](apps/server/src/modules/commerce/invoice-receipt.listener.ts), [margin-on-payment.listener.ts](apps/server/src/modules/commerce/margin-on-payment.listener.ts), [storefront-invoice-attribution.listener.ts](apps/server/src/modules/commerce/storefront-invoice-attribution.listener.ts), [crm-network.service.ts:396](apps/server/src/modules/crm/crm-network.service.ts) | Receipt email, margin snapshot, attribution row, referral credit |
| event | `store_order.paid` | [store-order-routing.listener.ts](apps/server/src/modules/marketplace/store-order-routing.listener.ts) | Fulfilment routing safety net + canonical re-emit |
| event | `crm.contact_event.logged` | [best-channel.listener.ts](apps/server/src/modules/crm/best-channel.listener.ts), [sequence-attribution.listener.ts](apps/server/src/modules/crm/sequence-attribution.listener.ts) | Channel stats; sequence attribution |
| event | `message.received` | [conversation-ai.service.ts:510](apps/server/src/modules/crm/conversation-ai.service.ts) | Inbound message analysis |
| event | `file.uploaded` | [drive-intake.listener.ts](apps/server/src/modules/commerce/drive-intake.listener.ts) | Drive document → invoice/contact intake plan |

### Schedulers — 15, all `setInterval`, zero `@Cron`

| Kind | Entry | File | Notes |
|---|---|---|---|
| cron | Hourly tick, daily 04:00 UTC | [lead-scoring.scheduler.ts](apps/server/src/modules/crm/lead-scoring.scheduler.ts) | Heuristic `leadScore` 0–100. Off via `LEAD_SCORE_SCHEDULER_DISABLED=1` |
| cron | Hourly tick, daily 03:00 UTC | [crm-relationship-health-scheduler.service.ts](apps/server/src/modules/crm/crm-relationship-health-scheduler.service.ts) | `recomputeAll`. Off via `CRM_HEALTH_SCHEDULER_DISABLED=1` |
| cron | Hourly tick, daily 04:00 UTC | [deal-intelligence-scheduler.service.ts](apps/server/src/modules/crm/deal-intelligence-scheduler.service.ts) | Off via `DEAL_INTEL_SCHEDULER_DISABLED=1` |
| cron | 24h, 60s startup delay | [crm-data-quality.scheduler.ts](apps/server/src/modules/crm/crm-data-quality.scheduler.ts) | Off via `KF_DISABLE_SCHEDULERS=1` |
| cron | 5min tick, daily 03:30 UTC, 150s startup delay | [best-channel-scheduler.service.ts](apps/server/src/modules/crm/best-channel-scheduler.service.ts) | **No kill switch** |
| cron | 60s, unconditional | [crm-sequence-scheduler.service.ts](apps/server/src/modules/crm/crm-sequence-scheduler.service.ts) | `processDueEnrollments`. **No kill switch, runs in tests** |
| cron | 15min | [invoice-overdue.scheduler.ts](apps/server/src/modules/commerce/invoice-overdue.scheduler.ts) | `SENT`+past-due → `OVERDUE`, batch 200. Off via `DISABLE_SCHEDULERS=1` / `NODE_ENV=test` |
| cron | Hourly tick, daily 08:00 UTC | [quote-stale.scheduler.ts](apps/server/src/modules/commerce/quote-stale.scheduler.ts) | Off via `DISABLE_SCHEDULERS=1` / `NODE_ENV=test` |
| cron | 24h | [revenue-reporting-rollup.scheduler.ts](apps/server/src/modules/commerce/revenue-reporting-rollup.scheduler.ts) | Off via `DISABLE_SCHEDULERS=1` / `NODE_ENV=test` |
| cron | 60s tick, Monday 08:00 business-tz | [weekly-revenue-review.scheduler.ts](apps/server/src/modules/commerce/weekly-revenue-review.scheduler.ts) | Off via `DISABLE_SCHEDULERS=1` / `NODE_ENV=test` |
| cron | 60s tick, Monday 07:00 business-tz | [financial-briefing-scheduler.service.ts](apps/server/src/modules/commerce/financial-briefing-scheduler.service.ts) | **No kill switch** |
| cron | 24h | [margin-snapshot-scheduler.service.ts](apps/server/src/modules/commerce/margin-snapshot-scheduler.service.ts) | **No kill switch** |
| cron | Interval inside the service | [recurring-invoice.service.ts](apps/server/src/modules/commerce/recurring-invoice.service.ts) | `OnModuleInit` → `processRecurringInvoices` |

### Exported services other modules inject

`CrmService` is the widest edge in the slice — injected by **bookings, events, automation, flow, connect, communications, public-events, marketplace, commerce, key-cortex** and resolved lazily via `moduleRef.get(..., {strict:false})` by four `ai/*` services. `CatalogService` is `@Global()`. Also exported and consumed outside: `CommerceService`, `InvoiceWorkflowService`, `RevenueAttributionService` (bookings, site), `InventoryRiskService` (site), `SubscriptionsService`, `DriveIntakeOrchestrator` (ingestion), `SupplierService` + `RetainerService` (ai flow tools, via `moduleRef`).

## Files

### crm/ — 82 non-spec files

| File | Lines | What it does | Talks to |
|---|---|---|---|
| [crm.service.ts](apps/server/src/modules/crm/crm.service.ts) | 2016 | Contact CRUD, list/filter/sort, bulk ops, merge + revert, next-action set/clear, `findOrCreateContact` | injects PrismaService, EventEmitter2, SubscriptionsService, CrmTimelineService, ContactCustomFieldValueService, CrmStatsService, CrmListsService, CrmFlowService, ContactAuditService, EntityResolutionService; emits `contact.created/updated/deleted/merged/merge_reverted/next_action_set/next_action_cleared` |
| [crm.controller.ts](apps/server/src/modules/crm/crm.controller.ts) | 1693 | 103 routes: contacts, notes, tasks, lists, saved views, data quality, duplicates, imports, relationships, conversations, journey, dossier | injects 18 services incl. CrmService, CrmStatsService, CrmTimelineService, CrmActionsService, CrmDataQualityService |
| [crm-ai.service.ts](apps/server/src/modules/crm/crm-ai.service.ts) | 1705 | NL search, AI command interpret/execute, tag/score/summarise, churn risk, re-engagement, duplicate + data-quality analysis | injects PrismaService, AiUsageService, CrmListsService, CrmSequenceService, CrmTimelineService; `change_status` validates against `LEAD/PROSPECT/CLIENT/LOST` |
| [crm-actions.service.ts](apps/server/src/modules/crm/crm-actions.service.ts) | 1326 | Next-action + autopilot-action feeds derived from tasks, invoices, bookings, stale contacts | injects PrismaService, CrmTimelineService, AiUsageService; reads `contact`, `contactTask`, `invoice`, `booking` |
| [crm-stats.service.ts](apps/server/src/modules/crm/crm-stats.service.ts) | 1036 | Contact stats, revenue rollups, duplicates, segment summary, favourites, poll state | injects PrismaService, CrmCacheService, CrmTimelineService |
| [crm-import.service.ts](apps/server/src/modules/crm/crm-import.service.ts) | 935 | CSV/link/image imports, header mapping, OCR contact extraction | injects PrismaService, CrmService, AiUsageService; writes `contactImport`, `contactImportContact` |
| [crm-timeline.service.ts](apps/server/src/modules/crm/crm-timeline.service.ts) | 841 | `ContactEvent`, `ContactNote`, `ContactTask` writer; canonical `logEvent` | injects PrismaService, EventEmitter2, TimelineService, EvidenceService, TaskAssignmentService; emits `crm.contact_event.logged`, `contact_task.*` |
| [contact-insight.service.ts](apps/server/src/modules/crm/contact-insight.service.ts) | 837 | `ContactInsightSnapshot` compute + staleness; per-contact intelligence fields | injects PrismaService, EventEmitter2, AiUsageService, BestChannelService; emits `crm.contact_insight.recomputed` |
| [crm-accounts.service.ts](apps/server/src/modules/crm/crm-accounts.service.ts) | 784 | `Account` CRUD, contact→account suggestion, merge preview/apply, deal + lifecycle pivots | injects PrismaService |
| [crm-sequence.service.ts](apps/server/src/modules/crm/crm-sequence.service.ts) | 696 | Sequence CRUD, enrollment, variant pre-assignment (sticky at enrol) | injects PrismaService, CrmTimelineService; writes `crmSequence`, `crmSequenceEnrollment` |
| [crm-sequence-scheduler.service.ts](apps/server/src/modules/crm/crm-sequence-scheduler.service.ts) | 649 | 60s enrollment stepper; engagement + conversion attribution | injects PrismaService, EventEmitter2, CrmTimelineService; `@OnEvent` delivery.opened/clicked, message.received, `crm.deal.won`; emits `sequence.step_due/step_failed` |
| [crm-journey.service.ts](apps/server/src/modules/crm/crm-journey.service.ts) | 620 | Contact health metrics, journey + cross-journey, conversation context | injects PrismaService; reads `customerJourney`, `journeyTouchpoint` |
| [crm-sequence-analytics.service.ts](apps/server/src/modules/crm/crm-sequence-analytics.service.ts) | 614 | Per-sequence + summary + lifecycle analytics; attribution window setting | injects PrismaService; writes `sequenceAttribution` |
| [contact-privacy.service.ts](apps/server/src/modules/crm/privacy/contact-privacy.service.ts) | 613 | GDPR export bundle + forget request with hashed-placeholder redaction | injects PrismaService, ContactAuditService; writes `contactExportJob`, `contactForgetRequest` |
| [crm-deals.service.ts](apps/server/src/modules/crm/crm-deals.service.ts) | 592 | `Deal`/`DealStage` CRUD, moveStage, win/lose, bulk move | injects PrismaService, EventEmitter2, CrmTimelineService, WonLostReasonService; emits `crm.deal.created/stage_changed/won`, `deal.updated` |
| [crm-data-quality.service.ts](apps/server/src/modules/crm/crm-data-quality.service.ts) | 575 | Nightly scan → `ContactDataIssue`; apply/bulk-apply/dismiss fixes, wizard queue | injects PrismaService, CrmDuplicateDetectionService |
| [conversation-ai.service.ts](apps/server/src/modules/crm/conversation-ai.service.ts) | 553 | Thread summarise, message analyse, suggested replies, contact rollup | injects PrismaService, EventEmitter2, AiUsageService; `@OnEvent('message.received')`; emits `crm.conversation.analyzed` |
| [crm-communication.service.ts](apps/server/src/modules/crm/crm-communication.service.ts) | 449 | Unified conversation list, read state, unread counts, reply dispatch | injects PrismaService, EventEmitter2, CrmTimelineService, WhatsAppService; emits `crm.contact_event.logged` |
| [crm-network.service.ts](apps/server/src/modules/crm/crm-network.service.ts) | 435 | `ContactRelationship` graph, neighbourhood, referral credit on payment | injects PrismaService, CrmTimelineService, ReputationService; `@OnEvent('invoice.paid')` |
| [best-channel.service.ts](apps/server/src/modules/crm/best-channel.service.ts) | 421 | `ContactChannelStat` — which channel/time reaches a contact | injects PrismaService |
| [revenue-event.listener.ts](apps/server/src/modules/crm/revenue-event.listener.ts) | 420 | 20 `@OnEvent` handlers → deduped revenue ContactEvent rows | injects PrismaService, CrmTimelineService, ContactInsightService |
| [crm-duplicate-detection.service.ts](apps/server/src/modules/crm/crm-duplicate-detection.service.ts) | 400 | Scoped duplicate candidate scoring + merge preview | injects PrismaService |
| [crm-sequence-graph.util.ts](apps/server/src/modules/crm/crm-sequence-graph.util.ts) | 362 | Pure: `pickVariantId` (weighted/sticky), `validateGraph` | none — pure functions |
| [crm-revenue.service.ts](apps/server/src/modules/crm/crm-revenue.service.ts) | 350 | Per-contact revenue summary, predictive revenue, financial growth | injects PrismaService |
| [crm-relationship-health.service.ts](apps/server/src/modules/crm/crm-relationship-health.service.ts) | 321 | HOT/WARM/COLD/DORMANT/AT_RISK classification + manual override | injects PrismaService, CrmStatsService, CrmTimelineService; emits `relationship_health.changed` |
| [crm-ai.controller.ts](apps/server/src/modules/crm/crm-ai.controller.ts) | 292 | 21 AI routes, all behind `FeatureFlagGuard` | injects CrmAiService, ContactInsightService, CrmJourneyService |
| [crm-deals.controller.ts](apps/server/src/modules/crm/crm-deals.controller.ts) | 295 | 20 deal/stage/won-lost routes | injects CrmDealsService, DealForecastService, DealVelocityService, WonLostReasonService |
| [crm-google.service.ts](apps/server/src/modules/crm/crm-google.service.ts) | 278 | Google People OAuth + contact import | injects PrismaService, EventEmitter2, CrmService; emits `contact.imported` |
| [deal-intelligence-scheduler.service.ts](apps/server/src/modules/crm/deal-intelligence-scheduler.service.ts) | 234 | Nightly deal-health sweep + bottleneck tasks | injects PrismaService, DealHealthService, DealVelocityService, AutopilotService |
| [crm-data-quality.util.ts](apps/server/src/modules/crm/crm-data-quality.util.ts) | 233 | Pure validators (+ optional MX lookup, `KF_DISABLE_MX`) | none |
| [contact-enrichment.service.ts](apps/server/src/modules/crm/enrichment/contact-enrichment.service.ts) | 231 | Fill-blanks-only enrichment with race guard + cooldown | injects PrismaService, CrmService, ApolloEnrichmentProvider |
| [deal-health.service.ts](apps/server/src/modules/crm/deal-health.service.ts) | 224 | Per-deal health score | injects PrismaService, ConversationAiService, DealVelocityService |
| [crm-sequence.controller.ts](apps/server/src/modules/crm/crm-sequence.controller.ts) | 224 | 17 sequence routes behind `FeatureFlagGuard` | injects CrmSequenceService, CrmSequenceAnalyticsService |
| [create-contact.dto.ts](apps/server/src/modules/crm/dto/create-contact.dto.ts) | 222 | Contact create validation. `@IsIn(['LEAD','PROSPECT','CLIENT','LOST'])` on `status` (L36) | consumed by crm.controller |
| [update-contact.dto.ts](apps/server/src/modules/crm/dto/update-contact.dto.ts) | 222 | Contact update validation. Same four-value `status` whitelist (L36); `lifecycleStage` is a free `string` (L150) | consumed by crm.controller |
| [crm-lists.service.ts](apps/server/src/modules/crm/crm-lists.service.ts) | 221 | Static + SMART `ContactList` membership | injects PrismaService; shares filter primitives with contact-filters.helper |
| [contact-audit.service.ts](apps/server/src/modules/crm/privacy/contact-audit.service.ts) | 213 | `ContactAuditEntry` writer keyed on a stable `contactHash` | injects PrismaService |
| [lead-scoring.scheduler.ts](apps/server/src/modules/crm/lead-scoring.scheduler.ts) | 191 | Nightly heuristic `leadScore`. Line 186 scores `status === 'CUSTOMER'` — a value the CRM never produces | injects PrismaService |
| [deal.dto.ts](apps/server/src/modules/crm/dto/deal.dto.ts) | 186 | Create/update/win/lose deal + stage DTOs | consumed by crm-deals.controller |
| [deal-forecast.service.ts](apps/server/src/modules/crm/deal-forecast.service.ts) | 180 | Weighted pipeline forecast + per-stage win rates | injects PrismaService |
| [contact-privacy.controller.ts](apps/server/src/modules/crm/privacy/contact-privacy.controller.ts) | 173 | 7 GDPR routes incl. token download | injects ContactPrivacyService, ContactAuditService |
| [crm.module.ts](apps/server/src/modules/crm/crm.module.ts) | 170 | 9 controllers, 50 providers, 33 exports; `forwardRef` to AiModule + AutopilotModule | imports SubscriptionsModule, ConnectorModule, WhatsAppModule, CommunityModule, TimelineModule, EvidenceModule, TaskAssignmentModule |
| [contact-filters.helper.ts](apps/server/src/modules/crm/contact-filters.helper.ts) | 161 | `buildContactWhere` shared by listContacts and SMART lists | pure |
| [deal-velocity.service.ts](apps/server/src/modules/crm/deal-velocity.service.ts) | 158 | Stage dwell-time report | injects PrismaService |
| [crm-permissions.helper.ts](apps/server/src/modules/crm/crm-permissions.helper.ts) | 126 | `resolveCrmAccess` / `visibilityClause` — M7 ownership scoping | pure; consumed by crm.service |
| [crm-accounts.controller.ts](apps/server/src/modules/crm/crm-accounts.controller.ts) | 130 | 11 account routes + pivots | injects CrmAccountsService |
| [crm-custom-fields.controller.ts](apps/server/src/modules/crm/crm-custom-fields.controller.ts) | 116 | 8 custom-field-definition routes | injects CustomFieldDefinitionService, ContactCustomFieldValueService |
| [contact-zip.util.ts](apps/server/src/modules/crm/privacy/contact-zip.util.ts) | 113 | Dependency-free ZIP writer for the GDPR bundle | pure |
| [crm-saved-views.service.ts](apps/server/src/modules/crm/crm-saved-views.service.ts) | 112 | `ContactSavedView` CRUD | injects PrismaService |
| [crm-flow.service.ts](apps/server/src/modules/crm/crm-flow.service.ts) | 107 | Cached flow-intelligence rollup (lead/prospect/client counts) | injects PrismaService, CrmCacheService |
| [won-lost-reason.service.ts](apps/server/src/modules/crm/won-lost-reason.service.ts) | 105 | `WonLostReason` CRUD + `ensureDefaults` | injects PrismaService |
| [apollo-enrichment.provider.ts](apps/server/src/modules/crm/enrichment/apollo-enrichment.provider.ts) | 102 | Apollo.io `people/match`; dark unless `APOLLO_API_KEY` | `fetch` → `https://api.apollo.io` |
| [custom-field-definition.service.ts](apps/server/src/modules/crm/custom-field-definition.service.ts) | 99 | `CustomFieldDefinition` CRUD + archive/restore | injects PrismaService |
| [contact-custom-field-value.service.ts](apps/server/src/modules/crm/contact-custom-field-value.service.ts) | 95 | `ContactCustomFieldValue` read/write | injects PrismaService |
| [custom-field-definition.dto.ts](apps/server/src/modules/crm/dto/custom-field-definition.dto.ts) | 90 | Custom-field DTOs | consumed by crm-custom-fields.controller |
| [contact-insight.listener.ts](apps/server/src/modules/crm/contact-insight.listener.ts) | 82 | 5 `@OnEvent` → `insights.markStale` | injects ContactInsightService |
| [best-channel-scheduler.service.ts](apps/server/src/modules/crm/best-channel-scheduler.service.ts) | 82 | Nightly 03:30 UTC channel recompute | injects PrismaService, BestChannelService |
| [contact-scoring.engine.ts](apps/server/src/modules/crm/contact-scoring.engine.ts) | 82 | Pure scoring primitives | pure |
| [command-interpreter.prompt.ts](apps/server/src/modules/crm/prompts/command-interpreter.prompt.ts) | 80 | LLM prompt builder | consumed by crm-ai.service |
| [crm-google.controller.ts](apps/server/src/modules/crm/crm-google.controller.ts) | 71 | auth-url, callback, import | injects CrmGoogleService |
| [account.dto.ts](apps/server/src/modules/crm/dto/account.dto.ts) | 70 | Account DTOs | consumed by crm-accounts.controller |
| [crm-relationship-health-scheduler.service.ts](apps/server/src/modules/crm/crm-relationship-health-scheduler.service.ts) | 68 | Daily 03:00 UTC health recompute | injects CrmRelationshipHealthService |
| [rate-limit.guard.ts](apps/server/src/modules/crm/guards/rate-limit.guard.ts) | 66 | In-process sliding window keyed `ip:businessId:handler`; no-op without `@CrmRateLimit` | injects Reflector |
| [crm-data-quality.scheduler.ts](apps/server/src/modules/crm/crm-data-quality.scheduler.ts) | 66 | Nightly per-business DQ scan, 1.5s gap | injects CrmDataQualityService |
| [enrichment-provider.ts](apps/server/src/modules/crm/enrichment/enrichment-provider.ts) | 63 | `EnrichmentProvider` interface (Apollo is the one impl) | — |
| [feature-flag.guard.ts](apps/server/src/modules/crm/guards/feature-flag.guard.ts) | 52 | Blocks only on explicit `business.metaData.features[x] === false`; fails open otherwise | injects Reflector, PrismaService |
| [crm-playbook.service.ts](apps/server/src/modules/crm/crm-playbook.service.ts) | 51 | `ContactPlaybook` get-or-create/update | injects PrismaService |
| [crm-cache.service.ts](apps/server/src/modules/crm/crm-cache.service.ts) | 47 | Redis get/set/invalidate wrapper | injects Redis |
| [crm.constants.ts](apps/server/src/modules/crm/crm.constants.ts) | 45 | `BULK_LIMIT`, page-size bounds | — |
| [nl-search.prompt.ts](apps/server/src/modules/crm/prompts/nl-search.prompt.ts) | 44 | LLM prompt builder | consumed by crm-ai.service |
| [crm-duplicate.util.ts](apps/server/src/modules/crm/crm-duplicate.util.ts) | 43 | `normalizeEmail/normalizePhone/findExistingBulk` | pure |
| [best-channel.listener.ts](apps/server/src/modules/crm/best-channel.listener.ts) | 43 | `crm.contact_event.logged` → `recordEvent` | injects BestChannelService |
| [sequence-attribution.listener.ts](apps/server/src/modules/crm/sequence-attribution.listener.ts) | 41 | `crm.contact_event.logged` → sequence attribution | injects CrmSequenceAnalyticsService |
| [contact-enrichment.controller.ts](apps/server/src/modules/crm/enrichment/contact-enrichment.controller.ts) | 40 | `POST /crm/businesses/:id/contacts/:cid/enrich` | injects ContactEnrichmentService |
| [create-task.dto.ts](apps/server/src/modules/crm/dto/create-task.dto.ts) | 32 | Task DTO | consumed by crm.controller |
| [lead-scoring.prompt.ts](apps/server/src/modules/crm/prompts/lead-scoring.prompt.ts) | 27 | `buildLeadScoringPrompt` — used on-demand, not by the nightly scheduler | consumed by crm-ai.service |
| [churn-detection.prompt.ts](apps/server/src/modules/crm/prompts/churn-detection.prompt.ts) | 25 | LLM prompt builder | consumed by crm-ai.service |
| [log-contact-event.dto.ts](apps/server/src/modules/crm/dto/log-contact-event.dto.ts) | 20 | Event-log DTO | consumed by crm.controller |
| [contact-summary.prompt.ts](apps/server/src/modules/crm/prompts/contact-summary.prompt.ts) | 16 | LLM prompt builder | consumed by crm-ai.service |
| [ai-rate-limit.util.ts](apps/server/src/modules/crm/ai-rate-limit.util.ts) | 15 | AI call throttle helper | consumed by crm-ai.service |
| [create-note.dto.ts](apps/server/src/modules/crm/dto/create-note.dto.ts) | 12 | Note DTO | consumed by crm.controller |
| [crm.helpers.ts](apps/server/src/modules/crm/crm.helpers.ts) | 7 | `contactWhereBase` / `contactWhereWithId` — the tenant+soft-delete clause every CRM query starts from | used across crm/ and commerce/ |

### commerce/ — 70 non-spec files

| File | Lines | What it does | Talks to |
|---|---|---|---|
| [commerce.service.ts](apps/server/src/modules/commerce/commerce.service.ts) | 2155 | Quotes, invoices, payments, payment links, receipts, reminders, quote→invoice conversion, campaign revenue | injects PrismaService, EventEmitter2, CrmService, SubscriptionsService, CommerceStatsService, InvoiceWorkflowService, CatalogService, PublicEventsService, RevenuePostingService; emits 18 distinct `quote.*` / `invoice.*` events |
| [commerce.controller.ts](apps/server/src/modules/commerce/commerce.controller.ts) | 1460 | ~90 routes: products, invoices, quotes, payments, Gmail, store readiness, public token surfaces | injects CommerceService, TimeEntryService, InvoiceReceiptBuilderService, GmailService, PrismaService, CommerceVisionService, SubscriptionsService, StoreReadinessService, PaymentEvidenceService |
| [commerce-ai.service.ts](apps/server/src/modules/commerce/commerce-ai.service.ts) | 1393 | 16 AI capabilities: revenue analysis, reminders, pricing, cashflow, NL search, collections scoring, churn risk | injects PrismaService, AiUsageService, CommerceStatsService, CatalogService |
| [revenue-action.service.ts](apps/server/src/modules/commerce/revenue-action.service.ts) | 1077 | `RevenueAction` card generator; 7 `@OnEvent` handlers + `reconcileAll` | injects PrismaService, EventEmitter2, AiUsageService, ModelGatewayService; emits `revenue_action.created/completed` |
| [revenue-reporting.service.ts](apps/server/src/modules/commerce/revenue-reporting.service.ts) | 1045 | 15 report presets: margin by product/contact, revenue/hour, time-to-pay, aging, quote conversion; rollup refresh | injects PrismaService |
| [financial-copilot.service.ts](apps/server/src/modules/commerce/financial-copilot.service.ts) | 757 | Financial pulse, cash-flow forecast, weekly briefing, expense anomaly + revenue milestone checks | injects PrismaService, AiUsageService |
| [gmail.service.ts](apps/server/src/modules/commerce/gmail.service.ts) | 629 | Gmail OAuth + threads/messages/labels/send | `fetch` → `oauth2.googleapis.com`, `gmail.googleapis.com`; injects PrismaService |
| [store-readiness.service.ts](apps/server/src/modules/commerce/store-readiness.service.ts) | 503 | Store graph, readiness checklist, `sourceProductId` backfill | injects PrismaService, CatalogService |
| [drive-intake-orchestrator.service.ts](apps/server/src/modules/commerce/drive-intake-orchestrator.service.ts) | 469 | Drive file → plan → approval item → invoice/contact/credit-note execution | injects PrismaService, CommerceService, InvoiceWorkflowService, CrmService, CrmCommunicationService, CreditNoteService, AiOversightService, TaskAssignmentService, TransactionalEmailService |
| [commerce-intelligence.service.ts](apps/server/src/modules/commerce/commerce-intelligence.service.ts) | 436 | Product copy rewrite, pricing/fulfilment recommendation, opportunity scan | injects PrismaService, AiUsageService, LandedCostEngine, MarginAnalysisService |
| [revenue-briefing.service.ts](apps/server/src/modules/commerce/revenue-briefing.service.ts) | 401 | Cached weekly revenue briefing + delegate-chase | injects PrismaService, AiUsageService, RevenueForecastService, SlowPayerDetector, PricingSignalsService, RevenueActionService |
| [invoice-workflow.service.ts](apps/server/src/modules/commerce/invoice-workflow.service.ts) | 389 | The invoice state machine: `ALLOWED_TRANSITIONS`, `computeBalance`, `deriveStatusAfterPayment`, `transition`, `reconcileFromPayments` | injects PrismaService, EventEmitter2, RevenuePostingService, ExpensePostingService; emits `invoice.paid/sent/overdue/void/payment_recorded` |
| [recurring-invoice.service.ts](apps/server/src/modules/commerce/recurring-invoice.service.ts) | 333 | Recurring schedule CRUD + due-date generation loop | injects PrismaService, EventEmitter2, InvoiceWorkflowService; emits `recurring_invoice.*`, `invoice.created` |
| [time-cost.service.ts](apps/server/src/modules/commerce/time-cost.service.ts) | 322 | `TimeCostEntry` CRUD + contact/business rollups | injects PrismaService |
| [revenue-attribution.service.ts](apps/server/src/modules/commerce/revenue-attribution.service.ts) | 296 | `RevenueAttribution` record/update/summarise-by-source | injects PrismaService |
| [financial-briefing-scheduler.service.ts](apps/server/src/modules/commerce/financial-briefing-scheduler.service.ts) | 278 | Monday 07:00 business-tz briefing email | injects PrismaService, FinancialCopilotService, SystemEmailService |
| [leverage.controller.ts](apps/server/src/modules/commerce/leverage.controller.ts) | 249 | Revenue-attribution + time-cost + leverage-metrics routes | injects PrismaService, RevenueAttributionService, TimeCostService |
| [payment-evidence.service.ts](apps/server/src/modules/commerce/payment-evidence.service.ts) | 246 | Extract payment evidence from a document; hardcodes `confidence: 0.3` on the fallback branch (L223) | injects CommerceService, InvoiceWorkflowService, DocumentIntelligenceService, GoogleDriveService |
| [commerce-ai.controller.ts](apps/server/src/modules/commerce/commerce-ai.controller.ts) | 235 | 17 AI routes behind `FeatureFlagGuard` | injects CommerceAiService, CommerceStatsService |
| [revenue-forecast.service.ts](apps/server/src/modules/commerce/revenue-forecast.service.ts) | 231 | Forward revenue projection from open invoices + recurring | injects PrismaService |
| [slow-payer-detector.service.ts](apps/server/src/modules/commerce/slow-payer-detector.service.ts) | 230 | Slow-payer detection, contact tag sync, revenue-action sync | injects PrismaService |
| [quote-notifications.listener.ts](apps/server/src/modules/commerce/quote-notifications.listener.ts) | 218 | `quote.viewed/accepted/rejected` → transactional email | injects PrismaService, TransactionalEmailService |
| [commerce-stats.service.ts](apps/server/src/modules/commerce/commerce-stats.service.ts) | 213 | Cached commerce stats + `healthPing` | injects PrismaService |
| [commerce-insights.controller.ts](apps/server/src/modules/commerce/commerce-insights.controller.ts) | 209 | Landed-cost, margin, source-risk, inventory-risk, AI copy/pricing | injects LandedCostEngine, MarginAnalysisService, SourceRiskService, InventoryRiskService, CommerceIntelligenceService, MarginSnapshotSchedulerService |
| [inventory-risk.service.ts](apps/server/src/modules/commerce/inventory-risk.service.ts) | 196 | Per-product / all-product stock-out risk | injects PrismaService |
| [commerce-vision.service.ts](apps/server/src/modules/commerce/commerce-vision.service.ts) | 189 | Product extraction from image + CSV parse | injects AiUsageService |
| [source-risk.service.ts](apps/server/src/modules/commerce/source-risk.service.ts) | 188 | Single-source / supplier concentration risk | injects PrismaService |
| [quote-email.template.ts](apps/server/src/modules/commerce/quote-email.template.ts) | 184 | Quote HTML email | consumed by commerce.controller |
| [innovation.prompt.ts](apps/server/src/modules/commerce/prompts/innovation.prompt.ts) | 172 | Product-opportunity prompt | consumed by commerce-intelligence.service |
| [landed-cost-engine.service.ts](apps/server/src/modules/commerce/landed-cost-engine.service.ts) | 172 | Landed cost per product/business + margin-band classification | injects PrismaService |
| [pricing-signals.service.ts](apps/server/src/modules/commerce/pricing-signals.service.ts) | 161 | Under/over-priced product detection | injects PrismaService, MarginAnalysisService |
| [commerce.module.ts](apps/server/src/modules/commerce/commerce.module.ts) | 154 | 12 controllers, 37 providers, 20 exports; `forwardRef` to Crm/Finance/Ai + a dynamic import for Notifications | imports CrmModule, FinanceModule, PublicEventsModule, SubscriptionsModule, TimeTrackingModule, AiModule, CatalogModule, DocumentTemplateModule, GoogleDriveModule, TaskAssignmentModule |
| [margin-analysis.service.ts](apps/server/src/modules/commerce/margin-analysis.service.ts) | 149 | Per-product margin analysis + retail-price recommendation + history | injects PrismaService, LandedCostEngine |
| [commerce-command.prompt.ts](apps/server/src/modules/commerce/prompts/commerce-command.prompt.ts) | 144 | Command-interpreter prompt | consumed by commerce-ai.service |
| [weekly-revenue-review.scheduler.ts](apps/server/src/modules/commerce/weekly-revenue-review.scheduler.ts) | 133 | Monday 08:00 business-tz `AutopilotTask` with top-5 actions | injects PrismaService, RevenueBriefingService |
| [invoice-email.template.ts](apps/server/src/modules/commerce/invoice-email.template.ts) | 131 | Invoice HTML email | consumed by commerce.controller |
| [accounting.controller.ts](apps/server/src/modules/commerce/accounting.controller.ts) | 121 | QuickBooks/Xero summary, unsynced invoices, push, chart of accounts | injects PrismaService, QuickbooksConnector, XeroConnector |
| [invoice-receipt.listener.ts](apps/server/src/modules/commerce/invoice-receipt.listener.ts) | 120 | `invoice.paid` → Gmail receipt when contact email + Gmail connected | injects CommerceService, GmailService |
| [revenue-action.controller.ts](apps/server/src/modules/commerce/revenue-action.controller.ts) | 113 | list, overview, reconcile, complete/dismiss/snooze | injects PrismaService, RevenueActionService |
| [margin-on-payment.listener.ts](apps/server/src/modules/commerce/margin-on-payment.listener.ts) | 113 | `invoice.paid` → per-line `MarginSnapshot` | injects PrismaService, LandedCostEngine |
| [recurring-invoice.controller.ts](apps/server/src/modules/commerce/recurring-invoice.controller.ts) | 102 | list/get/create/update/pause/resume/delete | injects RecurringInvoiceService |
| [margin-snapshot-scheduler.service.ts](apps/server/src/modules/commerce/margin-snapshot-scheduler.service.ts) | 100 | Daily margin snapshots (no env kill switch) | injects PrismaService, LandedCostEngine |
| [quote-stale.scheduler.ts](apps/server/src/modules/commerce/quote-stale.scheduler.ts) | 87 | Daily 08:00 UTC stale-quote scan over businesses with SENT quotes | injects PrismaService, CommerceService |
| [document-template.service.ts](apps/server/src/modules/commerce/document-template/document-template.service.ts) | 86 | `CommercialDocumentTemplate` CRUD + setDefault. **No caller** | injects PrismaService (via `as any` cast) |
| [quote-stale.listener.ts](apps/server/src/modules/commerce/quote-stale.listener.ts) | 82 | `quote.stale` → deduped `AiApprovalItem` card | injects PrismaService |
| [nl-search.prompt.ts](apps/server/src/modules/commerce/prompts/nl-search.prompt.ts) | 79 | NL-search prompt | consumed by commerce-ai.service |
| [revenue-intelligence.controller.ts](apps/server/src/modules/commerce/revenue-intelligence.controller.ts) | 78 | forecast, slow-payers, pricing-signals, briefing (+regenerate, delegate-chase) | injects PrismaService, RevenueForecastService, SlowPayerDetector, PricingSignalsService, RevenueBriefingService |
| [storefront-invoice-attribution.listener.ts](apps/server/src/modules/commerce/storefront-invoice-attribution.listener.ts) | 78 | `invoice.paid` → `RevenueAttribution` for storefront-originated bookings | injects PrismaService, RevenueAttributionService |
| [drive-intake.controller.ts](apps/server/src/modules/commerce/drive-intake.controller.ts) | 75 | sync / intake list / approve / reject | injects PrismaService, DriveIntakeOrchestrator, ConnectorIntelligenceService |
| [invoice-overdue.scheduler.ts](apps/server/src/modules/commerce/invoice-overdue.scheduler.ts) | 66 | 15min sweep flipping SENT+past-due to OVERDUE | injects PrismaService, InvoiceWorkflowService |
| [invoice-email.types.ts](apps/server/src/modules/commerce/invoice-email.types.ts) | 61 | Narrow shapes for the email pipeline | — |
| [client-intelligence.prompt.ts](apps/server/src/modules/commerce/prompts/client-intelligence.prompt.ts) | 57 | Client-intelligence prompt | consumed by commerce-ai.service |
| [revenue-reporting-rollup.scheduler.ts](apps/server/src/modules/commerce/revenue-reporting-rollup.scheduler.ts) | 52 | Daily month-to-date rollup per business | injects PrismaService, RevenueReportingService |
| [product-health.prompt.ts](apps/server/src/modules/commerce/prompts/product-health.prompt.ts) | 50 | Product-health prompt | consumed by commerce-ai.service |
| [document-template.controller.ts](apps/server/src/modules/commerce/document-template/document-template.controller.ts) | 48 | 5 CRUD routes at `commerce/document-templates/**`. **No web caller; registered twice** | injects DocumentTemplateService |
| [invoice-from-time.dto.ts](apps/server/src/modules/commerce/dto/invoice-from-time.dto.ts) | 45 | A real DTO class (not inline-typed) so the whitelist can strip | consumed by commerce.controller |
| [revenue-reporting.controller.ts](apps/server/src/modules/commerce/revenue-reporting.controller.ts) | 42 | `GET .../revenue-reports/:preset` | injects RevenueReportingService |
| [financial-copilot.controller.ts](apps/server/src/modules/commerce/financial-copilot.controller.ts) | 42 | pulse, alerts, cash-flow forecast, weekly briefing | injects FinancialCopilotService |
| [drive-intake.listener.ts](apps/server/src/modules/commerce/drive-intake.listener.ts) | 38 | `file.uploaded` → `buildPlan` | injects DriveIntakeOrchestrator |
| [update-revenue-attribution.dto.ts](apps/server/src/modules/commerce/dto/update-revenue-attribution.dto.ts) | 34 | Attribution DTO | consumed by leverage.controller |
| [time-cost.dto.ts](apps/server/src/modules/commerce/dto/time-cost.dto.ts) | 33 | Create/update time-cost DTOs | consumed by leverage.controller |
| [invoice-receipt-builder.service.ts](apps/server/src/modules/commerce/invoice-receipt-builder.service.ts) | 32 | `buildReceipt` payload | injects PrismaService |
| [create-product.dto.ts](apps/server/src/modules/commerce/dto/create-product.dto.ts) | 46 | Product DTO | consumed by commerce.controller |
| [create-document-template.dto.ts](apps/server/src/modules/commerce/document-template/dto/create-document-template.dto.ts) | 21 | Template DTO | consumed by document-template.controller |
| [update-document-template.dto.ts](apps/server/src/modules/commerce/document-template/dto/update-document-template.dto.ts) | 19 | Template DTO | consumed by document-template.controller |
| [update-invoice-status.dto.ts](apps/server/src/modules/commerce/dto/update-invoice-status.dto.ts) | 14 | Status DTO, `@IsIn` over the workflow statuses | consumed by commerce.controller |
| [bulk-products.dto.ts](apps/server/src/modules/commerce/dto/bulk-products.dto.ts) | 13 | Bulk-action DTO | consumed by commerce.controller |
| [document-template.module.ts](apps/server/src/modules/commerce/document-template/document-template.module.ts) | 10 | Registers DocumentTemplateController + Service — **both also registered in CommerceModule** | imported by CommerceModule |
| [mark-invoice-paid.dto.ts](apps/server/src/modules/commerce/dto/mark-invoice-paid.dto.ts) | 7 | **Dead** — declared, never imported anywhere | none |
| [update-quote-status.dto.ts](apps/server/src/modules/commerce/dto/update-quote-status.dto.ts) | 6 | Quote-status DTO | consumed by commerce.controller |

### catalog/ — 4 non-spec files

| File | Lines | What it does | Talks to |
|---|---|---|---|
| [catalog.service.ts](apps/server/src/modules/catalog/catalog.service.ts) | 477 | Sole writer of `Product` + `Service`; public stock projection (`untracked/low/backorder/hide/show_oos`); `linkServiceToProduct` | injects PrismaService, EventEmitter2; emits `catalog.product.*` + legacy `product.*`, `catalog.service.*` |
| [catalog.controller.ts](apps/server/src/modules/catalog/catalog.controller.ts) | 101 | 11 canonical product/service routes incl. one public | injects CatalogService |
| [catalog-service.dto.ts](apps/server/src/modules/catalog/dto/catalog-service.dto.ts) | 70 | Service create/update DTOs | consumed by catalog.controller |
| [catalog.module.ts](apps/server/src/modules/catalog/catalog.module.ts) | 18 | `@Global()` — every module can inject `CatalogService` | registered in app.module.ts:148 |

### marketplace/ — 7 non-spec files (module header: `@keyflow:dormant`)

| File | Lines | What it does | Talks to |
|---|---|---|---|
| [marketplace.service.ts](apps/server/src/modules/marketplace/marketplace.service.ts) | 1838 | Listings, shipping zones, warehouses, inventory, orders, shipments, customs, pre-orders, purchase orders, Excel import/export | injects PrismaService, EventEmitter2, ExpensePostingService, FulfillmentRoutingService, TransactionalEmailService; emits `store_order.created/paid/shipped/delivered/cancelled/refunded`, `preorder.delayed` |
| [fulfillment-routing.service.ts](apps/server/src/modules/marketplace/fulfillment-routing.service.ts) | 1302 | Route orders to warehouses/suppliers, decrement + reserve stock, reorder alerts, PO advance, pick-pack tasks | injects PrismaService, EventEmitter2, ExpensePostingService, TransactionalEmailService; emits `inventory.low/out`, `purchaseOrder.received` |
| [commerce-integration.service.ts](apps/server/src/modules/marketplace/commerce-integration.service.ts) | 940 | 10 `@OnEvent` handlers bridging store orders into CRM contacts, notifications, projects, content | injects PrismaService, CrmService, ExpensesService, TransactionalEmailService |
| [marketplace.controller.ts](apps/server/src/modules/marketplace/marketplace.controller.ts) | 445 | 53 routes across the whole marketplace surface | injects MarketplaceService, CommerceIntegrationService |
| [store-order-routing.listener.ts](apps/server/src/modules/marketplace/store-order-routing.listener.ts) | 95 | `store_order.paid` → ensure routing ran; emit canonical routed/failed | injects PrismaService, EventEmitter2, FulfillmentRoutingService |
| [marketplace.module.ts](apps/server/src/modules/marketplace/marketplace.module.ts) | 21 | 2 controllers, 4 providers, 3 exports | imports PrismaModule, NotificationsModule, `forwardRef(CrmModule)`, ExpensesModule, FinanceModule |
| [marketplace-public.controller.ts](apps/server/src/modules/marketplace/marketplace-public.controller.ts) | 13 | `GET /marketplace/order-status/:token` | injects MarketplaceService |

### supplier/ — 9 non-spec files (module header: `@keyflow:dormant`)

| File | Lines | What it does | Talks to |
|---|---|---|---|
| [supplier.service.ts](apps/server/src/modules/supplier/supplier.service.ts) | 582 | Supplier connections (credentials encrypted at rest), supplier products, variants, product source links, cost profiles, margin snapshots | injects PrismaService, ProductNormalizationService; uses `encryptCredentials`/`decryptCredentials` |
| [supplier.controller.ts](apps/server/src/modules/supplier/supplier.controller.ts) | 237 | 22 routes. **Zero web callers** | injects SupplierService |
| [product-normalization.service.ts](apps/server/src/modules/supplier/product-normalization.service.ts) | 214 | Supplier product → `Product` upsert/create/refresh, respecting the catalog boundary | injects PrismaService, CatalogService |
| [supplier-adapter.interface.ts](apps/server/src/modules/supplier/supplier-adapter.interface.ts) | 93 | `SupplierCatalogAdapter`, `SupplierOrderAdapter`, `CarrierAdapter` + normalized shapes. **Zero implementations** | — |
| [credentials.util.ts](apps/server/src/modules/supplier/credentials.util.ts) | 55 | AES-256-GCM `enc:v1:` envelope, key derived from `CREDENTIALS_ENCRYPTION_KEY` or `JWT_SECRET` with salt `supplier-credentials-salt` | used by supplier.service |
| [update-connection.dto.ts](apps/server/src/modules/supplier/dto/update-connection.dto.ts) | 30 | Connection DTO | consumed by supplier.controller |
| [create-connection.dto.ts](apps/server/src/modules/supplier/dto/create-connection.dto.ts) | 24 | Connection DTO | consumed by supplier.controller |
| [supplier.module.ts](apps/server/src/modules/supplier/supplier.module.ts) | 14 | 1 controller, 2 providers, 2 exports | registered in app.module.ts:182 |
| [dto/index.ts](apps/server/src/modules/supplier/dto/index.ts) | 2 | Barrel | — |

### procurement/ — 5 non-spec files

| File | Lines | What it does | Talks to |
|---|---|---|---|
| [procurement.service.ts](apps/server/src/modules/procurement/procurement.service.ts) | 346 | `ProcurementRequest` lifecycle: create → submit → approve/reject → vendor → PO → acknowledge → fulfil → invoice; `inferCategory` + `generatePackages` are hardcoded heuristics | injects PrismaService, TimelineService (via `as any` for `procurementRequest`); writes `purchaseOrder`, reads `supplierConnection` |
| [procurement.controller.ts](apps/server/src/modules/procurement/procurement.controller.ts) | 111 | 14 routes | injects ProcurementService |
| [update-procurement-request.dto.ts](apps/server/src/modules/procurement/dto/update-procurement-request.dto.ts) | 19 | Request DTO | consumed by procurement.controller |
| [create-procurement-request.dto.ts](apps/server/src/modules/procurement/dto/create-procurement-request.dto.ts) | 14 | Request DTO | consumed by procurement.controller |
| [procurement.module.ts](apps/server/src/modules/procurement/procurement.module.ts) | 12 | 1 controller, 1 provider | imports TimelineModule |

### subscriptions/ — 5 non-spec files

| File | Lines | What it does | Talks to |
|---|---|---|---|
| [subscriptions.service.ts](apps/server/src/modules/subscriptions/subscriptions.service.ts) | 522 | Plans, trials, activate/cancel, history, `checkLimit` (14 resources), checkout, manual payments, billing dashboard | injects PrismaService; writes `subscription`, `subscriptionPayment` |
| [plans.ts](apps/server/src/modules/subscriptions/plans.ts) | 476 | `PLANS` (FREE/FLOW/KEYFLOW) with 25 declared limits; `AI_CREDIT_COSTS`; `SYSTEM_AI_FEATURES`; overage rates | consumed by subscriptions.service, ai-usage.service, plan-limit specs |
| [subscriptions.controller.ts](apps/server/src/modules/subscriptions/subscriptions.controller.ts) | 94 | 12 routes; `plans` + `feature-registry` unauthenticated | injects SubscriptionsService |
| [plan-limit.guard.ts](apps/server/src/modules/subscriptions/plan-limit.guard.ts) | 41 | `@RequirePlanLimit(resource)` → `checkLimit` → 403 `PLAN_LIMIT_REACHED` | injects Reflector, SubscriptionsService; provided in CrmModule and CommerceModule |
| [subscriptions.module.ts](apps/server/src/modules/subscriptions/subscriptions.module.ts) | 12 | 1 controller, 1 provider, 1 export | imported by CrmModule, CommerceModule |

### retainers/ — 3 non-spec files

| File | Lines | What it does | Talks to |
|---|---|---|---|
| [retainer.controller.ts](apps/server/src/modules/retainers/retainer.controller.ts) | 218 | 8 routes; DTOs carry validator metadata so `contactId`/`invoiceId` survive the whitelist | injects RetainerService |
| [retainer.service.ts](apps/server/src/modules/retainers/retainer.service.ts) | 200 | `RetainerAgreement` + `RetainerPeriod` CRUD, summary; tenant-checks `contactId` and `invoiceId` (both are bare String columns with no FK) | injects PrismaService |
| [retainer.module.ts](apps/server/src/modules/retainers/retainer.module.ts) | 10 | 1 controller, 1 provider, 1 export | registered in app.module.ts:210 |

## Data model

The slice reads or writes **98 distinct Prisma models** (re-derived from `prisma.client.X` / `this.db.X` / `tx.X` accessors).

**Written exclusively by this slice (51 models), by owning module:**

- **crm** (21): `contactAuditEntry`, `contactChannelStat`, `contactCustomFieldValue`, `contactDataIssue`, `contactExportJob`, `contactForgetRequest`, `contactImport`, `contactImportContact`, `contactInsightSnapshot`, `contactList`, `contactListMember`, `contactMedia`, `contactNote`, `contactPlaybook`, `contactReadState`, `contactRelationship`, `contactSavedView`, `conversationAIInsight`, `crmSequence`, `crmSequenceEnrollment`, `customFieldDefinition`, `dealStage`, `mergeOperation`, `sequenceAttribution`, `whatsAppContact`, `wonLostReason`
- **commerce** (6): `invoiceItem`, `quoteItem`, `paymentLink`, `revenueAttribution`, `timeCostEntry`, `webhookEvent`
- **catalog** (2): `product`, `service` — enforced by [catalog.boundary.spec.ts](apps/server/src/modules/catalog/catalog.boundary.spec.ts); I re-ran its regex over `apps/server/src` and found zero violations outside the module
- **marketplace** (7): `marketplaceListing`, `shippingZone`, `warehouse`, `shipment`, `customsDeclaration`, `preOrder`, `fulfillmentRoute`
- **supplier** (5): `supplierConnection`, `supplierProduct`, `supplierVariant`, `productVariant`, `productSourceLink`
- **retainers** (2): `retainerAgreement`, `retainerPeriod`
- **subscriptions** (2): `subscription`, `subscriptionPayment`
- **shared inside the slice** (3): `marginSnapshot` + `productCostProfile` (commerce **and** supplier), `purchaseOrder` (marketplace **and** procurement)

**Written by the slice *and* by modules outside it (29 models)** — these are the real coupling surface:

| Model | Written in slice by | Also written outside |
|---|---|---|
| `business` | commerce, crm, marketplace | 40 files |
| `contact` | crm, commerce | 21 files (connectors, autopilot, shopify, bookings, …) |
| `invoice` | commerce, crm, marketplace | 9 files (quickbooks/xero connectors, payments, projects, …) |
| `project`, `socialPost` | marketplace | 6 files each |
| `inventoryStock`, `booking` | marketplace / crm | 5 files each |
| `contactTask`, `contactExternalMapping`, `scheduledAgentJob` | crm / marketplace | 4 files each |
| `payment`, `revenueAction`, `marketplaceOrder`, `stockMovement`, `autopilotTask`, `aiApprovalItem` | commerce / marketplace | 3 files each |
| `deal`, `driveIntakeFile`, `notification`, `momentumRecommendation`, `taskAssignment`, `recurringInvoice`, `quote` | crm / commerce / marketplace | 2–3 files each |
| `account`, `contactEvent`, `contactMomentum`, `contactMomentumSnapshot`, `customerJourney`, `journeyTouchpoint` | crm | 1 file each (trash, communications, momentum, growth-intelligence) |

The important structural fact: `Contact` and `Invoice` are *not* exclusively owned. Twenty-one files outside this slice write contacts and nine write invoices, which is why `Contact.status` semantics drift (see below).

`ProcurementRequest` and `CommercialDocumentTemplate` are accessed only through `(this.prisma.client as any)` casts, so they are invisible to typed model greps.

## External services

| Service | Where | Env vars |
|---|---|---|
| Google OAuth (Gmail + People) | [gmail.service.ts](apps/server/src/modules/commerce/gmail.service.ts), [crm-google.service.ts](apps/server/src/modules/crm/crm-google.service.ts) | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `GMAIL_REDIRECT_URI`, `GOOGLE_STATE_SECRET` |
| Gmail API | `gmail.googleapis.com` — messages, threads, labels, send | (above) |
| Google People API | `people.googleapis.com/v1/people/me/connections` | (above) |
| Apollo.io | [apollo-enrichment.provider.ts](apps/server/src/modules/crm/enrichment/apollo-enrichment.provider.ts) — `POST /v1/people/match` | `APOLLO_API_KEY` (absent ⇒ `enabled=false`, provider never called), `APOLLO_BASE_URL` (default `https://api.apollo.io`), `APOLLO_TIMEOUT_MS` (default 8000) |
| QuickBooks / Xero | [accounting.controller.ts](apps/server/src/modules/commerce/accounting.controller.ts) via `QuickbooksConnector` / `XeroConnector` (`core/connectors`) | configured in the connector layer |
| S3 / object storage | GDPR export bundles in [contact-privacy.service.ts](apps/server/src/modules/crm/privacy/contact-privacy.service.ts) | `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `PRIVATE_OBJECT_DIR` |
| Credential encryption | [credentials.util.ts](apps/server/src/modules/supplier/credentials.util.ts) — AES-256-GCM, `enc:v1:` prefix | `CREDENTIALS_ENCRYPTION_KEY` **or** `JWT_SECRET`; throws in production if neither set, dev falls back to a fixed literal key |
| LLM gateway | `AiUsageService` / `ModelGatewayService` injected by 8 services in this slice | configured in `modules/ai` |
| Scheduler control | 15 schedulers | `DISABLE_SCHEDULERS`, `KF_DISABLE_SCHEDULERS`, `LEAD_SCORE_SCHEDULER_DISABLED`, `CRM_HEALTH_SCHEDULER_DISABLED`, `DEAL_INTEL_SCHEDULER_DISABLED`, `LEAD_SCORE_SCHEDULER_HOUR_UTC`, `CRM_HEALTH_SCHEDULER_HOUR_UTC`, `DEAL_INTEL_SCHEDULER_HOUR_UTC`, `NODE_ENV` |
| Other | `KF_DISABLE_MX` (data-quality MX lookups), `DISABLE_FORGET_SCHEDULER`, `NEXT_PUBLIC_APP_URL`, `DATABASE_URL` | |

## Wiring reality

**Module registration is clean.** All eight modules are imported in [app.module.ts](apps/server/src/app.module.ts) at lines 147, 148, 149, 167, 178, 179, 180, 210 (`CrmModule`, `CatalogModule`, `CommerceModule`, `SubscriptionsModule`, `MarketplaceModule`, `ProcurementModule`, `SupplierModule`, `RetainerModule`). Every `@Injectable` in the slice is in a `providers` array, and I checked every one for a consumer: the only classes referenced solely by their own module file are listeners and schedulers, which is correct — they self-activate via `@OnEvent` and `OnModuleInit`. **There are no orphaned providers.** The wiring problems in this slice are all one layer up: routes with no client, clients calling routes that don't exist, and handlers with no guard.

The following are the concrete defects, most severe first.

---

### 1. `POST /commerce/businesses/:businessId/invoices` has no guards at all

[commerce.controller.ts:456-471](apps/server/src/modules/commerce/commerce.controller.ts). The `@UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard, PlanLimitGuard)` + `@RequirePlanLimit('invoices')` block at line 424 is consumed by `invoiceUnbilledTime` (the `invoices/from-time` handler at line 441). `createInvoice` at line 457 carries **zero decorators** — no `@UseGuards`, no `@RequireModuleScope`, no `@RequirePlanLimit` — and `CommerceController` has no class-level guard (verified: `@Controller('commerce')` at line 31, constructor immediately after). There is no `APP_GUARD` in this repo, so this route is unauthenticated. It writes `Invoice` + `InvoiceItem` rows for any `businessId` in the path and emits `invoice.created`, which fans out to the whole revenue listener chain. The `invoices` plan limit is also not enforced on the primary invoice-creation path — only on the from-time variant.

### 2. `GET /commerce/quotes/:quoteId` is an unauthenticated cross-tenant read

[commerce.controller.ts:632-635](apps/server/src/modules/commerce/commerce.controller.ts) has no guards. It calls `CommerceService.getQuote` ([commerce.service.ts:908](apps/server/src/modules/commerce/commerce.service.ts)), which is `prisma.client.quote.findUnique({ where: { id: quoteId } })` — **no `businessId` filter** — and includes `contact` (firstName, lastName, email), `items`, `invoice`, and `business` (name, address, phone, email, website, logo). Anyone with a quote id reads another tenant's quote and their customer's PII. Contrast the deliberate public path two declarations below: `GET /commerce/public/quotes/:token` uses a signed `viewToken` plus `PublicRateLimitGuard`.

Beyond these two, 13 more routes in the slice have no `AuthGuard`; all are intentional (`/crm/health`, `/commerce/health`, the four OAuth callbacks and token-authenticated public surfaces, `GET /crm/contact-exports/:token/download`, `GET /marketplace/order-status/:token`).

### 3. Nothing ever promotes a contact past `LEAD`

`Contact.status` defaults to `"LEAD"` ([schema.prisma:2480](packages/db/prisma/schema.prisma)) and `createContact` writes `input.status ?? 'LEAD'` ([crm.service.ts:437](apps/server/src/modules/crm/crm.service.ts)). I grepped every `contact.status` write in `apps/server/src`. The complete set is:

- `crm.service.ts:437` — create, defaults `LEAD`
- `crm.service.ts:913` — undo-delete, resets to `LEAD`
- `crm.service.ts:978 / 1003 / 1027` — pass through whatever `input.status` the caller supplied
- `crm-ai.service.ts:1276` — AI `change_status` action, validated against `['LEAD','PROSPECT','CLIENT','LOST']`
- `ai/key-command.service.ts:350` and `shopify/shopify.service.ts:227,296` — outside this slice, and both write `'CUSTOMER'`

There is **no** listener on `invoice.paid`, `crm.deal.won`, `quote.accepted` or `store_order.paid` that touches `status`. The store-order bridge instead writes `tags: ['customer','store-order','paid']` ([commerce-integration.service.ts:172](apps/server/src/modules/marketplace/commerce-integration.service.ts)) while leaving `status: 'LEAD'`. Every read-side consumer that segments on lifecycle — `crm-flow.service.ts:96` (`clients: statusMap['CLIENT']`), `crm-ai.service.ts:644,1451,1519`, `crm-actions.service.ts:599,1041`, `contact-insight.service.ts:723`, `crm-relationship-health.service.ts` (AT_RISK only fires for `CLIENT`) — is therefore reading a field only a human ever sets. `lifecycleStage` is the same story: it is selected in 12 places and written in exactly three (`crm.service.ts:260/459/743`, all straight from caller input) plus `autopilot/delegation-loop.service.ts:771` which writes `'STALE'`. No automatic progression.

### 4. Two incompatible status vocabularies

The CRM DTO whitelist admits `LEAD | PROSPECT | CLIENT | LOST` ([create-contact.dto.ts:36](apps/server/src/modules/crm/dto/create-contact.dto.ts), [update-contact.dto.ts:36](apps/server/src/modules/crm/dto/update-contact.dto.ts)) — **`CUSTOMER` is not in that list.** Yet four readers branch on `'CUSTOMER'`:

- [lead-scoring.scheduler.ts:186](apps/server/src/modules/crm/lead-scoring.scheduler.ts) — `if (input.status === 'CUSTOMER') score += 5;`
- `intelligence/health-score.service.ts:143`
- `people-flow/relationship-health.service.ts:135` and `:220`

and two writers produce it, both bypassing the CRM DTO: `shopify/shopify.service.ts:227,296` and `ai/key-command.service.ts:350`. So the `+5` branch in the nightly lead scorer can only ever fire for Shopify-imported contacts. Every contact created through the CRM API is invisible to it.

### 5. Three live UI buttons call routes that return 404

[apps/web/src/lib/client.ts:5711,5714,5717](apps/web/src/lib/client.ts) declare:

```
POST /commerce/businesses/:id/recurring-invoices/:id/toggle
POST /commerce/businesses/:id/recurring-invoices/:id/cancel
GET  /commerce/businesses/:id/recurring-invoices/:id/history
```

[recurring-invoice.controller.ts](apps/server/src/modules/commerce/recurring-invoice.controller.ts) declares `pause` (L80), `resume` (L89), `DELETE .../recurring-invoices/:id` (L98) and no history route at all. All three client functions are wired to real UI: `recurring-panel.tsx:266` and `:816` (single + bulk toggle), `:278` (cancel), `:293` (history). Pause/resume, cancel and the generation-history drawer are all broken in the recurring-invoices panel.

I verified this is the **complete** set: I extracted all 463 routes from the 28 controllers mechanically, extracted 273 distinct API paths from `apps/web/src`, and matched them. Every other apparent mismatch resolves to a template-literal query string (`` `...${qs}` ``), a base-path variable (`` const basePath = `/marketplace/businesses/${businessId}` ``), a two-parameter route my extractor truncated, or a `/drive/**` path owned by `google-drive.controller.ts` outside this slice.

### 6. Two parallel document-template systems; the real one has no client

- `GET /commerce/businesses/:businessId/document-templates` ([commerce.controller.ts:372](apps/server/src/modules/commerce/commerce.controller.ts)) returns a **hardcoded array of six literals** — `classic`/`modern`/`minimal` × invoice/quote — reading only `business.invoiceTemplate` / `quoteTemplate` to mark `isDefault`. It never touches a template table. This is what the web calls (`apps/web/src/lib/client.ts`).
- [document-template.controller.ts](apps/server/src/modules/commerce/document-template/document-template.controller.ts) exposes 5 real CRUD routes at `commerce/document-templates/businesses/:businessId` backed by [document-template.service.ts](apps/server/src/modules/commerce/document-template/document-template.service.ts), which does genuine Prisma work on `CommercialDocumentTemplate` (model exists, `schema.prisma:10217`). `grep -rn "commerce/document-templates" apps/web/src` returns **nothing**.

On top of that, `DocumentTemplateController` and `DocumentTemplateService` are registered **twice** — in [document-template.module.ts:6,7](apps/server/src/modules/commerce/document-template/document-template.module.ts) and again in [commerce.module.ts:89,127](apps/server/src/modules/commerce/commerce.module.ts), which also imports `DocumentTemplateModule` at line 79. Nest instantiates the controller in both modules and mounts its five routes twice.

### 7. The entire `/supplier/**` HTTP surface has no client

22 routes, a 582-line service, a 214-line normalisation service. `grep -rloE "['\`]/supplier/" apps/web/src` returns **zero files**. The "Suppliers" tab that exists ([commerce-suppliers-tab.tsx](apps/web/src/app/app/marketplace/components/commerce-suppliers-tab.tsx), marked `@keyflow:dormant`) makes no API calls at all — it derives supplier cards from `purchaseOrders` props passed down from the marketplace page. `SupplierService` is *not* dead code, though: `ai/flow-orchestrator.service.ts:478` resolves it via `moduleRef.get(SupplierService, {strict:false})` and `flow-tool-registry.ts` registers six `suppliers_*` tools. The HTTP surface is what has no consumer.

Inside that module:
- [supplier-adapter.interface.ts](apps/server/src/modules/supplier/supplier-adapter.interface.ts) declares `SupplierCatalogAdapter`, `SupplierOrderAdapter` and `CarrierAdapter`. `grep -rn "implements Supplier\|SupplierCatalogAdapter" apps/server/src` finds **one hit — the declaration itself**. Nothing implements `connect`, `validate`, `importCatalog`, `fetchProduct`, `placeOrder`, `getTrackingInfo` or `getRates`. `SupplierOrderAdapter` and `CarrierAdapter` are not even imported anywhere. Supplier connections store encrypted credentials for integrations that have no code path.
- `SupplierService.importAndNormalizeProduct` (L548) takes the normalizer as a function argument and has **zero production callers** — only a comment in `flow-tool-registry.ts:3742` and an assertion in `ai/supplier-tools.spec.ts:131`.
- `SupplierService.getDecryptedCredentials` (L573) has **zero production callers**. Credentials are encrypted on write and never decrypted anywhere in shipping code. `ai/supplier-tools.spec.ts:73` asserts that deliberately.

### 8. `MarkInvoicePaidDto` is declared and never imported

[mark-invoice-paid.dto.ts](apps/server/src/modules/commerce/dto/mark-invoice-paid.dto.ts). `grep -rn "MarkInvoicePaidDto" apps/server/src apps/web/src` returns exactly one line: the declaration. The actual `PATCH /commerce/invoices/:invoiceId/paid` handler uses `@Body('businessId') businessId: string` (which it then never forwards — `BusinessGuard` is what reads it, and `markInvoicePaid`'s membership check runs against the invoice's own `businessId`, so this is safe but the parameter is decorative).

### 9. Nineteen of twenty-five sold plan limits enforce nothing

`PLANS` declares 25 limits. `@RequirePlanLimit` appears on exactly 7 routes server-wide (`automations` ×3, `bookings`, `products`, `invoices`, `contacts`), and `aiCreditsPerMonth` is enforced in `ai-usage.service.ts`. That is 6 limits with teeth. `SubscriptionsService.checkLimit` implements 14 resources; 8 of them — including `marketplace_listings` and `warehouses`, both owned by this slice — have no caller. [plan-limit-enforcement.spec.ts](apps/server/src/modules/subscriptions/plan-limit-enforcement.spec.ts) ratchets this as a shrink-only ledger rather than fixing it, and its header documents that the count was wrong four times before it was right.

### 10. Smaller items

- **`generatePackages` silently degrades.** [procurement.service.ts:300-334](apps/server/src/modules/procurement/procurement.service.ts): `inferCategory` returns one of **nine** categories (`branding`, `storefront`, `crm`, `bookings`, `commerce`, `pricing`, `sales`, `inventory`, `general`) but the `packages` lookup table has only **four** keys. Requests classified as bookings/commerce/pricing/sales/inventory all fall through to `packages.general` and get the same two generic packages with the same hardcoded price ranges. `generateBrief` (L336) returns a literal `aiConfidence: 75`. The header comment says "replace with LLM when quota available".
- **Two competing action-card systems from one event.** `quote.stale` is handled by [quote-stale.listener.ts](apps/server/src/modules/commerce/quote-stale.listener.ts) (writes `AiApprovalItem`), [revenue-action.service.ts:96](apps/server/src/modules/commerce/revenue-action.service.ts) (writes `RevenueAction`) and [revenue-event.listener.ts:118](apps/server/src/modules/crm/revenue-event.listener.ts) (writes a ContactEvent). One stale quote produces cards in two different queues.
- **`FeatureFlagGuard` fails open in four places.** [feature-flag.guard.ts](apps/server/src/modules/crm/guards/feature-flag.guard.ts) returns `true` when there is no reflector, no `businessId` param, no business row, or no `metaData.features` object, and only blocks on `features[feature] === false`. A business with no metadata gets every AI feature. That is likely the intent, but it means the 38 routes decorated with it are effectively ungated by default.
- **`CrmRateLimitGuard` is real but narrow.** 259 of 463 routes carry `@CrmRateLimit`. I checked all 15 controllers that apply the guard — every one also has per-handler metadata, so there is no case of a guard applied with nothing to enforce. But `CommerceController` (~90 routes, including all invoice and quote mutations), `RevenueActionController`, `LeverageController`, `CatalogController`, `AccountingController`, `SubscriptionsController` and `DriveIntakeController` do not use it at all.
- **84 handlers take inline-typed `@Body() body: { … }`.** The global pipe is `ValidationPipe({ whitelist: true, transform: true })` with no `forbidNonWhitelisted` ([app-bootstrap.ts:28](apps/server/src/app-bootstrap.ts)). Whitelist can only strip properties it can see declared on a DTO class, so these 84 bodies are passed through untouched — 25 in `crm.controller.ts`, 26 in `commerce.controller.ts`. Two files in the slice call this out and use real DTO classes instead ([invoice-from-time.dto.ts](apps/server/src/modules/commerce/dto/invoice-from-time.dto.ts), [retainer.controller.ts](apps/server/src/modules/retainers/retainer.controller.ts)).
- **`purchaseOrder` has two owners.** `marketplace/fulfillment-routing.service.ts:521,980,1078` and `marketplace/marketplace.service.ts:846,913` write it, and so does `procurement/procurement.service.ts:181`. There is no boundary test for it (unlike `Product`/`Service`).
- **Retainers never bill.** `RetainerAgreement` carries `monthlyAmount` and `includedHours`, but there is no scheduler and no invoice generation anywhere in the module. `RetainerPeriod.invoiceId` is set only by an explicit `PATCH .../periods/:periodId` call. The agreement is a record, not a billing engine.
- **`/catalog/**` is the canonical product surface with one caller.** Eleven routes; the only web reference is `apps/web/src/app/app/commerce/components/upsell-config-panel.tsx:29`. Everything else still goes through the `@deprecated` `/commerce/businesses/:id/products` pass-throughs.
- **`marketplace` and `supplier` carry `@keyflow:dormant` headers**, and `featureFlags.supplier` / `featureFlags.marketplaceBrowsing` default to `false` in production ([apps/web/src/lib/feature-flags.ts](apps/web/src/lib/feature-flags.ts)). That is a *navigation* gate only — the 76 server routes stay mounted and reachable regardless.

## Tests

14 spec files, 1,795 lines, covering roughly 3% of the slice by line count. What they actually assert:

| Spec | Asserts |
|---|---|
| [invoice-workflow.service.spec.ts](apps/server/src/modules/commerce/invoice-workflow.service.spec.ts) | The pure core: `roundMoney`, `computeBalance` (partials, over-payment, refunds regardless of stored sign, PENDING/FAILED ignored, TTD/USD float drift), `deriveStatusAfterPayment`, `isLegalTransition`. The best-covered logic in the slice |
| [invoice-status-contract.spec.ts](apps/server/src/modules/commerce/invoice-status-contract.spec.ts) | The client↔server contract for status updates: body satisfies `BusinessGuard`, survives the ValidationPipe, rejects out-of-set statuses, and the whitelist strips `businessId` *after* the guard read it. Also pins the verbs (mark-paid/status are PATCH, never POST) |
| [system-actor-authority.spec.ts](apps/server/src/modules/commerce/system-actor-authority.spec.ts) | The KEY system actor: recognised only as `KEY`, can mark paid in its own tenant, is refused across tenants with an indistinguishable "not found", and is refused entirely when no `businessId` scope was supplied |
| [crm-deals-won-event.spec.ts](apps/server/src/modules/crm/crm-deals-won-event.spec.ts) | Both win paths emit `crm.deal.won` with `contactId`; non-WON moves do not; `crm.deal.stage_changed` is not a substitute; the sequence scheduler still listens for exactly that name; `bulkMoveStage` delegates rather than being a third path |
| [revenue-event.listener.spec.ts](apps/server/src/modules/crm/revenue-event.listener.spec.ts) | Idempotency: fresh events write, same `dedupeKey` in the recent window skips, different key writes, legacy rows without a key are matched by entityId, unresolvable contacts no-op, `payment.failed` resolves the contact via invoice lookup |
| [contact-enrichment.service.spec.ts](apps/server/src/modules/crm/enrichment/contact-enrichment.service.spec.ts) | Never overwrites; no-ops when unconfigured; handles the fill-during-call race; cooldown unless forced; stamps a genuine miss but not a provider error; denies a member without edit permission before any paid lookup |
| [crm-relationship-health.service.spec.ts](apps/server/src/modules/crm/crm-relationship-health.service.spec.ts) + [relationship-health.spec.ts](apps/server/src/modules/crm/relationship-health.spec.ts) | Classification by days since contact, boundary inclusivity, AT_RISK only for `CLIENT` and only past the client threshold, manual override skip, dryRun, threshold normalisation forcing hot<warm<cold |
| [crm-sequence-graph.util.spec.ts](apps/server/src/modules/crm/crm-sequence-graph.util.spec.ts) | 339 lines — the most thorough file here. `pickVariantId` weighting distribution, sticky promoted winner, zero-weight fallback; `validateGraph` variant caps, duplicate ids, negative weights, strict subject/body rules, branch-condition requirements |
| [catalog-availability.spec.ts](apps/server/src/modules/catalog/catalog-availability.spec.ts) | Public stock projection across untracked / in-stock / low / `hide` / `show_oos` / `allow_backorder` |
| [catalog.boundary.spec.ts](apps/server/src/modules/catalog/catalog.boundary.spec.ts) | Walks all of `apps/server/src` and fails on any `Product`/`Service` Prisma **write** outside `modules/catalog` |
| [contact-taxonomy.spec.ts](apps/server/src/modules/crm/contact-taxonomy.spec.ts) | Relationship-edge inverse table is total and an involution; symmetric edges are self-inverse; label getters fall back rather than throwing |
| [plan-limit-enforcement.spec.ts](apps/server/src/modules/subscriptions/plan-limit-enforcement.spec.ts) | A shrink-only debt ledger: no limit may be added to the pricing page without a decision about enforcing it; the AI credit limit stays enforced |
| [plan-limits.spec.ts](apps/server/src/modules/subscriptions/plan-limits.spec.ts) | FREE never exceeds the cheapest paid tier on any limit; FREE's advertised AI allowance matches what it grants; every plan declares a credit limit |

**What has no test at all:**

- `CommerceService` (2,155 lines) — no spec for `convertQuoteToInvoice`, `recordPayment`, `markInvoicePaid`, `respondToQuoteByToken`, `createQuote`, `updateQuote`, or the payment-link surface. Only the pure helpers extracted into `invoice-workflow.service.ts` are covered.
- `CrmService` (2,016 lines) — nothing. No test for contact create/merge/revert/bulk, the tenant-scoping helpers, or `findOrCreateContact`.
- The entire **marketplace** module (4,554 lines, 54 routes) — zero specs. Order lifecycle, fulfilment routing, inventory decrement/reservation, purchase-order advance: all untested.
- The entire **supplier** module (1,251 lines) — no spec inside the module. The only assertions about it live in `ai/supplier-tools.spec.ts`, and they are about which tools *may not* exist.
- The entire **procurement** and **retainers** modules.
- All 15 schedulers. Several expose `runOnce()` / `tick(now)` "public for tests" and no test calls them.
- All 66 `@OnEvent` handlers except the `RevenueEventListener` and `crm.deal.won` cases above. In particular the seven-way `invoice.paid` fan-out has no test that the handlers are independent or idempotent.
- Every AI service (`crm-ai`, `commerce-ai`, `commerce-intelligence`, `conversation-ai`, `financial-copilot`, `revenue-briefing`) — ~5,200 lines.
- `RevenueReportingService` (1,045 lines, 15 report presets).

Note: [contact-taxonomy.spec.ts:48](apps/server/src/modules/crm/contact-taxonomy.spec.ts) opens with `it('has tables to check — this is not vacuous')` and [plan-limit-enforcement.spec.ts:203](apps/server/src/modules/subscriptions/plan-limit-enforcement.spec.ts) with `it('finds both sides — this check is not vacuous')` — the codebase already has the habit of guarding against green-but-empty assertions.

## Open questions

1. **Is the `LEAD → CLIENT` transition meant to be manual?** No code advances it, the read side depends on it heavily, and there is no product doc in the repo stating the intent. If it is manual, the AT_RISK classification and every `status: 'CLIENT'` query are near-dead for tenants who never edit the field by hand.
2. **`CUSTOMER` vs `CLIENT`** — is `CUSTOMER` a legacy value from a Shopify-first era, or the intended target that the CRM DTO forgot? Resolving it one way or the other changes whether `lead-scoring.scheduler.ts:186` is a bug or dead weight.
3. **Which recurring-invoice contract is authoritative?** Should the server grow `toggle`/`cancel`/`history`, or should the client migrate to `pause`/`resume`/`DELETE`? A `history` endpoint has no server-side implementation at all, so the answer needs a product decision about whether generation history is retained.
4. **Are the 22 supplier routes pre-work for an unbuilt integration, or leftovers?** The three adapter interfaces have no implementations and the credential-decryption path has no caller, which reads like scaffolding for a sync engine that was never written. Either the module is a placeholder or a large chunk is missing.
5. **`DocumentTemplateService`** — is the `CommercialDocumentTemplate` table live in production? If yes, someone's saved templates are unreachable from the UI. If no, both the service and the double controller registration should go.
6. **Why five different scheduler kill switches?** And should the four schedulers with no switch (`best-channel`, `crm-sequence`, `financial-briefing`, `margin-snapshot`) get one — particularly `crm-sequence-scheduler`, which ticks every 60s even under `NODE_ENV=test` and can send real sequence steps.
7. **Is `purchaseOrder` owned by marketplace or procurement?** Both write it with different field expectations. There is no boundary test and no ADR.
8. **Retainer billing** — was a generation scheduler intended? `monthlyAmount` and `rolloverHours`/`rolloverCap` are stored and never consumed by anything that produces an invoice.
9. **What was `MarkInvoicePaidDto` for?** It validates an `invoiceId` in the body, but the route takes it from the path. Possibly a remnant of an earlier POST-shaped API.
10. **How many of the 84 inline-typed `@Body()` handlers accept a tenant-selecting field?** I confirmed the pattern is widespread but did not audit each body's shape against its service call — that is the exact scenario the repo's own `whitelist-masks-missing-tenant-checks` note warns about.
