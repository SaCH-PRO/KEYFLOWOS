import { IsBoolean, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateProductDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsNumber()
  price!: number;

  @IsString()
  @IsOptional()
  currency?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  category?: string; // SERVICE, PRODUCT, PACKAGE

  @IsNumber()
  @IsOptional()
  duration?: number; // Duration in minutes (for services)

  @IsString()
  @IsOptional()
  imageUrl?: string;

  @IsString()
  @IsOptional()
  sku?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @IsString()
  @IsOptional()
  inventoryMode?: string; // tracked, untracked, virtual

  @IsString()
  @IsOptional()
  outOfStockBehavior?: string; // hide, show_oos, allow_backorder
}
