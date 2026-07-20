import { IsString, IsOptional, IsBoolean, IsIn, IsEmail } from 'class-validator';

export class UpdateAssignmentDto {
  @IsOptional()
  @IsString()
  orgUnitId?: string;

  @IsOptional()
  @IsString()
  jobRoleId?: string;

  @IsOptional()
  @IsString()
  reportsToId?: string;

  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;

  @IsOptional()
  endedAt?: string;

  @IsOptional()
  @IsString()
  contactName?: string;

  @IsOptional()
  @IsEmail()
  contactEmail?: string;

  @IsOptional()
  @IsString()
  contactPhone?: string;

  @IsOptional()
  @IsIn(['whatsapp', 'sms', 'email', 'none'])
  preferredChannel?: string;

  @IsOptional()
  @IsBoolean()
  autoApprovalViaReply?: boolean;
}
