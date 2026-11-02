import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { DocumentLineItemDto } from './document-line-item.dto';

/**
 * The longest quote number a client may choose. Quote.quoteNumber is TEXT and
 * unique per business; the bound keeps a client from storing an unbounded
 * string in a field every quote list, email and PDF renders.
 */
export const MAX_QUOTE_NUMBER_LENGTH = 64;

/**
 * V1-53 review (CR-V53-1): an empty date field is "no date", as the service
 * read it before these DTOs (`input.dueDate ? new Date(..) : null`).
 * IsOptional skips only null and undefined, so '' failed IsDateString with a
 * 400, and the Finance pipeline's Convert-to-Invoice action, which sends the
 * modal's untouched due date as '', could no longer convert. Create and
 * convert read '' as absent; an edit reads it as null, which clears the
 * stored expiry as '' did before.
 */
function emptyDateToUndefined({ value }: { value: unknown }): unknown {
  return typeof value === 'string' && value.trim() === '' ? undefined : value;
}
function emptyDateToNull({ value }: { value: unknown }): unknown {
  return typeof value === 'string' && value.trim() === '' ? null : value;
}

/**
 * Body of POST /commerce/businesses/:businessId/quotes (V1-53, M19 quote half;
 * the invoice half is R0-27's CreateInvoiceDto, whose line DTO this reuses).
 *
 * The route took an inline body type, so the global ValidationPipe saw
 * `Object`: it validated nothing and stripped nothing. Empty items, quantity 0
 * or 1.5, a NaN price, a malformed expiryDate or a non-numeric taxRate reached
 * CommerceService.createQuote and answered 500 or wrote a quote, and a client
 * items[].total was stored over the computed one.
 *
 * Note what is NOT here:
 *   - businessId: it comes from the route param, bound by BusinessGuard.
 *   - subtotal, taxAmount, discountAmount, total, items[].total: the server
 *     computes them. The whitelist drops a client value.
 *   - status, viewToken, sentAt, invoiceId: a new quote is a DRAFT with no
 *     link (R2: the token is minted on send) and no invoice.
 *
 * quoteNumber stays optional: the service numbers a quote that names none, and
 * a number already used in the business answers 409 (quote_number_taken).
 *
 * taxRate and discountValue are type-checked only. Their ranges stay with
 * CommerceService.validateTaxAndDiscount so the R0-D3 messages answer quote
 * create, update and convert alike (as for invoices).
 *
 * contactId is required (Quote.contactId is NOT NULL). Whether it belongs to
 * the caller's tenant is checked by the service, which answers 404, as it does
 * for a line's productId.
 */
export class CreateQuoteDto {
  @IsString()
  @IsNotEmpty()
  contactId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => DocumentLineItemDto)
  items!: DocumentLineItemDto[];

  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string;

  @IsOptional()
  @Transform(emptyDateToUndefined)
  @IsDateString()
  expiryDate?: string;

  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  taxRate?: number;

  @IsOptional()
  @IsIn(['PERCENT', 'FIXED'])
  discountType?: 'PERCENT' | 'FIXED';

  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  discountValue?: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_QUOTE_NUMBER_LENGTH)
  quoteNumber?: string;
}

/**
 * Body of PATCH /commerce/businesses/:businessId/quotes/:quoteId (V1-53).
 *
 * The create contract, loosened only where an edit differs: every field is
 * optional, and expiryDate, discountType and notes may be null (the quotes
 * panel clears an expiry date with null; a quote stored with no discount type
 * echoes it back). `items`, when sent, replaces the quote's lines, so it obeys
 * the create rules: at least one line, each a DocumentLineItemDto. An edit
 * with a NaN price used to delete the lines and then fail in Prisma (500),
 * leaving the quote with none; an empty list wiped them and zeroed the total.
 *
 * Whether the edit is allowed at all (unknown or foreign id 404; converted or
 * accepted quote 409), the tenant of a new contactId or productId (404) and
 * the tax and discount ranges (400) stay with CommerceService.updateQuote.
 */
export class UpdateQuoteDto {
  @IsOptional()
  @IsString()
  contactId?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => DocumentLineItemDto)
  items?: DocumentLineItemDto[];

  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string;

  @IsOptional()
  @Transform(emptyDateToNull)
  @IsDateString()
  expiryDate?: string | null;

  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  taxRate?: number;

  @IsOptional()
  @IsIn(['PERCENT', 'FIXED'])
  discountType?: 'PERCENT' | 'FIXED';

  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  discountValue?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

/**
 * Body of POST /commerce/businesses/:businessId/quotes/:quoteId/convert
 * (V1-53). Every field is optional: an empty body converts the quote on the
 * terms the customer accepted (V1-51). A non-numeric taxRate, an unknown
 * discountType (it was written to the invoice as given), a malformed dueDate
 * or a non-string notes reached the service and answered 500 or wrote the
 * invoice. The ranges and the amount rules stay with
 * CommerceService.convertQuoteToInvoice, which also prices a discountValue
 * sent with no discountType (null passes IsOptional) as a percentage, capped
 * at 100 (V1-53 review CR-V53-4). An empty dueDate is no due date (CR-V53-1).
 */
export class ConvertQuoteDto {
  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  taxRate?: number;

  @IsOptional()
  @IsIn(['PERCENT', 'FIXED'])
  discountType?: 'PERCENT' | 'FIXED';

  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  discountValue?: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @Transform(emptyDateToUndefined)
  @IsDateString()
  dueDate?: string;
}
