import { IsString, IsOptional, IsBoolean } from 'class-validator';

export class AutoConfigureDto {
  @IsString()
  templateId!: string;

  @IsOptional()
  @IsBoolean()
  createProducts?: boolean;

  @IsOptional()
  @IsBoolean()
  setBusinessHours?: boolean;

  @IsOptional()
  @IsBoolean()
  setPaymentMethods?: boolean;

  @IsOptional()
  @IsBoolean()
  configureStorefront?: boolean;

  @IsOptional()
  @IsString()
  customBusinessName?: string;
}
