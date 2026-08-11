import { IsOptional, IsString, IsNumber, Min, Max, MaxLength } from 'class-validator';

/**
 * A real DTO class, not an inline-typed @Body().
 *
 * The global ValidationPipe's whitelist can only strip properties it can see
 * declared, so an inline-typed parameter lets the caller decide what reaches
 * the handler — which is how `pageContext` in flow.controller.ts became a way
 * to supply your own jobRoleEnvelope and skip the role check.
 *
 * Note what is NOT here: no businessId. It comes from the route param, bound by
 * BusinessGuard. A body field that can name the tenant is the whole
 * `{ businessId, ...body }` defect class, and this endpoint creates an invoice.
 */
export class InvoiceFromTimeDto {
  /** Limit to one project. Omitted means every unbilled billable hour. */
  @IsOptional()
  @IsString()
  projectId?: string;

  /** Who to invoice. */
  @IsOptional()
  @IsString()
  contactId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;

  @IsOptional()
  @IsString()
  dueDate?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  taxRate?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
