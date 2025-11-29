import { IsNotEmpty, IsString } from 'class-validator';

export class StripeWebhookDto {
  @IsString()
  @IsNotEmpty()
  invoiceId!: string;
}
