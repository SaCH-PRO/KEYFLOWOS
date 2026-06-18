import { IsIn, IsOptional, IsString, IsUrl, IsISO8601, IsObject, MinLength } from 'class-validator';
import { BUSINESS_ASSET_STATUSES, BUSINESS_ASSET_TYPES } from './create-business-asset.dto';

export class UpdateBusinessAssetDto {
  @IsOptional()
  @IsIn(BUSINESS_ASSET_TYPES)
  type?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsIn(BUSINESS_ASSET_STATUSES)
  status?: string;

  @IsOptional()
  @IsString()
  provider?: string;

  @IsOptional()
  @IsUrl()
  url?: string;

  @IsOptional()
  @IsString()
  identifier?: string;

  @IsOptional()
  @IsString()
  owner?: string;

  @IsOptional()
  @IsISO8601()
  expiresAt?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
