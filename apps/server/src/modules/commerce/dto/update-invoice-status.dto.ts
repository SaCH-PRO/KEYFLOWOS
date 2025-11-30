import { IsIn, IsISO8601, IsOptional } from 'class-validator';

export class UpdateInvoiceStatusDto {
  @IsIn(['SENT', 'OVERDUE', 'VOID'])
  status!: 'SENT' | 'OVERDUE' | 'VOID';

  @IsOptional()
  @IsISO8601()
  sentAt?: string;

  @IsOptional()
  @IsISO8601()
  dueDate?: string;
}
