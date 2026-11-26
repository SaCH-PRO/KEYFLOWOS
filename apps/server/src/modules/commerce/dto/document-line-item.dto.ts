import { BadRequestException } from '@nestjs/common';
import { IsNotEmpty, IsNumber, IsOptional, IsPositive, IsString, Max, Min, ValidateBy } from 'class-validator';

/**
 * The largest quantity a document line may carry. Bounded by int4 max so
 * downstream counters and reports never overflow (R0-27 review, ST-27-4 / R27-CR-1).
 */
export const MAX_LINE_QUANTITY = 2_147_483_647;

/**
 * Maximum number of decimal places accepted on commercial document line
 * quantities (P108 / V1-64 DECIMALS-SERVER, D-166).
 */
export const MAX_LINE_QUANTITY_DECIMALS = 2;

/**
 * Canonical refusal message when a caller attempts to bill a stock-tracked
 * product in fractional units (P108 / V1-64 DECIMALS-SERVER, D-166).
 */
export const STOCK_TRACKED_WHOLE_UNITS_MESSAGE = 'Stock-tracked products must be billed in whole units';

/**
 * The largest amount a line price, an invoice subtotal or an invoice total may
 * carry. Invoice amounts are Float columns, but the ledger rows an issued
 * invoice posts (financial_transactions.amount, ledger_entries.debit/credit)
 * are numeric(18,4), so 14 integer digits. A larger amount cannot be posted,
 * and a non-finite one (10 x 1e308 overflows to Infinity) is refused by Prisma
 * as a 500. Both are refused as a 400 instead.
 */
export const MAX_DOCUMENT_AMOUNT = 99_999_999_999_999;

/** Exact decimal-place count of a finite JS number from its shortest decimal representation. */
function decimalPlacesOf(value: number): number {
  const [coeff, exp] = String(value).toLowerCase().split('e');
  const dot = coeff.indexOf('.');
  const frac = dot < 0 ? 0 : coeff.length - dot - 1;
  const shift = exp ? Number(exp) : 0;
  return Math.max(0, frac - shift);
}

/**
 * Validate a commercial document line quantity for service-level callers
 * (PATCH invoice, recurring metadata.items, credit note items, KEY tools,
 * quote conversion). Handles IEEE-754 float traps (e.g. 1.15 * 100 ===
 * 114.99999999999999) via exact decimal representation while strictly
 * rejecting > 2 decimal places (1.555, 0.001, 1.234).
 */
export function assertValidLineQuantity(qty: unknown, fieldLabel = 'quantity'): number {
  if (typeof qty !== 'number' || !Number.isFinite(qty)) {
    throw new BadRequestException(`${fieldLabel} must be a number`);
  }
  if (qty <= 0) {
    throw new BadRequestException(`${fieldLabel} must be a positive number`);
  }
  if (qty > MAX_LINE_QUANTITY) {
    throw new BadRequestException(`${fieldLabel} must not be greater than ${MAX_LINE_QUANTITY}`);
  }
  if (decimalPlacesOf(qty) > MAX_LINE_QUANTITY_DECIMALS) {
    throw new BadRequestException(`${fieldLabel} must have at most ${MAX_LINE_QUANTITY_DECIMALS} decimal places`);
  }
  return qty;
}

/**
 * One line of a commercial document body (R0-27: invoice create; P108 / D-166:
 * decimal quantities up to 2 decimal places on Float columns).
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
   * A positive finite number with at most 2 decimal places, bounded by
   * MAX_LINE_QUANTITY. Stock-tracked products are additionally restricted to
   * whole units in the service layer (P108 / D-166).
   *
   * Uses a custom @ValidateBy backed by decimalPlacesOf() rather than
   * class-validator's maxDecimalPlaces option, which crashes with TypeError on
   * scientific-notation floats such as 1e-7 (R1-SEC-01 / R1-COR-01).
   */
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @ValidateBy({
    name: 'maxLineQuantityDecimals',
    validator: {
      validate: (value: unknown) =>
        typeof value === 'number' && Number.isFinite(value) && decimalPlacesOf(value) <= MAX_LINE_QUANTITY_DECIMALS,
      defaultMessage: (args) =>
        `${args?.property ?? 'quantity'} must be a number with at most ${MAX_LINE_QUANTITY_DECIMALS} decimal places`,
    },
  })
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
