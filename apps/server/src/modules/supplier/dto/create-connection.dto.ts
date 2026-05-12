import { IsString, IsOptional, MaxLength, IsArray, IsObject } from 'class-validator';

export class CreateConnectionDto {
  @IsString()
  @MaxLength(50)
  providerType!: string;

  @IsString()
  @MaxLength(200)
  displayName!: string;

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
}
