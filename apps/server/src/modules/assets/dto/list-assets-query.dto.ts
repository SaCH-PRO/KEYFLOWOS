import {
  IsString,
  IsOptional,
  IsIn,
  IsInt,
  Min,
} from 'class-validator';

export const ASSET_TYPES = ['image', 'video', 'document', 'audio', 'other'] as const;

export class ListAssetsQueryDto {
  @IsIn(ASSET_TYPES)
  @IsOptional()
  type?: string;

  @IsString()
  @IsOptional()
  folder?: string;

  @IsString()
  @IsOptional()
  tag?: string;

  @IsString()
  @IsOptional()
  search?: string;

  @IsInt()
  @Min(1)
  @IsOptional()
  limit?: number;

  @IsInt()
  @Min(0)
  @IsOptional()
  offset?: number;
}
