import { IsBoolean, IsIn, IsInt, IsJSON, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export const CUSTOM_FIELD_TYPES = [
  'TEXT',
  'TEXTAREA',
  'NUMBER',
  'DATE',
  'SELECT',
  'MULTI_SELECT',
  'CHECKBOX',
  'URL',
  'EMAIL',
] as const;

export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];

export class CreateCustomFieldDefinitionDto {
  @IsString()
  @MaxLength(100)
  name!: string;

  @IsString()
  @MaxLength(200)
  label!: string;

  @IsString()
  @IsIn([...CUSTOM_FIELD_TYPES])
  type!: CustomFieldType;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  description?: string;

  @IsString()
  @IsOptional()
  @MaxLength(200)
  placeholder?: string;

  @IsOptional()
  options?: Record<string, unknown>;

  @IsOptional()
  defaultValue?: unknown;

  @IsBoolean()
  @IsOptional()
  required?: boolean;

  @IsInt()
  @Min(0)
  @IsOptional()
  order?: number;
}

export class UpdateCustomFieldDefinitionDto {
  @IsString()
  @IsOptional()
  @MaxLength(200)
  label?: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  description?: string;

  @IsString()
  @IsOptional()
  @MaxLength(200)
  placeholder?: string;

  @IsOptional()
  options?: Record<string, unknown>;

  @IsOptional()
  defaultValue?: unknown;

  @IsBoolean()
  @IsOptional()
  required?: boolean;

  @IsInt()
  @Min(0)
  @IsOptional()
  order?: number;

  @IsString()
  @IsOptional()
  archivedAt?: string | null;
}
