import { IsInt, IsNotEmpty, IsNumber, IsOptional, IsPositive, IsString, Max, Min } from 'class-validator';

/**
 * The largest quantity a document line may carry. InvoiceItem.quantity is a
 * Postgres int4 column: 2147483648 passed @IsInt and failed inside Prisma as a
 * 500 (R0-27 review, ST-27-4 / R27-CR-1).
 */
export const MAX_LINE_QUANTITY = 2_147_483_647;

/**
 * The largest amount a line price, an invoice subtotal or an invoice total may
 * carry. Invoice amounts are Float columns, but the ledger rows an issued
 * invoice posts (financial_transactions.amount, ledger_entries.debit/credit)
 * are numeric(18,4), so 14 integer digits. A larger amount cannot be posted,
 * and a non-finite one (10 x 1e308 overflows to Infinity) is refused by Prisma
 * as a 500. Both are refused as a 400 instead.
 */
export const MAX_DOCUMENT_AMOUNT = 99_999_999_999_999;

/**
 * One line of a commercial document body (R0-27: invoice create).
 *
 * Only what a client may state about a line is declared here. The line total
 * is NOT: it is quantity x unitPrice, computed by the server, and the global
 * ValidationPipe (whitelist: true) strips a client `total` before the
 * controller sees it.
 */
export class DocumentLineItemDto {
  @IsString()
  @IsNotEmpty()
  description!: string;

  /**
   * A positive whole number. InvoiceItem.quantity is an Int column: a
   * fractional quantity was stored truncated (1.5 -> 1) under a line total
   * computed from the fraction, so the persisted line no longer reconciled.
   * Bounded by the int4 maximum for the same reason.
   */
  @IsInt()
  @IsPositive()
  @Max(MAX_LINE_QUANTITY)
  quantity!: number;

  /**
   * A finite, non-negative price no larger than MAX_DOCUMENT_AMOUNT. A NaN
   * price arrives as JSON null and is refused here. A bounded quantity times a
   * bounded price can still pass the ledger bound; CommerceService refuses
   * that subtotal or total with a 400.
   */
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(MAX_DOCUMENT_AMOUNT)
  unitPrice!: number;

  @IsOptional()
  @IsString()
  productId?: string;
}
