import { IsOptional, IsString, IsArray, IsBoolean, IsDateString } from 'class-validator';

export class ComplianceDto {
  @IsOptional()
  @IsBoolean()
  businessRegistered?: boolean;

  @IsOptional()
  @IsString()
  registrationType?: string;

  @IsOptional()
  @IsString()
  taxIdNumber?: string;

  @IsOptional()
  @IsBoolean()
  hasBusinessInsurance?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  insuranceTypes?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  licensesHeld?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  licensesNeeded?: string[];

  @IsOptional()
  @IsBoolean()
  dataProtectionCompliant?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  industryRegulations?: string[];

  @IsOptional()
  @IsDateString()
  lastComplianceReview?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
