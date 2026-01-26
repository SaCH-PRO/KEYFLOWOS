import { Type } from 'class-transformer';
import { IsArray, IsIn, IsOptional, IsString, ValidateNested } from 'class-validator';
import { LineItemDto } from './line-item.dto';

export class CreateInvoiceDto {
  @IsString()
  contactId!: string;

  @IsOptional()
  @IsString()
  issueDate?: string;

  @IsOptional()
  @IsString()
  dueDate?: string | null;

  @IsOptional()
  @IsIn(['DRAFT', 'SENT', 'PAID', 'VOID', 'OVERDUE'])
  status?: string;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LineItemDto)
  items!: LineItemDto[];
}
