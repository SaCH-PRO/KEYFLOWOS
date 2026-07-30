import { IsString, IsOptional, IsBoolean, MinLength, MaxLength } from 'class-validator';

export class AutoConfigureDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
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
  @MaxLength(120)
  customBusinessName?: string;
}
