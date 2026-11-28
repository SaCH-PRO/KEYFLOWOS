/**
 * RR-STATUS-PATCH-CENSUS (D-261, D-262)
 *
 * Shrink-only / exact-match registry of every `Update*Dto` class, interface, or
 * type alias in `apps/server/src` that declares a `status` or `stage` property.
 *
 * Each entry classifies how status mutations through that DTO are governed:
 *  - `TRANSITION_CHECKED`: validated against an explicit transition table or
 *    allowed-target policy, backed by a named proving spec & verbatim case title.
 *  - `DECISION_REFUSED`: generic PATCH explicitly refuses decision statuses so
 *    approvals/rejections go only through audited decision commands, backed by a
 *    named proving spec & verbatim case title.
 *  - `FREE_LABEL`: non-financial, reversible workflow/triage label where free
 *    editing by an authorized operator is intentional.
 *  - `OPEN`: unguarded lifecycle status awaiting its dedicated hardening packet
 *    or owner transition ruling (currently contracts & change orders only).
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
  /** DTO class, interface, or type alias name (`Update*Dto`). */
  readonly dtoName: string;
  /** Status/stage field names declared on this DTO. */
  readonly fields: readonly ('status' | 'stage')[];
  /** Enforcement mode for status mutations through this DTO. */
  readonly mode: StatusPatchMode;
  /** Rationale, guard summary, or tracking packet/owner-question for OPEN rows. */
  readonly reason: string;
  /** Required for TRANSITION_CHECKED and DECISION_REFUSED: repo-relative path to proving spec. */
  readonly specFile?: string;
  /** Required for TRANSITION_CHECKED and DECISION_REFUSED: exact test case title inside specFile. */
  readonly specCaseTitle?: string;
}

export const STATUS_PATCH_CENSUS: readonly StatusPatchCensusEntry[] = [
  {
    file: 'apps/server/src/modules/bookings/dto/update-booking-status.dto.ts',
    dtoName: 'UpdateBookingStatusDto',
    fields: ['status'],
    mode: 'TRANSITION_CHECKED',
    reason:
      'Dedicated booking status endpoint validates allowed BookingStatus values, claims slots via writeBookingStatus, and applies CAS guards on cancellation and settlement.',
    specFile: 'apps/server/test/booking-settlement.integration.test.ts',
    specCaseTitle:
      'S-03 RED-BEFORE: completing twice, in turn and at once, leaves ONE final invoice and both answers name it',
  },
  {
    file: 'apps/server/src/modules/business-assets/dto/update-business-asset.dto.ts',
    dtoName: 'UpdateBusinessAssetDto',
    fields: ['status'],
    mode: 'FREE_LABEL',
    reason:
      'Asset inventory status tag (ACTIVE/INACTIVE/ARCHIVED/SOLD) on hidden-in-v1 business-assets module; no irreversible financial or approval side effect.',
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
      'Dedicated invoice status DTO restricted via ValidationPipe to allowed transition targets and enforced by CommerceService status rules.',
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
      'Editorial production status label on hidden-in-v1 content-ops requests; reversible workflow state with no irreversible ledger mutation.',
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
    file: 'apps/server/src/modules/crm/dto/update-contact.dto.ts',
    dtoName: 'UpdateContactDto',
    fields: ['status'],
    mode: 'FREE_LABEL',
    reason:
      'CRM contact lifecycle label (LEAD/PROSPECT/CLIENT/LOST) intentionally editable freely by authorized CRM writers.',
  },
  {
    file: 'apps/server/src/modules/intelligence/dto/create-signal.dto.ts',
    dtoName: 'UpdateBusinessSignalDto',
    fields: ['status'],
    mode: 'FREE_LABEL',
    reason:
      'Intelligence signal triage label (ACTIVE/ACKNOWLEDGED/DISMISSED/RESOLVED) on hidden-in-v1 intelligence signals; reversible operator triage state.',
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
      'KeyStore admin order status DTO enforces valid order status transitions and rejects illegal state jumps.',
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
      'Retainer billing period status label on hidden-in-v1 retainers module; dedicated lifecycle rules tracked outside v1.',
  },
  {
    file: 'apps/server/src/modules/retainers/retainer.controller.ts',
    dtoName: 'UpdateRetainerDto',
    fields: ['status'],
    mode: 'FREE_LABEL',
    reason:
      'Retainer status label on hidden-in-v1 retainers module; dedicated pause/cancel lifecycle rules tracked outside v1.',
  },
];
