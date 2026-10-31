import { Allow, IsOptional, IsString } from 'class-validator';

/**
 * Body of POST /commerce/businesses/:businessId/invoices/:invoiceId/payments.
 *
 * R0-D2: the route took an inline body type, so the global ValidationPipe
 * (whitelist: true) never saw it and a client could not pass a key the
 * service would honour. This class carries every existing field unchanged
 * and adds the optional `idempotencyKey`.
 *
 * The existing fields are `@Allow()`ed, not validated here: the whitelist
 * keeps them and CommerceService.recordPayment still owns their checks, so
 * the R0-D3 contract (400 "Payment amount must be a number" /
 * "Payment amount must be positive" / "Payment method is required", after
 * the tenant 404) is untouched.
 */
export class RecordPaymentDto {
  @Allow()
  amount!: number;

  @Allow()
  method!: string;

  @Allow()
  reference?: string;

  @Allow()
  notes?: string;

  @Allow()
  evidenceUrl?: string;

  @Allow()
  evidenceMimeType?: string;

  /**
   * Client idempotency key, scoped to the invoice. A second submit carrying
   * the same key returns the payment the first submit recorded (same amount)
   * or answers 409 (different amount). Blank keys are treated as absent.
   */
  @IsOptional()
  @IsString()
  idempotencyKey?: string;
}
