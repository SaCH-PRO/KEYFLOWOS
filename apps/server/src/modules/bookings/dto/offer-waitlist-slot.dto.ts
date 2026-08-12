import { IsNotEmpty, IsOptional, IsString, IsUUID, IsDateString } from 'class-validator';

export class OfferWaitlistSlotDto {
  @IsDateString()
  @IsNotEmpty()
  startTime!: string;

  @IsDateString()
  @IsNotEmpty()
  endTime!: string;

  @IsUUID()
  @IsNotEmpty()
  serviceId!: string;

  @IsUUID()
  @IsOptional()
  staffId?: string;
}
