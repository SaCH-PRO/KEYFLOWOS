import { IsIn } from 'class-validator';
import { QUOTE_STATUS_TARGETS, type QuoteStatusTarget } from '../quote-workflow';

/**
 * A requested quote status. V1-50: the list is the transition table's
 * (quote-workflow.ts QUOTE_STATUS_TARGETS), so the DTO cannot accept a status
 * the table has no row for.
 */
export class UpdateQuoteStatusDto {
  @IsIn(QUOTE_STATUS_TARGETS)
  status!: QuoteStatusTarget;
}
