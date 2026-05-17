import { IsString, IsNumber, IsOptional, IsBoolean, IsIn, Min, MaxLength } from 'class-validator';

export class UpdatePromoCodeDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  code?: string;

  @IsOptional()
  @IsIn(['PERCENT', 'FIXED', 'FREE_SHIPPING'])
  type?: 'PERCENT' | 'FIXED' | 'FREE_SHIPPING';

  @IsOptional()
  @IsNumber()
  @Min(0)
  value?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  minOrderValue?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  maxUses?: number;

  @IsOptional()
  @IsString()
  validFrom?: string;

  @IsOptional()
  @IsString()
  validTo?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
