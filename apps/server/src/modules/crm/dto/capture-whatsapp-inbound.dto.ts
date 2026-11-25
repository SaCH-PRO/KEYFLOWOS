import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CaptureWhatsAppInboundDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  phone!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(10000)
  message!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  lastName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  contactId?: string;
}
