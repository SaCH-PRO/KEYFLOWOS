import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class QuickSaleItemDto {
  @IsString()
  @IsNotEmpty()
  productId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity!: number;
}

export class CreateQuickSaleDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => QuickSaleItemDto)
  items!: QuickSaleItemDto[];

  @IsString()
  @IsNotEmpty()
  paymentMethod!: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  contactId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  idempotencyKey?: string;

  // Declared so ValidationPipe({ whitelist: true }) does not silently strip
  // discount fields — QuickSaleService explicitly refuses any discount in v1
  // per owner ruling D-164 (taxorder).
  @IsOptional()
  discountAmount?: unknown;

  @IsOptional()
  discount?: unknown;

  @IsOptional()
  promoCode?: unknown;
}
