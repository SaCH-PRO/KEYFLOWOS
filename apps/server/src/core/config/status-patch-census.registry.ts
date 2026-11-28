/**
 * RR-STATUS-PATCH-CENSUS (D-261, D-262)
 *
 * Exact-match registry of every `(Bulk)?Update*Dto` class/interface/type
 * (including `extends` / `PartialType` / `PickType` / `OmitType` / `IntersectionType`)
 * and every inline `@Patch` / `@Put` `@Body()` object type in `apps/server/src`
 * declaring a `status` or `stage` property.
 *
 * Each entry classifies how status mutations through that DTO/route are governed:
 *  - `TRANSITION_CHECKED`: validated against an explicit transition table, CAS,
 *    or allowed-target policy, backed by an active proving spec & verbatim case title.
 *  - `DECISION_REFUSED`: generic PATCH explicitly refuses decision statuses so
 *    approvals/rejections go only through audited decision commands, backed by an
 *    active proving spec & verbatim case title.
 *  - `FREE_LABEL`: reversible operator/workflow label or hidden-in-v1 surface
 *    (non-OPEN per D-261/D-262 first-slice scope; sensitive hidden fields noted).
 *  - `OPEN`: unguarded lifecycle status awaiting its dedicated hardening packet
 *    or owner transition ruling (strictly contracts and change orders).
 *
 * Enforced by `status-patch-census.spec.ts`.
 */

export type StatusPatchMode =
  | 'TRANSITION_CHECKED'
  | 'DECISION_REFUSED'
  | 'FREE_LABEL'
  | 'OPEN';

export interface StatusPatchCensusEntry {
  /** Path relative to repo root (`apps/server/src/...`). */
  readonly file: string;
  /** DTO name (`Update*Dto` / `BulkUpdate*Dto`) or inline route key (`ClassName.method@Body`). */
  readonly dtoName: string;
  /** Status/stage field names declared or inherited on this DTO/body. */
  readonly fields: readonly ('status' | 'stage')[];
  /** Enforcement mode for status mutations through this DTO/route. */
  readonly mode: StatusPatchMode;
  /** Rationale, guard summary, or tracking packet/owner-question for OPEN rows. */
  readonly reason: string;
  /** Required for TRANSITION_CHECKED and DECISION_REFUSED: repo-relative path to proving test file. */
  readonly specFile?: string;
  /** Required for TRANSITION_CHECKED and DECISION_REFUSED: exact active `it`/`test` title inside specFile. */
  readonly specCaseTitle?: string;
}

export const STATUS_PATCH_CENSUS: readonly StatusPatchCensusEntry[] = [
  // ── Named Update*Dto / BulkUpdate*Dto declarations (own + inherited) ──
  {
    file: 'apps/server/src/modules/bookings/dto/update-booking-status.dto.ts',
    dtoName: 'UpdateBookingStatusDto',
    fields: ['status'],
    mode: 'TRANSITION_CHECKED',
    reason:
      'Dedicated booking status endpoint validates allowed BookingStatus values, enforces slot-claim overlap refusal via writeBookingStatus on reinstatement, and uses conditional CAS on cancellation.',
    specFile: 'apps/server/src/modules/bookings/booking-overlap.spec.ts',
    specCaseTitle:
      'a slot booked since the cancellation refuses it with the overlap message, writes nothing and announces nothing',
  },
  {
    file: 'apps/server/src/modules/business-assets/dto/update-business-asset.dto.ts',
    dtoName: 'UpdateBusinessAssetDto',
    fields: ['status'],
    mode: 'FREE_LABEL',
    reason:
      'Asset inventory status tag (ACTIVE/PENDING/EXPIRED/ARCHIVED per BUSINESS_ASSET_STATUSES) on hidden-in-v1 business-assets module; no irreversible financial or approval side effect.',
  },
  {
    file: 'apps/server/src/modules/change-orders/change-order.controller.ts',
    dtoName: 'UpdateChangeOrderDto',
    fields: ['status'],
    mode: 'OPEN',
    reason:
      'Generic PATCH accepts arbitrary status string and client-supplied approvedBy without decision command guard; tracked by RR-CHANGE-ORDER-APPROVE-COMMAND.',
  },
  {
    file: 'apps/server/src/modules/command/dto/update-command-item.dto.ts',
    dtoName: 'UpdateCommandItemDto',
    fields: ['status'],
    mode: 'FREE_LABEL',
    reason:
      'Operator task/command-item workflow label (reversible checklist state with no irreversible money or approval transition).',
  },
  {
    file: 'apps/server/src/modules/commerce/dto/update-invoice-status.dto.ts',
    dtoName: 'UpdateInvoiceStatusDto',
    fields: ['status'],
    mode: 'TRANSITION_CHECKED',
    reason:
      'Dedicated invoice status DTO restricts targets via ValidationPipe and CommerceService.updateInvoiceStatus delegates to invoiceWorkflow.transition (409 on illegal PAID transitions).',
    specFile: 'apps/server/src/modules/commerce/invoice-status-contract.spec.ts',
    specCaseTitle: 'rejects a status outside the allowed set',
  },
  {
    file: 'apps/server/src/modules/commerce/dto/update-invoice.dto.ts',
    dtoName: 'UpdateInvoiceDto',
    fields: ['status'],
    mode: 'TRANSITION_CHECKED',
    reason:
      'Generic invoice PATCH restricts status to PatchableInvoiceStatus (SENT/OVERDUE/VOID/PAID) via ValidationPipe and routes PAID through CommerceService.markInvoicePaid.',
    specFile: 'apps/server/test/commerce-authorization.e2e.test.ts',
    specCaseTitle:
      'CMF1-400: a status outside SENT / OVERDUE / VOID / PAID, a non-string notes or an unparseable dueDate -> 400 before CommerceService.updateInvoice is called',
  },
  {
    file: 'apps/server/src/modules/commerce/dto/update-quote-status.dto.ts',
    dtoName: 'UpdateQuoteStatusDto',
    fields: ['status'],
    mode: 'TRANSITION_CHECKED',
    reason:
      'Quote status DTO validates strictly against the quote transition table targets (DRAFT/SENT/ACCEPTED/REJECTED) and refuses converted or illegal transitions.',
    specFile: 'apps/server/src/modules/commerce/quote-workflow.spec.ts',
    specCaseTitle: 'QW-12: UpdateQuoteStatusDto accepts exactly the targets the table knows',
  },
  {
    file: 'apps/server/src/modules/content-ops/dto/update-content-request.dto.ts',
    dtoName: 'UpdateContentRequestDto',
    fields: ['status'],
    mode: 'FREE_LABEL',
    reason:
      'Dead DTO field on hidden-in-v1 content-ops: ContentRequestService.updateRequest ignores dto.status completely; transitions execute only through dedicated POST workflow routes.',
  },
  {
    file: 'apps/server/src/modules/contracts/dto/update-contract.dto.ts',
    dtoName: 'UpdateContractDto',
    fields: ['status'],
    mode: 'OPEN',
    reason:
      'Generic PATCH writes any ContractStatus without a transition check (allowing TERMINATED -> ACTIVE renewal sweep re-trigger); pending owner transition rule and follow-up packet.',
  },
  {
    file: 'apps/server/src/modules/crm/crm.controller.ts',
    dtoName: 'BulkUpdateContactsDto',
    fields: ['status'],
    mode: 'FREE_LABEL',
    reason:
      'Bulk CRM contact PATCH inheriting status via PickType(UpdateContactDto, ...); CRM contact lifecycle label intentionally editable freely by authorized CRM writers.',
  },
  {
    file: 'apps/server/src/modules/crm/dto/update-contact.dto.ts',
    dtoName: 'UpdateContactDto',
    fields: ['status'],
    mode: 'FREE_LABEL',
    reason:
      'CRM contact lifecycle label (LEAD/PROSPECT/CLIENT/LOST) intentionally editable freely by authorized CRM writers.',
  },
  {
    file: 'apps/server/src/modules/events/dto/update-attendee.dto.ts',
    dtoName: 'UpdateAttendeeDto',
    fields: ['status'],
    mode: 'FREE_LABEL',
    reason:
      'Inherits @IsIn([REGISTERED, CANCELLED, CHECKED_IN, REFUNDED]) status via PartialType(CreateAttendeeDto) on hidden-in-v1 events (@HiddenModuleWrites); no transition guard today, tracked outside v1.',
  },
  {
    file: 'apps/server/src/modules/events/dto/update-event.dto.ts',
    dtoName: 'UpdateEventDto',
    fields: ['status'],
    mode: 'FREE_LABEL',
    reason:
      'Inherits @IsIn([DRAFT, PUBLISHED, CANCELLED, COMPLETED]) status via PartialType(CreateEventDto) on hidden-in-v1 events (@HiddenModuleWrites); no transition guard today, tracked outside v1.',
  },
  {
    file: 'apps/server/src/modules/intelligence/dto/create-signal.dto.ts',
    dtoName: 'UpdateBusinessSignalDto',
    fields: ['status'],
    mode: 'FREE_LABEL',
    reason:
      'Intelligence signal triage label (ACTIVE/RESOLVED/IGNORED per STATUSES) on hidden-in-v1 intelligence module; DTO is currently unused by any controller or service.',
  },
  {
    file: 'apps/server/src/modules/key-cortex/key-cortex.controller.ts',
    dtoName: 'UpdateSessionDto',
    fields: ['status'],
    mode: 'FREE_LABEL',
    reason:
      'KEY chat session active/archived state label; reversible user session organization state with no financial or approval side effects.',
  },
  {
    file: 'apps/server/src/modules/key-inbox/dto/update-thread.dto.ts',
    dtoName: 'UpdateThreadDto',
    fields: ['status'],
    mode: 'FREE_LABEL',
    reason:
      'Inbox thread triage label (OPEN/WAITING/DONE/ARCHIVED) on hidden-in-v1 key-inbox; reversible operator inbox state.',
  },
  {
    file: 'apps/server/src/modules/keystore/dto/update-order-status.dto.ts',
    dtoName: 'UpdateOrderStatusDto',
    fields: ['status'],
    mode: 'TRANSITION_CHECKED',
    reason:
      'KeyStore admin order status DTO enforces valid order status transitions via isValidStatusTransition and rejects illegal state jumps.',
    specFile: 'apps/server/src/modules/keystore/__tests__/keystore.service.spec.ts',
    specCaseTitle: 'should reject invalid status transition',
  },
  {
    file: 'apps/server/src/modules/procurement/dto/update-procurement-request.dto.ts',
    dtoName: 'UpdateProcurementRequestDto',
    fields: ['status'],
    mode: 'DECISION_REFUSED',
    reason:
      'ProcurementService.update explicitly refuses decision statuses (APPROVED/REJECTED, case-insensitive) with 400 so decisions only execute through audited approve/reject commands.',
    specFile: 'apps/server/test/ops-scope-command-procurement.integration.test.ts',
    specCaseTitle:
      '[OPS-17] review SEC-D15-3: PATCH cannot decide a request: a body that sets status APPROVED or REJECTED (any case) answers 400 for a member with operations write and the OWNER, the request is byte-identical and no audit row is written; the decision is made only through approve and reject, which record it. A foreign request still answers 404 first, and a PATCH that sets any other status or field still writes',
  },
  {
    file: 'apps/server/src/modules/retainers/retainer.controller.ts',
    dtoName: 'UpdatePeriodDto',
    fields: ['status'],
    mode: 'FREE_LABEL',
    reason:
      'Hidden-in-v1 retainers (@HiddenModuleWrites): RetainerService.updatePeriod writes arbitrary strings to retainerPeriod.status which feeds getSummary.totalRevenue (INVOICED/PAID); unguarded transition tracked outside v1.',
  },
  {
    file: 'apps/server/src/modules/retainers/retainer.controller.ts',
    dtoName: 'UpdateRetainerDto',
    fields: ['status'],
    mode: 'FREE_LABEL',
    reason:
      'Retainer status label on hidden-in-v1 retainers module (@HiddenModuleWrites); dedicated pause/cancel lifecycle rules tracked outside v1.',
  },

  // ── Inline @Patch / @Put @Body() object types accepting status or stage ──
  {
    file: 'apps/server/src/modules/ai/ai.controller.ts',
    dtoName: 'AiController.updateGoal@Body',
    fields: ['status'],
    mode: 'FREE_LABEL',
    reason:
      'Inline PUT body for BusinessGoal.status on hidden-in-v1 /app/goals; reversible KPI goal state label.',
  },
  {
    file: 'apps/server/src/modules/autopilot/autopilot.controller.ts',
    dtoName: 'AutopilotController.updateTaskStatus@Body',
    fields: ['status'],
    mode: 'FREE_LABEL',
    reason:
      'Inline PATCH body for autopilot task triage status on hidden-in-v1 autopilot; reversible operator task state.',
  },
  {
    file: 'apps/server/src/modules/calendar/calendar.controller.ts',
    dtoName: 'CalendarController.patch@Body',
    fields: ['status'],
    mode: 'FREE_LABEL',
    reason:
      'Live-v1 unified calendar PATCH (@RequireModuleScope bookings:write): CalendarQueryService.patchEvent validates status against CALENDAR_EVENT_STATUSES and projects to source rows (bookings via withBookingSlotLock + assertBookingSlotFree, contact_task, project_task; read-only sources refused).',
  },
  {
    file: 'apps/server/src/modules/commerce/recurring-invoice.controller.ts',
    dtoName: 'RecurringInvoiceController.update@Body',
    fields: ['status'],
    mode: 'FREE_LABEL',
    reason:
      'Live-v1 commerce recurring-invoice schedule PATCH (@RequireModuleScope revenue:write): writes input.status unchecked (bypassing pause/resume/cancel commands); non-OPEN per D-261/D-262 first-slice scope (strictly contracts + change orders OPEN) and flagged for follow-up hardening.',
  },
  {
    file: 'apps/server/src/modules/community/community.controller.ts',
    dtoName: 'CommunityController.respondToCollabRequest@Body',
    fields: ['status'],
    mode: 'FREE_LABEL',
    reason:
      'Inline PATCH body for community collab-request response status on hidden-in-v1 community module.',
  },
  {
    file: 'apps/server/src/modules/community/community.controller.ts',
    dtoName: 'CommunityController.respondToCollaboration@Body',
    fields: ['status'],
    mode: 'FREE_LABEL',
    reason:
      'Inline PATCH body for community collaboration response status on hidden-in-v1 community module.',
  },
  {
    file: 'apps/server/src/modules/community/community.controller.ts',
    dtoName: 'CommunityController.respondToOpportunityApplication@Body',
    fields: ['status'],
    mode: 'FREE_LABEL',
    reason:
      'Inline PATCH body for community opportunity-application response status on hidden-in-v1 community module.',
  },
  {
    file: 'apps/server/src/modules/community/community.controller.ts',
    dtoName: 'CommunityController.respondToPartnerProgram@Body',
    fields: ['status'],
    mode: 'FREE_LABEL',
    reason:
      'Inline PATCH body for community partner-program response status on hidden-in-v1 community module.',
  },
  {
    file: 'apps/server/src/modules/community/community.controller.ts',
    dtoName: 'CommunityController.respondToQuoteRequest@Body',
    fields: ['status'],
    mode: 'FREE_LABEL',
    reason:
      'Inline PATCH body for community quote-request response status on hidden-in-v1 community module.',
  },
  {
    file: 'apps/server/src/modules/community/community.controller.ts',
    dtoName: 'CommunityController.updateReferralStatus@Body',
    fields: ['status'],
    mode: 'FREE_LABEL',
    reason:
      'Inline PATCH body for community referral status on hidden-in-v1 community module.',
  },
  {
    file: 'apps/server/src/modules/crm/crm-sequence.controller.ts',
    dtoName: 'CrmSequenceController.updateSequence@Body',
    fields: ['status'],
    mode: 'FREE_LABEL',
    reason:
      'Inline PATCH body for CRM sequence active/paused/archived label; reversible automation toggle.',
  },
  {
    file: 'apps/server/src/modules/documents/documents.controller.ts',
    dtoName: 'DocumentsController.resolveReview@Body',
    fields: ['status'],
    mode: 'FREE_LABEL',
    reason:
      'Inline PATCH body for document review resolution status (carries inline resolvedBy) on hidden-in-v1 documents module; tracked outside v1.',
  },
  {
    file: 'apps/server/src/modules/documents/documents.controller.ts',
    dtoName: 'DocumentsController.updateStatus@Body',
    fields: ['status'],
    mode: 'FREE_LABEL',
    reason:
      'Inline PATCH body for document instance workflow status on hidden-in-v1 documents module.',
  },
  {
    file: 'apps/server/src/modules/finance/finance.controller.ts',
    dtoName: 'FinanceController.updateReserve@Body',
    fields: ['status'],
    mode: 'FREE_LABEL',
    reason:
      'Live-v1 cash-reserve bucket status label (/app/financial-flow); reversible operator organization tag that does not move ledger funds.',
  },
  {
    file: 'apps/server/src/modules/helpdesk/helpdesk.controller.ts',
    dtoName: 'HelpdeskController.updateTicket@Body',
    fields: ['status'],
    mode: 'FREE_LABEL',
    reason:
      'Inline PATCH body for support ticket triage status on hidden-in-v1 helpdesk module.',
  },
  {
    file: 'apps/server/src/modules/marketing/marketing.controller.ts',
    dtoName: 'MarketingController.updateCampaign@Body',
    fields: ['status'],
    mode: 'FREE_LABEL',
    reason:
      'Inline PATCH body for marketing campaign status label on hidden-in-v1 marketing module.',
  },
  {
    file: 'apps/server/src/modules/projects/projects.controller.ts',
    dtoName: 'ProjectsController.updateDeliverable@Body',
    fields: ['status'],
    mode: 'FREE_LABEL',
    reason:
      'Inline PATCH body for project deliverable status label on hidden-in-v1 projects module.',
  },
  {
    file: 'apps/server/src/modules/projects/projects.controller.ts',
    dtoName: 'ProjectsController.updatePlan@Body',
    fields: ['status'],
    mode: 'FREE_LABEL',
    reason:
      'Inline PATCH body for project plan status label on hidden-in-v1 projects module.',
  },
  {
    file: 'apps/server/src/modules/projects/projects.controller.ts',
    dtoName: 'ProjectsController.updateProject@Body',
    fields: ['status'],
    mode: 'FREE_LABEL',
    reason:
      'Inline PATCH body for project status label on hidden-in-v1 projects module.',
  },
  {
    file: 'apps/server/src/modules/projects/projects.controller.ts',
    dtoName: 'ProjectsController.updateTask@Body',
    fields: ['status'],
    mode: 'FREE_LABEL',
    reason:
      'Inline PATCH body for project task status label on hidden-in-v1 projects module.',
  },
  {
    file: 'apps/server/src/modules/projects/projects.controller.ts',
    dtoName: 'ProjectsController.updateTaskStatus@Body',
    fields: ['status'],
    mode: 'FREE_LABEL',
    reason:
      'Inline PATCH body for project task status toggle on hidden-in-v1 projects module.',
  },
  {
    file: 'apps/server/src/modules/seo/seo.controller.ts',
    dtoName: 'SeoController.updateBriefStatus@Body',
    fields: ['status'],
    mode: 'FREE_LABEL',
    reason:
      'Inline PATCH body for SEO brief status (carries inline approvedBy) on hidden-in-v1 SEO module; tracked outside v1.',
  },
  {
    file: 'apps/server/src/modules/site/site.controller.ts',
    dtoName: 'SiteController.moderateReview@Body',
    fields: ['status'],
    mode: 'FREE_LABEL',
    reason:
      'Inline PATCH body for storefront product review moderation status editable freely by storefront moderators.',
  },
  {
    file: 'apps/server/src/modules/site/site.controller.ts',
    dtoName: 'SiteController.updateIntakeStatus@Body',
    fields: ['status'],
    mode: 'FREE_LABEL',
    reason:
      'Inline PATCH body for storefront intake submission triage status editable freely by operators.',
  },
  {
    file: 'apps/server/src/modules/site/site.controller.ts',
    dtoName: 'SiteController.updateOrderStatus@Body',
    fields: ['status'],
    mode: 'TRANSITION_CHECKED',
    reason:
      'W1F-ORDER-TRANSITIONS: PATCH /site orders/:orderId/status enforces forward-only order status transitions, blocks reopening terminal CANCELLED/REFUNDED orders, and uses compare-and-set concurrency guards.',
    specFile: 'apps/server/test/order-transitions.integration.test.ts',
    specCaseTitle:
      'OT-03 PATCH /site refuses moving a SHIPPED, DELIVERED, or COMPLETED order backwards (case-insensitive stored status); idempotent & forward moves stay valid',
  },
  {
    file: 'apps/server/src/modules/sop/sop.controller.ts',
    dtoName: 'SopController.update@Body',
    fields: ['status'],
    mode: 'FREE_LABEL',
    reason:
      'Inline PATCH body for SOP document draft/published/archived label on hidden-in-v1 SOP module.',
  },
];
