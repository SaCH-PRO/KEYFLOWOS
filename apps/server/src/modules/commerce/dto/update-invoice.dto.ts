import { IsArray, IsDateString, IsIn, IsNumber, IsOptional, IsString, Length } from 'class-validator';

/**
 * The statuses a PATCH of an invoice may ask for. Each is a target the invoice
 * workflow can reach from some state; whether it is legal from the invoice's
 * current state stays with InvoiceWorkflowService (409). DRAFT is not here (no
 * transition leads back to it; undo is its own route), nor PARTIALLY_PAID,
 * PENDING or FAILED (payments drive those, never a status edit).
 */
export const PATCHABLE_INVOICE_STATUSES = ['SENT', 'OVERDUE', 'VOID', 'PAID'] as const;
export type PatchableInvoiceStatus = (typeof PATCHABLE_INVOICE_STATUSES)[number];

/**
 * Body of PATCH /commerce/businesses/:businessId/invoices/:invoiceId
 * (R0-CMF1-INVOICE-PATCH-ACTOR, R0-11 review ST-R011-1).
 *
 * The route took an inline body type, so the global ValidationPipe saw
 * `Object` and stripped nothing: `status` reached CommerceService.updateInvoice
 * unvalidated (an unknown value answered 409 from the workflow, PARTIALLY_PAID
 * flipped the row with no payment behind it), and every other key rode along.
 *
 * Note what is NOT here:
 *   - businessId: it comes from the route param, bound by BusinessGuard.
 *   - the actor (actorId, recordedBy, initiatedBy): it is the authenticated
 *     user, passed by the controller beside the body, never read from it.
 *   - subtotal, taxAmount, discountAmount, total, invoiceNumber: the server
 *     computes or assigns them.
 *
 * The field rules are the create contract's (CreateInvoiceDto), loosened only
 * where an edit differs: every field is optional, and dueDate, discountType,
 * discountValue and notes may be null (the operator edit form clears them that
 * way). taxRate and discountValue are type-checked only; their ranges stay with
 * CommerceService.validateTaxAndDiscount so the R0-D3 messages answer create
 * and update alike. contactId may be null here: the service answers that with
 * its own 400 ('contactId must be a non-empty string', Invoice.contactId is
 * required) and resolves any id inside the caller's tenant (404).
 *
 * items is checked as an array only. The line and computed-amount rules for an
 * edit (R0-27 ST-27-3 / ST-27-4) live in CommerceService.updateInvoice, which
 * refuses before the existing items are deleted, and their messages are the
 * pinned update contract; a nested DTO would answer the same input with a
 * different message.
 */
export class UpdateInvoiceDto {
  @IsOptional()
  @IsString()
  contactId?: string | null;

  @IsOptional()
  @IsArray()
  items?: { description: string; quantity: number; unitPrice: number; productId?: string }[];

  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string;

  @IsOptional()
  @IsDateString()
  dueDate?: string | null;

  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  taxRate?: number;

  @IsOptional()
  @IsIn(['PERCENT', 'FIXED'])
  discountType?: 'PERCENT' | 'FIXED' | null;

  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  discountValue?: number | null;

  @IsOptional()
  @IsString()
  notes?: string | null;

  /**
   * A status change. PAID goes through CommerceService.markInvoicePaid (one
   * balancing manual payment, posted, attributed to the caller), the others
   * through updateInvoiceStatus; both record the actor the controller passes.
   */
  @IsOptional()
  @IsIn(PATCHABLE_INVOICE_STATUSES)
  status?: PatchableInvoiceStatus;
}
