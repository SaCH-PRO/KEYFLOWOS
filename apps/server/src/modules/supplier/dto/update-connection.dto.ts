import { IsString, IsOptional, MaxLength, IsArray, IsObject, IsBoolean } from 'class-validator';

export class UpdateConnectionDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  displayName?: string;

  @IsOptional()
  @IsObject()
  credentials?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  accountMeta?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  syncCapabilities?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(50)
  connectionHealth?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
