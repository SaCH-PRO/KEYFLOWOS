import { IsInt, IsNotEmpty, IsNumber, IsOptional, IsPositive, IsString, Min } from 'class-validator';

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
   */
  @IsInt()
  @IsPositive()
  quantity!: number;

  /** A finite, non-negative price. A NaN price arrives as JSON null and is refused here. */
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  unitPrice!: number;

  @IsOptional()
  @IsString()
  productId?: string;
}
