import { Type } from 'class-transformer';
import { IsISO8601, IsNotEmpty, IsString } from 'class-validator';

export class CreateBookingDto {
  @IsString()
  @IsNotEmpty()
  contactId!: string;

  @IsString()
  @IsNotEmpty()
  serviceId!: string;

  @IsString()
  @IsNotEmpty()
  staffId!: string;

  @IsISO8601()
  @Type(() => Date)
  startTime!: Date;

  @IsISO8601()
  @Type(() => Date)
  endTime!: Date;
}
