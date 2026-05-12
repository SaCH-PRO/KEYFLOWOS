import { IsString, IsOptional, IsBoolean, IsJSON, IsObject } from 'class-validator';

export class CreateDocumentTemplateDto {
  @IsString()
  type!: 'INVOICE' | 'QUOTE' | 'RECEIPT';

  @IsString()
  name!: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  previewData?: Record<string, unknown>;
}
