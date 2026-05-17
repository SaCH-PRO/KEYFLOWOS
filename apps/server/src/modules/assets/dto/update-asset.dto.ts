import {
  IsString,
  IsOptional,
  IsIn,
  IsArray,
  IsInt,
  Min,
} from 'class-validator';

export const ASSET_TYPES = ['image', 'video', 'document', 'audio', 'other'] as const;
export const PERMISSION_LEVELS = ['private', 'team', 'public'] as const;

export class UpdateAssetDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsIn(ASSET_TYPES)
  @IsOptional()
  type?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  tags?: string[];

  @IsString()
  @IsOptional()
  folder?: string;

  @IsIn(PERMISSION_LEVELS)
  @IsOptional()
  permissions?: string;

  @IsInt()
  @Min(0)
  @IsOptional()
  usageCount?: number;
}
