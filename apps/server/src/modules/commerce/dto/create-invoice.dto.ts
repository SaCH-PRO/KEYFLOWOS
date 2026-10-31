import { Type } from 'class-transformer';
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
  ValidateNested,
} from 'class-validator';
import { DocumentLineItemDto } from './document-line-item.dto';

/**
 * Body of POST /commerce/businesses/:businessId/invoices (R0-27, M19 / CF-37).
 *
 * The route took an inline body type, so the global ValidationPipe saw
 * `Object`: it validated nothing and stripped nothing. Empty items, quantity 0,
 * a NaN price or a missing contactId reached CommerceService.createInvoice and
 * answered 500, and a client total/subtotal/taxAmount was trusted over the
 * computed one.
 *
 * Note what is NOT here:
 *   - businessId: it comes from the route param, bound by BusinessGuard.
 *   - subtotal, taxAmount, discountAmount, total, items[].total: the server
 *     computes them. The whitelist drops a client value.
 *   - status, invoiceNumber: a new invoice is a DRAFT numbered by the server.
 *
 * taxRate and discountValue are type-checked only. Their ranges stay with
 * CommerceService.validateTaxAndDiscount so the R0-D3 contract ('Tax rate must
 * be between 0 and 100', 'Discount value must be non-negative', 'Percentage
 * discount cannot exceed 100%') answers create and update alike.
 *
 * contactId is required (Invoice.contactId is NOT NULL). Whether it belongs to
 * the caller's tenant is checked by the service, which answers 404.
 */
export class CreateInvoiceDto {
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
  @IsDateString()
  dueDate?: string;

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
