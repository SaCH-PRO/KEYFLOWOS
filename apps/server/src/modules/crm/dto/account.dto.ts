import { Transform } from 'class-transformer';
import { IsArray, IsOptional, IsString, MaxLength } from 'class-validator';
import { sanitize } from '../../../core/utils/sanitize';

export class CreateAccountDto {
  @IsString() @MaxLength(200) @Transform(({ value }) => sanitize(value))
  name!: string;

  @IsString() @IsOptional() @MaxLength(200)
  domain?: string | null;

  @IsString() @IsOptional() @MaxLength(100) @Transform(({ value }) => sanitize(value))
  industry?: string | null;

  @IsString() @IsOptional() @MaxLength(50)
  size?: string | null;

  @IsString() @IsOptional() @MaxLength(300)
  website?: string | null;

  @IsString() @IsOptional()
  primaryContactId?: string | null;

  @IsString() @IsOptional()
  ownerUserId?: string | null;

  @IsArray() @IsOptional()
  tags?: string[];

  @IsString() @IsOptional() @MaxLength(5000) @Transform(({ value }) => sanitize(value))
  notes?: string | null;
}

export class UpdateAccountDto {
  @IsString() @IsOptional() @MaxLength(200) @Transform(({ value }) => sanitize(value))
  name?: string;

  @IsString() @IsOptional() @MaxLength(200)
  domain?: string | null;

  @IsString() @IsOptional() @MaxLength(100) @Transform(({ value }) => sanitize(value))
  industry?: string | null;

  @IsString() @IsOptional() @MaxLength(50)
  size?: string | null;

  @IsString() @IsOptional() @MaxLength(300)
  website?: string | null;

  @IsString() @IsOptional()
  primaryContactId?: string | null;

  @IsString() @IsOptional()
  ownerUserId?: string | null;

  @IsArray() @IsOptional()
  tags?: string[];

  @IsString() @IsOptional() @MaxLength(5000) @Transform(({ value }) => sanitize(value))
  notes?: string | null;
}

export class ApplyAccountMergeDto {
  @IsArray()
  items!: Array<{
    companyName: string;
    useExistingAccountId?: string | null;
    createWithDomain?: string | null;
  }>;
}
