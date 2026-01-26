import { Type } from 'class-transformer';
import { IsArray, IsIn, IsOptional, IsString, ValidateNested } from 'class-validator';
import { LineItemDto } from './line-item.dto';

export class CreateQuoteDto {
  @IsString()
  contactId!: string;

  @IsOptional()
  @IsString()
  issueDate?: string;

  @IsOptional()
  @IsString()
  expiryDate?: string | null;

  @IsOptional()
  @IsIn(['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED'])
  status?: string;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LineItemDto)
  items!: LineItemDto[];
}
