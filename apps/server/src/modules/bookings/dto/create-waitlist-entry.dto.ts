import { IsNotEmpty, IsOptional, IsString, IsUUID, IsDateString, IsIn } from 'class-validator';

export class CreateWaitlistEntryDto {
  @IsUUID()
  @IsNotEmpty()
  contactId!: string;

  @IsUUID()
  @IsNotEmpty()
  serviceId!: string;

  @IsUUID()
  @IsOptional()
  preferredStaffId?: string;

  @IsDateString()
  @IsOptional()
  preferredDateFrom?: string;

  @IsDateString()
  @IsOptional()
  preferredDateTo?: string;

  @IsIn(['morning', 'afternoon', 'evening'])
  @IsOptional()
  preferredTimeOfDay?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}
