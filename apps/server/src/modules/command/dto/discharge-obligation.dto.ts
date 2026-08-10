import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * A real DTO class, not an inline-typed @Body().
 *
 * The global ValidationPipe's whitelist can only strip properties it can see
 * declared on a class; an inline-typed parameter has no metadata, so nothing is
 * stripped and the caller decides what reaches the handler. That is exactly how
 * `pageContext` in flow.controller.ts became a way to supply your own
 * jobRoleEnvelope and skip the role check.
 *
 * Note what is NOT here: no businessId, no id, no status. Those come from the
 * URL and from the service. A body field that could name the tenant is the
 * whole `{ businessId, ...body }` class of defect.
 */
export class DischargeObligationDto {
  /** What discharged it — a tool name, an invoice id, or a short note. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  dischargeRef?: string;
}
