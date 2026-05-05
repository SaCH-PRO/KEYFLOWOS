import { IsIn, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export class UpdateRevenueAttributionDto {
  @IsOptional()
  @IsString()
  @IsIn(['storefront', 'quote', 'recurring', 'manual', 'community', 'other', 'campaign', 'referral', 'staff'])
  source?: string;

  @IsOptional()
  @IsString()
  sourceDetail?: string | null;

  @IsOptional()
  @IsString()
  contactId?: string | null;

  @IsOptional()
  @IsString()
  campaignId?: string | null;

  @IsOptional()
  @IsString()
  staffId?: string | null;

  @IsOptional()
  @IsString()
  referralCode?: string | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  attributionPercent?: number;
}
