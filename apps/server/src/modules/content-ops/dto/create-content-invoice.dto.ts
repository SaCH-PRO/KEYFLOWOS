import { IsOptional, IsString } from 'class-validator';

export class CreateContentInvoiceDto {
  @IsString()
  @IsOptional()
  notes?: string;
}
