import { IsOptional, IsInt, IsBoolean, Min, Max } from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * A real DTO class, not an inline-typed @Query.
 *
 * The global ValidationPipe's whitelist only strips properties it can see
 * declared on a class. An inline-typed parameter has no metadata, so nothing is
 * stripped and the caller decides what reaches the handler — which is exactly
 * how `pageContext` in flow.controller.ts became a way to supply your own
 * jobRoleEnvelope and skip the role check. Cheap to get right the first time.
 */
export class ListDueObligationsDto {
  /** How far ahead to look. Clamped again in the service; a DTO is not a moat. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  @Transform(({ value }) => (value === undefined || value === '' ? 7 : parseInt(value, 10)))
  windowDays?: number = 7;

  /**
   * Defaults TRUE. "What is due this week" that hides what was due last week is
   * worse than useless — the overdue rows are the ones that cost money.
   */
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => (value === undefined || value === '' ? true : value !== 'false'))
  includeOverdue?: boolean = true;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(500)
  @Transform(({ value }) => (value === undefined || value === '' ? 100 : parseInt(value, 10)))
  limit?: number = 100;
}
