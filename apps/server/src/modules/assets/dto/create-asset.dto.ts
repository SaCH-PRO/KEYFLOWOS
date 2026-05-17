import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsIn,
  IsArray,
  IsInt,
  Min,
  IsUrl,
} from 'class-validator';

export const ASSET_TYPES = ['image', 'video', 'document', 'audio', 'other'] as const;
export const PERMISSION_LEVELS = ['private', 'team', 'public'] as const;

export class CreateAssetDto {
  @IsString()
  @IsNotEmpty()
  businessId!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsIn(ASSET_TYPES)
  type!: string;

  @IsUrl()
  @IsNotEmpty()
  url!: string;

  @IsString()
  @IsNotEmpty()
  storageKey!: string;

  @IsString()
  @IsOptional()
  mimeType?: string;

  @IsInt()
  @Min(0)
  @IsOptional()
  sizeBytes?: number;

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

  @IsString()
  @IsNotEmpty()
  uploadedBy!: string;
}
