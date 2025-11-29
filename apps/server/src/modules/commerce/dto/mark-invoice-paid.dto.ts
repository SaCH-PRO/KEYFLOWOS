import { IsNotEmpty, IsString } from 'class-validator';

export class MarkInvoicePaidDto {
  @IsString()
  @IsNotEmpty()
  invoiceId!: string;
}
